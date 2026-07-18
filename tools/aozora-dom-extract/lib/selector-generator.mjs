import {
  isWhitespace,
  serializeSelector,
  verifySelector,
} from "../text-fragments/matcher.mjs";

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
// Keep selectors compact enough for the 60 MiB catalogue budget. Sentences
// above this threshold use independently verified start/end terms; twelve
// graphemes per anchor remains ample with contextual fallback while avoiding
// very large percent-encoded item rows.
const MAX_EXACT_GRAPHEMES = 40;
const MAX_ANCHOR_GRAPHEMES = 12;
const MAX_CONTEXT_GRAPHEMES = 16;

function graphemeCount(text) {
  return [...graphemeSegmenter.segment(text)].length;
}

function wordBoundaryData(text) {
  const boundaries = new Set([0, text.length]);
  const wordLike = [];
  for (const segment of wordSegmenter.segment(text)) {
    boundaries.add(segment.index);
    boundaries.add(segment.index + segment.segment.length);
    if (segment.isWordLike) {
      wordLike.push({
        start: segment.index,
        end: segment.index + segment.segment.length,
      });
    }
  }
  return {
    boundaries: [...boundaries].sort((left, right) => left - right),
    wordLike,
  };
}

function includesWordLike(wordLike, start, end) {
  return wordLike.some((word) => word.start < end && word.end > start);
}

function takeGraphemes(text, count, fromEnd = false, boundedEdge = null) {
  const segments = [...graphemeSegmenter.segment(text)];
  const selected = fromEnd ? segments.slice(-count) : segments.slice(0, count);
  if (selected.length === 0) return "";
  let start = selected[0].index;
  const last = selected[selected.length - 1];
  let end = last.index + last.segment.length;
  const data = wordBoundaryData(text);
  if (boundedEdge === "end" && !data.boundaries.includes(end)) {
    const withinLimit = data.boundaries.filter(
      (boundary) => boundary > start && boundary < end,
    );
    end =
      withinLimit.at(-1) ??
      data.boundaries.find((boundary) => boundary > end) ??
      end;
    if (!includesWordLike(data.wordLike, start, end)) {
      end = data.boundaries.find((boundary) => boundary > end) ?? end;
    }
  }
  if (boundedEdge === "start" && !data.boundaries.includes(start)) {
    const withinLimit = data.boundaries.find(
      (boundary) => boundary > start && boundary < end,
    );
    start =
      withinLimit ??
      data.boundaries.filter((boundary) => boundary < start).at(-1) ??
      start;
    if (!includesWordLike(data.wordLike, start, end)) {
      start =
        data.boundaries.filter((boundary) => boundary < start).at(-1) ?? start;
    }
  }
  return text.slice(start, end);
}

function textFor(units, start, end) {
  return units
    .slice(start, end)
    .map((unit) => unit.value)
    .join("");
}

function trimStart(units, index, limit) {
  while (index < limit && isWhitespace(units[index].value)) index += 1;
  return index;
}

function trimEnd(units, index, limit) {
  while (index > limit && isWhitespace(units[index - 1].value)) index -= 1;
  return index;
}

function safeTerm(units, start, end) {
  if (end <= start) return false;
  const segment = units[start].segment;
  return units
    .slice(start, end)
    .every(
      (unit) => !unit.hard_boundary && !unit.gaiji && unit.segment === segment,
    );
}

function startAnchor(units, start, end) {
  const segment = units[start].segment;
  let boundary = start;
  while (
    boundary < end &&
    units[boundary].segment === segment &&
    !units[boundary].hard_boundary &&
    !units[boundary].gaiji
  ) {
    boundary += 1;
  }
  boundary = trimEnd(units, boundary, start);
  return takeGraphemes(
    textFor(units, start, boundary),
    MAX_ANCHOR_GRAPHEMES,
    false,
    "end",
  );
}

