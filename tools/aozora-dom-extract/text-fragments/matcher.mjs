// The implementation is intentionally local and versioned.  It implements the
// subset of the WICG Text Fragments matching algorithm used by this worker:
// exact and range matches, optional prefix/suffix context, term-local block
// boundaries, and whitespace-separated context.  Keeping it here makes a
// selector rebuild reproducible even when Chromium's native heuristic changes.
//
// Spec snapshot reviewed for this revision:
// https://github.com/WICG/scroll-to-text-fragment/tree/b0ac8732fae68380674c86a5825bf3c2152c6439
export const SELECTOR_ENGINE_REVISION =
  "arcade-text-fragment-matcher-v1@wicg-b0ac8732fae6";

const whitespacePattern = /\p{White_Space}/u;
const markPattern = /\p{Mark}/u;
const latinPattern = /\p{Script=Latin}/u;
const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
const compiledModelCache = new WeakMap();
const primaryCollator = new Intl.Collator("und", {
  usage: "search",
  sensitivity: "base",
});
const asciiLetters = [..."abcdefghijklmnopqrstuvwxyz"];
const asciiPrimaryCandidates = [
  ...asciiLetters,
  ...asciiLetters.flatMap((first) =>
    asciiLetters.map((second) => first + second),
  ),
];
const primaryLatinExpansionCache = new Map();

export function isWhitespace(value) {
  return whitespacePattern.test(value);
}

export function encodeTextFragmentTerm(term) {
  if (typeof term !== "string" || term.length === 0) {
    throw new TypeError("Text Fragment terms must be nonempty strings");
  }

  // encodeURIComponent already encodes comma, ampersand, percent, and spaces.
  // Hyphen is normally left literal, but it is structural in the directive
  // grammar and therefore must be escaped inside a term.
  return encodeURIComponent(term).replaceAll("-", "%2D");
}

export function serializeSelector(selector) {
  validateRawSelector(selector);
  const prefix = selector.prefix
    ? `${encodeTextFragmentTerm(selector.prefix)}-,`
    : "";
  const end = selector.end ? `,${encodeTextFragmentTerm(selector.end)}` : "";
  const suffix = selector.suffix
    ? `,-${encodeTextFragmentTerm(selector.suffix)}`
    : "";
  return `${prefix}${encodeTextFragmentTerm(selector.start)}${end}${suffix}`;
}

export function validateRawSelector(selector) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    throw new TypeError("selector must be an object");
  }
  if (typeof selector.start !== "string" || selector.start.length === 0) {
    throw new TypeError("selector.start must be a nonempty string");
  }
  for (const name of ["prefix", "end", "suffix"]) {
    if (
      selector[name] !== undefined &&
      selector[name] !== null &&
      (typeof selector[name] !== "string" || selector[name].length === 0)
    ) {
      throw new TypeError(`selector.${name} must be absent or nonempty`);
    }
  }
}

function unitOffsets(units) {
  const offsets = [0];
  let offset = 0;
  for (const unit of units) {
    offset += unit.value.length;
    offsets.push(offset);
  }
  return offsets;
}

export function compileTextModel(units) {
  if (!Array.isArray(units)) throw new TypeError("units must be an array");
  const cached = compiledModelCache.get(units);
  if (cached) return cached;
  const text = units.map((unit) => unit.value).join("");
  const offsets = unitOffsets(units);
  const folded = foldUnits(units);
  const wordBoundaries = new Set([0, units.length]);
  for (const segment of wordSegmenter.segment(text)) {
    const start = unitIndexAtOffset(offsets, segment.index);
    const end = unitIndexAtOffset(
      offsets,
      segment.index + segment.segment.length,
    );
    if (start >= 0) wordBoundaries.add(start);
    if (end >= 0) wordBoundaries.add(end);
  }
  const model = {
    units,
    text,
    offsets,
    folded_text: folded.text,
    folded_offsets: folded.offsets,
    word_boundaries: wordBoundaries,
  };
  compiledModelCache.set(units, model);
  return model;
}

