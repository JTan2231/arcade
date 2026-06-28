import type {
  JoinedMatch,
  LocatorQuery,
  RankedRuntimeCandidate,
  RankedSourceCandidate,
  RuntimeCandidate,
  RuntimeCandidateSummary,
  SerializableJoinedMatch,
  SourceCandidate,
} from "./types";

export type MatchOptions = {
  role?: string;
  within?: string;
};

export function createQuery(raw: string, options: MatchOptions): LocatorQuery {
  return {
    raw,
    normalized: normalizeText(raw),
    tokens: tokenize(raw),
    ...(options.role === undefined
      ? {}
      : { role: normalizeRole(options.role) }),
    ...(options.within === undefined ? {} : { within: options.within }),
  };
}

export function rankMatches(
  query: LocatorQuery,
  runtimeCandidates: RuntimeCandidate[],
  sourceCandidates: SourceCandidate[],
): JoinedMatch[] {
  const rankedRuntime = runtimeCandidates
    .map((candidate) => rankRuntimeCandidate(query, candidate))
    .filter((ranked): ranked is RankedRuntimeCandidate => ranked !== null)
    .sort((left, right) => right.score - left.score);

  const rankedSource = sourceCandidates
    .map((candidate) => rankSourceCandidate(query, candidate))
    .filter((ranked): ranked is RankedSourceCandidate => ranked !== null)
    .sort((left, right) => right.score - left.score);

  const sourceByID = new Map(
    rankedSource.map((ranked) => [ranked.candidate.id, ranked]),
  );
  const usedSourceIDs = new Set<string>();
  const matches: JoinedMatch[] = [];

  for (const runtime of rankedRuntime) {
    const source = bestSourceForRuntime(
      runtime.candidate,
      rankedSource,
      usedSourceIDs,
    );
    if (source !== undefined) {
      usedSourceIDs.add(source.candidate.id);
    }

    const pairScore =
      source === undefined
        ? 0
        : sourceRuntimeAgreement(runtime.candidate, source.candidate);
    matches.push({
      id: `runtime:${runtime.candidate.id}`,
      score: runtime.score + pairScore + (source?.score ?? 0) * 0.25,
      reasons: [
        ...runtime.reasons,
        ...(source === undefined
          ? []
          : [`source agreement +${pairScore.toFixed(2)}`]),
      ],
      runtime,
      ...(source === undefined ? {} : { source }),
    });
  }

  for (const source of rankedSource) {
    if (usedSourceIDs.has(source.candidate.id)) {
      continue;
    }
    const existing = matches.some(
      (match) => match.source?.candidate.id === source.candidate.id,
    );
    if (existing) {
      continue;
    }
    matches.push({
      id: `source:${source.candidate.id}`,
      score: source.score * 0.82,
      reasons: source.reasons,
      source,
    });
  }

  return matches
    .filter((match) => match.score > 0.18)
    .sort((left, right) => right.score - left.score);

  function bestSourceForRuntime(
    runtime: RuntimeCandidate,
    sources: RankedSourceCandidate[],
    usedIDs: Set<string>,
  ): RankedSourceCandidate | undefined {
    let selected: RankedSourceCandidate | undefined;
    let selectedScore = 0;
    for (const source of sources) {
      if (usedIDs.has(source.candidate.id)) {
        continue;
      }
      const agreement = sourceRuntimeAgreement(runtime, source.candidate);
      if (agreement > selectedScore) {
        selected = source;
        selectedScore = agreement;
      }
    }
    return selectedScore >= 0.35 ? selected : undefined;
  }
}

export function serializableMatch(match: JoinedMatch): SerializableJoinedMatch {
  return {
    id: match.id,
    score: match.score,
    reasons: match.reasons,
    ...(match.runtime === undefined
      ? {}
      : {
          runtime: {
            score: match.runtime.score,
            reasons: match.runtime.reasons,
            candidate: runtimeSummary(match.runtime.candidate),
          },
        }),
    ...(match.source === undefined ? {} : { source: match.source }),
  };
}

export function runtimeSummary(
  candidate: RuntimeCandidate,
): RuntimeCandidateSummary {
  const { locator: _locator, ...summary } = candidate;
  return summary;
}

export function normalizeText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}{}]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => singularize(token))
    .filter((token) => token !== "");
}

function rankRuntimeCandidate(
  query: LocatorQuery,
  candidate: RuntimeCandidate,
): RankedRuntimeCandidate | null {
  if (!roleMatches(query, candidate.role)) {
    return null;
  }

  const reasons: string[] = [];
  let score = 0;
  const labelScore = bestTextScore(query, [
    candidate.name,
    candidate.text,
    candidate.regionPath.join(" "),
    `${candidate.role} ${candidate.name}`,
  ]);
  score += labelScore.score;
  reasons.push(...labelScore.reasons);

  if (candidate.visible) {
    score += 0.18;
    reasons.push("visible +0.18");
  } else {
    score -= 0.35;
    reasons.push("hidden -0.35");
  }

  if (query.within !== undefined) {
    const withinScore = bestTextScore(
      {
        raw: query.within,
        normalized: normalizeText(query.within),
        tokens: tokenize(query.within),
      },
      candidate.regionPath,
    ).score;
    if (withinScore > 0.55) {
      score += 0.28;
      reasons.push(`within +${withinScore.toFixed(2)}`);
    } else {
      score -= 0.45;
      reasons.push("outside requested region -0.45");
    }
  }

  if (query.role !== undefined) {
    score += 0.22;
    reasons.push("role +0.22");
  }

  return score > 0 ? { candidate, score, reasons } : null;
}

