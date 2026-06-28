import type { Locator } from "@playwright/test";

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SourceLocation = {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type RelatedSource = {
  label: string;
  location: SourceLocation;
};

export type RuntimeCandidate = {
  id: string;
  kind: "runtime";
  role: string;
  tagName: string;
  name: string;
  text: string;
  regionPath: string[];
  visible: boolean;
  enabled?: boolean;
  pressed?: boolean;
  bounds?: Bounds;
  locator: Locator;
};

export type RuntimeCandidateSummary = Omit<RuntimeCandidate, "locator">;

export type SourceCandidate = {
  id: string;
  kind: "source";
  elementKind: "dom" | "component";
  tagName: string;
  role: string;
  name: string;
  text: string;
  label: string;
  regionPath: string[];
  dynamic: boolean;
  props: Record<string, string>;
  source: SourceLocation;
  relatedSources: RelatedSource[];
};

export type LocatorQuery = {
  raw: string;
  normalized: string;
  tokens: string[];
  role?: string;
  within?: string;
};

export type RankedRuntimeCandidate = {
  candidate: RuntimeCandidate;
  score: number;
  reasons: string[];
};

export type RankedSourceCandidate = {
  candidate: SourceCandidate;
  score: number;
  reasons: string[];
};

export type JoinedMatch = {
  id: string;
  score: number;
  reasons: string[];
  runtime?: RankedRuntimeCandidate;
  source?: RankedSourceCandidate;
};

export type SerializableJoinedMatch = Omit<
  JoinedMatch,
  "runtime" | "source"
> & {
  runtime?: Omit<RankedRuntimeCandidate, "candidate"> & {
    candidate: RuntimeCandidateSummary;
  };
  source?: RankedSourceCandidate;
};