function foldUnits(units) {
  let text = "";
  let previousBaseCharacter = null;
  const offsets = [0];
  for (const unit of units) {
    for (const sourceCharacter of unit.value.normalize("NFKD")) {
      for (const lowerCharacter of sourceCharacter.toLocaleLowerCase("und")) {
        const caseFolded = primaryCharacterFold(lowerCharacter);
        for (const caseFoldedCharacter of caseFolded) {
          const codePoint = caseFoldedCharacter.codePointAt(0);
          const character =
            (codePoint >= 0x30a1 && codePoint <= 0x30f6) ||
            codePoint === 0x30fd ||
            codePoint === 0x30fe
              ? String.fromCodePoint(codePoint - 0x60)
              : caseFoldedCharacter;
          const foldedCodePoint = character.codePointAt(0);
          if (
            markPattern.test(character) &&
            foldedCodePoint !== 0x3099 &&
            foldedCodePoint !== 0x309a
          ) {
            continue;
          }
          if (markPattern.test(character) && previousBaseCharacter === "ゝ") {
            // Chromium primary matching equates ゞ/ゝ (and ヾ/ヽ after
            // Katakana folding), while retaining dakuten for ordinary kana.
            continue;
          }
          text += character;
          if (!markPattern.test(character)) previousBaseCharacter = character;
        }
      }
    }
    offsets.push(text.length);
  }
  return { text, offsets };
}

function primaryCharacterFold(character) {
  if (character === "ς") return "σ";
  if (character.codePointAt(0) < 0x80 || !latinPattern.test(character)) {
    return character;
  }
  if (primaryLatinExpansionCache.has(character)) {
    return primaryLatinExpansionCache.get(character);
  }

  // Chromium's primary matcher follows ICU collation for Latin letters that
  // NFKD does not decompose (for example œ/oe and ł/l). Find the same ASCII
  // primary key once, preferring one-letter then lexicographic two-letter
  // candidates. Letters such as þ, ŋ, and dotless ı have no such key and stay
  // distinct. Two letters cover every expansion observed in Chromium while
  // keeping this lookup finite and deterministic.
  const expansion =
    asciiPrimaryCandidates.find(
      (candidate) => primaryCollator.compare(character, candidate) === 0,
    ) ?? character;
  primaryLatinExpansionCache.set(character, expansion);
  return expansion;
}

function foldQuery(query) {
  return foldUnits([...query].map((value) => ({ value }))).text;
}

function unitIndexAtOffset(offsets, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] === offset) return middle;
    if (offsets[middle] < offset) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

// Folded offsets may repeat when a Latin combining mark is ignored. Selecting
// the rightmost corresponding boundary includes that mark at the end of a
// match and excludes a preceding ignored mark at the beginning of the next.
function rightmostUnitIndexAtOffset(offsets, offset) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  const result = low - 1;
  return result >= 0 && offsets[result] === offset ? result : -1;
}

function termMatches(
  model,
  query,
  { wordStartBounded = false, wordEndBounded = false } = {},
) {
  const { units } = model;
  const foldedQuery = foldQuery(query);
  if (!foldedQuery) return [];
  const matches = [];
  let from = 0;
  while (from <= model.folded_text.length - foldedQuery.length) {
    const found = model.folded_text.indexOf(foldedQuery, from);
    if (found < 0) break;
    const start = rightmostUnitIndexAtOffset(model.folded_offsets, found);
    const end = rightmostUnitIndexAtOffset(
      model.folded_offsets,
      found + foldedQuery.length,
    );
    if (start >= 0 && end > start) {
      const selected = units.slice(start, end);
      const segment = selected[0].segment;
      if (
        selected.every(
          (unit) =>
            !unit.hard_boundary && !unit.gaiji && unit.segment === segment,
        ) &&
        (!wordStartBounded || model.word_boundaries.has(start)) &&
        (!wordEndBounded || model.word_boundaries.has(end))
      ) {
        matches.push({ start, end });
      }
    }
    from = found + 1;
  }
  return matches;
}