function endAnchor(units, start, end) {
  const segment = units[end - 1].segment;
  let boundary = end;
  while (
    boundary > start &&
    units[boundary - 1].segment === segment &&
    !units[boundary - 1].hard_boundary &&
    !units[boundary - 1].gaiji
  ) {
    boundary -= 1;
  }
  boundary = trimStart(units, boundary, end);
  return takeGraphemes(
    textFor(units, boundary, end),
    MAX_ANCHOR_GRAPHEMES,
    true,
    "start",
  );
}

function prefixContext(units, targetStart) {
  let end = targetStart;
  while (end > 0 && isWhitespace(units[end - 1].value)) end -= 1;
  if (end === 0) return null;
  const segment = units[end - 1].segment;
  let start = end;
  while (
    start > 0 &&
    units[start - 1].segment === segment &&
    !units[start - 1].hard_boundary &&
    !units[start - 1].gaiji
  ) {
    start -= 1;
  }
  start = trimStart(units, start, end);
  const context = takeGraphemes(
    textFor(units, start, end),
    MAX_CONTEXT_GRAPHEMES,
    true,
    "start",
  ).trim();
  return context || null;
}

function suffixContext(units, targetEnd) {
  let start = targetEnd;
  while (start < units.length && isWhitespace(units[start].value)) start += 1;
  if (start === units.length) return null;
  const segment = units[start].segment;
  let end = start;
  while (
    end < units.length &&
    units[end].segment === segment &&
    !units[end].hard_boundary &&
    !units[end].gaiji
  ) {
    end += 1;
  }
  end = trimEnd(units, end, start);
  const context = takeGraphemes(
    textFor(units, start, end),
    MAX_CONTEXT_GRAPHEMES,
    false,
    "end",
  ).trim();
  return context || null;
}

function kindFor(raw) {
  if (raw.end) return raw.prefix || raw.suffix ? "contextual_range" : "range";
  return raw.prefix || raw.suffix ? "contextual_exact" : "exact";
}

function materialize(raw, strategy) {
  const selector = { kind: kindFor(raw), ...raw };
  return {
    ...selector,
    encoded: serializeSelector(selector),
    strategy,
    verified: true,
  };
}

function candidateVariants(base, prefix, suffix, label) {
  const variants = [{ raw: base, strategy: label }];
  if (prefix) {
    variants.push({
      raw: { ...base, prefix },
      strategy: `${label}_prefix`,
    });
  }
  if (suffix) {
    variants.push({
      raw: { ...base, suffix },
      strategy: `${label}_suffix`,
    });
  }
  if (prefix && suffix) {
    variants.push({
      raw: { ...base, prefix, suffix },
      strategy: `${label}_prefix_suffix`,
    });
  }
  return variants;
}

export function generateSelector(units, target, matcherModel = units) {
  const { start_unit: start, end_unit: end, range } = target;
  const exactText = textFor(units, start, end);
  let base;
  let label;
  if (
    graphemeCount(exactText) <= MAX_EXACT_GRAPHEMES &&
    safeTerm(units, start, end)
  ) {
    base = { start: exactText };
    label = "exact";
  } else {
    const first = startAnchor(units, start, end);
    const last = endAnchor(units, start, end);
    if (!first || !last || first === last) return null;
    base = { start: first, end: last };
    label = "range";
  }

  // Context is deliberately lazy: the contract adds it only when the simpler
  // selector is ambiguous, and corpus lines can contain many sentences.
  const baseCheck = verifySelector(matcherModel, base, range);
  if (baseCheck.verified) return materialize(base, label);

  const prefix = prefixContext(units, start);
  const suffix = suffixContext(units, end);
  for (const candidate of candidateVariants(base, prefix, suffix, label).slice(
    1,
  )) {
    const check = verifySelector(matcherModel, candidate.raw, range);
    if (check.verified) return materialize(candidate.raw, candidate.strategy);
  }
  return null;
}

export const selectorGeneratorConstants = {
  max_exact_graphemes: MAX_EXACT_GRAPHEMES,
  max_anchor_graphemes: MAX_ANCHOR_GRAPHEMES,
  max_context_graphemes: MAX_CONTEXT_GRAPHEMES,
};