function rankSourceCandidate(
  query: LocatorQuery,
  candidate: SourceCandidate,
): RankedSourceCandidate | null {
  if (!roleMatches(query, candidate.role)) {
    return null;
  }

  const reasons: string[] = [];
  let score = 0;
  const labelScore = bestTextScore(query, [
    candidate.name,
    candidate.label,
    candidate.text,
    candidate.regionPath.join(" "),
    `${candidate.role} ${candidate.name}`,
    `${candidate.tagName} ${candidate.name}`,
  ]);
  score += labelScore.score;
  reasons.push(...labelScore.reasons);

  if (candidate.dynamic) {
    score -= 0.08;
    reasons.push("dynamic source -0.08");
  }

  if (query.within !== undefined) {
    const withinScore = bestTextScore(
      {
        raw: query.within,
        normalized: normalizeText(query.within),
        tokens: tokenize(query.within),
      },
      candidate.regionPath,
    ).score;
    if (withinScore > 0.55) {
      score += 0.24;
      reasons.push(`within source +${withinScore.toFixed(2)}`);
    } else {
      score -= 0.38;
      reasons.push("source outside requested region -0.38");
    }
  }

  if (query.role !== undefined) {
    score += 0.16;
    reasons.push("source role +0.16");
  }

  return score > 0 ? { candidate, score, reasons } : null;
}

function sourceRuntimeAgreement(
  runtime: RuntimeCandidate,
  source: SourceCandidate,
): number {
  let score = 0;

  if (runtime.role === source.role) {
    score += 0.22;
  }

  const nameScore = textScore(runtime.name, source.name).score;
  if (nameScore >= 0.75) {
    score += 0.34;
  } else if (source.dynamic && source.name.includes("{")) {
    score += 0.12;
  }

  const regionScore = bestTextScore(
    {
      raw: runtime.regionPath.join(" "),
      normalized: normalizeText(runtime.regionPath.join(" ")),
      tokens: tokenize(runtime.regionPath.join(" ")),
    },
    source.regionPath,
  ).score;
  if (regionScore >= 0.55) {
    score += 0.22;
  }

  if (runtime.tagName === source.tagName) {
    score += 0.12;
  }

  const runtimeText = normalizeText(runtime.text);
  const sourceText = normalizeText(source.text);
  if (runtimeText !== "" && sourceText !== "") {
    const overlap = textScore(runtimeText, sourceText).score;
    if (overlap >= 0.55) {
      score += 0.18;
    }
  }

  return score;
}

function roleMatches(query: LocatorQuery, role: string): boolean {
  return query.role === undefined || normalizeRole(role) === query.role;
}

function bestTextScore(
  query: Pick<LocatorQuery, "normalized" | "raw" | "tokens">,
  values: string[],
): { score: number; reasons: string[] } {
  let best = { score: 0, reasons: [] as string[] };
  for (const value of values) {
    const candidate = textScore(query.raw, value, query.tokens);
    if (candidate.score > best.score) {
      best = candidate;
    }
  }
  return best;
}

function textScore(
  query: string,
  candidate: string,
  queryTokens = tokenize(query),
): { score: number; reasons: string[] } {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  if (normalizedQuery === "" || normalizedCandidate === "") {
    return { score: 0, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;
  if (normalizedQuery === normalizedCandidate) {
    score = Math.max(score, 1);
    reasons.push("exact +1.00");
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const compactCandidate = normalizedCandidate.replace(/\s+/g, "");
  if (compactQuery !== "" && compactQuery === compactCandidate) {
    score = Math.max(score, 0.96);
    reasons.push("compact exact +0.96");
  }

  if (normalizedCandidate.includes(normalizedQuery)) {
    score = Math.max(score, normalizedCandidate === normalizedQuery ? 1 : 0.78);
    reasons.push("substring +0.78");
  } else if (normalizedQuery.includes(normalizedCandidate)) {
    score = Math.max(score, 0.62);
    reasons.push("reverse substring +0.62");
  }

  const candidateTokens = tokenize(candidate);
  if (queryTokens.length > 0 && candidateTokens.length > 0) {
    const matched = queryTokens.filter((token) =>
      candidateTokens.some((candidateToken) =>
        tokenMatches(token, candidateToken),
      ),
    );
    const queryCoverage = matched.length / queryTokens.length;
    const candidateCoverage = matched.length / candidateTokens.length;
    const tokenScore = queryCoverage * 0.66 + candidateCoverage * 0.18;
    if (tokenScore > score) {
      score = tokenScore;
    }
    if (matched.length > 0) {
      reasons.push(`tokens +${tokenScore.toFixed(2)}`);
    }
  }

  if (Math.max(compactQuery.length, compactCandidate.length) <= 48) {
    const distanceScore = levenshteinRatio(compactQuery, compactCandidate);
    if (distanceScore >= 0.68 && distanceScore * 0.72 > score) {
      score = distanceScore * 0.72;
      reasons.push(`distance +${(distanceScore * 0.72).toFixed(2)}`);
    }
  }

  return { score, reasons };
}

function tokenMatches(queryToken: string, candidateToken: string): boolean {
  return (
    queryToken === candidateToken ||
    singularize(queryToken) === singularize(candidateToken) ||
    candidateToken.includes(queryToken) ||
    queryToken.includes(candidateToken) ||
    levenshteinRatio(queryToken, candidateToken) >= 0.76
  );
}

function singularize(token: string): string {
  if (token.length > 3 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeRole(role: string): string {
  return normalizeText(role).replace(/\s+/g, "-");
}

function levenshteinRatio(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (left === "" || right === "") {
    return 0;
  }

  const previous = Array.from(
    { length: right.length + 1 },
    (_entry, index) => index,
  );
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  const distance =
    previous[right.length] ?? Math.max(left.length, right.length);
  return 1 - distance / Math.max(left.length, right.length);
}