function skipWhitespaceForward(units, index) {
  while (index < units.length && isWhitespace(units[index].value)) index += 1;
  return index;
}

function hasAdjacentPrefix(model, prefixMatches, start) {
  return prefixMatches.some(
    (match) => skipWhitespaceForward(model.units, match.end) === start,
  );
}

function hasAdjacentSuffix(model, suffixMatches, end) {
  const suffixStart = skipWhitespaceForward(model.units, end);
  return suffixMatches.some((match) => match.start === suffixStart);
}

function boundaryForStart(unit) {
  return { path: unit.path, offset: unit.start_offset };
}

function boundaryForEnd(unit) {
  return { path: unit.path, offset: unit.end_offset };
}

function rangeKey(range) {
  return `${range.start.path.join(".")}:${range.start.offset}-${range.end.path.join(".")}:${range.end.offset}`;
}

/**
 * Resolve every DOM range accepted by a raw selector.  Publication requires
 * exactly one result and exact boundary equality with the intended range.
 */
export function matchSelector(unitsOrModel, selector) {
  validateRawSelector(selector);
  const model = Array.isArray(unitsOrModel)
    ? compileTextModel(unitsOrModel)
    : unitsOrModel;
  if (!model || !Array.isArray(model.units) || typeof model.text !== "string") {
    throw new TypeError("matcher input must be units or a compiled text model");
  }
  const { units } = model;
  const starts = termMatches(model, selector.start, {
    wordStartBounded: !selector.prefix,
    wordEndBounded: Boolean(selector.end) || !selector.suffix,
  });
  const ends = selector.end
    ? termMatches(model, selector.end, {
        wordStartBounded: true,
        wordEndBounded: !selector.suffix,
      })
    : null;
  const prefixes = selector.prefix
    ? termMatches(model, selector.prefix, { wordStartBounded: true })
    : null;
  const suffixes = selector.suffix
    ? termMatches(model, selector.suffix, { wordEndBounded: true })
    : null;
  const ranges = [];

  for (const start of starts) {
    if (prefixes && !hasAdjacentPrefix(model, prefixes, start.start)) continue;
    const candidates = ends
      ? ends.filter((end) => end.start >= start.end)
      : [{ end: start.end }];
    for (const candidate of candidates) {
      if (suffixes && !hasAdjacentSuffix(model, suffixes, candidate.end)) {
        // WICG range matching advances to a later end only when suffix
        // adjacency fails. Exact matching instead advances to the next start.
        if (!ends) break;
        continue;
      }
      const range = {
        start: boundaryForStart(units[start.start]),
        end: boundaryForEnd(units[candidate.end - 1]),
        start_unit: start.start,
        end_unit: candidate.end,
      };
      ranges.push(range);
      // The first following end (or first end satisfying suffix) owns this
      // range start. Later end terms are not alternative directive matches.
      break;
    }
  }

  const unique = new Map();
  for (const range of ranges) unique.set(rangeKey(range), range);
  return [...unique.values()];
}

export function equalDOMRange(left, right) {
  return (
    left.start.offset === right.start.offset &&
    left.end.offset === right.end.offset &&
    left.start.path.length === right.start.path.length &&
    left.end.path.length === right.end.path.length &&
    left.start.path.every((part, index) => part === right.start.path[index]) &&
    left.end.path.every((part, index) => part === right.end.path[index])
  );
}

export function verifySelector(unitsOrModel, selector, intendedRange) {
  const matches = matchSelector(unitsOrModel, selector);
  return {
    verified: matches.length === 1 && equalDOMRange(matches[0], intendedRange),
    match_count: matches.length,
    matches_intended:
      matches.length === 1 && equalDOMRange(matches[0], intendedRange),
  };
}
