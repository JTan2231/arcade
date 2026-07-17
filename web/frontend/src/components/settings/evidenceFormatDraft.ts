import type {
  CreateEvidenceFormatRequest,
  CreateEvidenceFormatVersionRequest,
  EvidenceFormat,
  PatchEvidenceFormatRequest,
} from "../../types";

export type EvidenceFormatDraft = {
  slug: string;
  name: string;
  description: string;
  minChars: string;
  maxChars: string;
  lineMode: "range" | "exact";
  minLines: string;
  maxLines: string;
  exactLines: string;
  lineMinChars: string;
  lineMaxChars: string;
  allowBlankLines: boolean;
};

export const emptyFormatDraft: EvidenceFormatDraft = {
  slug: "",
  name: "",
  description: "",
  minChars: "1",
  maxChars: "",
  lineMode: "range",
  minLines: "",
  maxLines: "",
  exactLines: "",
  lineMinChars: "",
  lineMaxChars: "",
  allowBlankLines: true,
};

export type EvidenceFormatEditPayloads = {
  metadata?: PatchEvidenceFormatRequest;
  version?: CreateEvidenceFormatVersionRequest;
};

export function buildFormatPayload(draft: EvidenceFormatDraft): CreateEvidenceFormatRequest | string {
  const identityError = validateFormatIdentity(draft);
  if (identityError !== "") {
    return identityError;
  }
  const version = buildVersionPayload(draft);
  if (typeof version === "string") {
    return version;
  }
  const slug = draft.slug.trim();
  const name = draft.name.trim();
  return {
    slug,
    name,
    ...(draft.description.trim() !== "" ? { description: draft.description.trim() } : {}),
    ...version,
  };
}

export function validateFormatIdentity(draft: EvidenceFormatDraft): string {
  const slug = draft.slug.trim();
  if (slug === "") {
    return "Slug is required";
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return "Slug must use lowercase letters, numbers, and hyphens";
  }
  if (draft.name.trim() === "") {
    return "Name is required";
  }
  return "";
}

export function validateFormatLength(draft: EvidenceFormatDraft): string {
  const minChars = parsePositiveInteger(draft.minChars);
  const maxChars = parseOptionalPositiveInteger(draft.maxChars);
  if (minChars === "invalid" || maxChars === "invalid") {
    return "Constraint values must be positive integers";
  }
  if (maxChars !== undefined && maxChars < (minChars ?? 1)) {
    return "Max chars must be at least min chars";
  }
  return "";
}

export function validateFormatLines(draft: EvidenceFormatDraft): string {
  const minLines = draft.lineMode === "range" ? parseOptionalPositiveInteger(draft.minLines) : undefined;
  const maxLines = draft.lineMode === "range" ? parseOptionalPositiveInteger(draft.maxLines) : undefined;
  const exactLines = draft.lineMode === "exact" ? parsePositiveInteger(draft.exactLines) : undefined;
  if (minLines === "invalid" || maxLines === "invalid" || exactLines === "invalid") {
    return "Constraint values must be positive integers";
  }
  if (draft.lineMode === "exact" && exactLines === undefined) {
    return "Exact lines is required";
  }
  if (minLines !== undefined && maxLines !== undefined && maxLines < minLines) {
    return "Max lines must be at least min lines";
  }
  return "";
}

export function validateFormatLineLength(draft: EvidenceFormatDraft): string {
  const lineMinChars = parseOptionalPositiveInteger(draft.lineMinChars);
  const lineMaxChars = parseOptionalPositiveInteger(draft.lineMaxChars);
  if (lineMinChars === "invalid" || lineMaxChars === "invalid") {
    return "Constraint values must be positive integers";
  }
  if (lineMinChars !== undefined && lineMaxChars !== undefined && lineMaxChars < lineMinChars) {
    return "Line max chars must be at least line min chars";
  }
  return "";
}

function buildVersionPayload(draft: EvidenceFormatDraft): CreateEvidenceFormatVersionRequest | string {
  const parsedMinChars = parsePositiveInteger(draft.minChars);
  const maxChars = parseOptionalPositiveInteger(draft.maxChars);
  const minLines = draft.lineMode === "range" ? parseOptionalPositiveInteger(draft.minLines) : undefined;
  const maxLines = draft.lineMode === "range" ? parseOptionalPositiveInteger(draft.maxLines) : undefined;
  const exactLines = draft.lineMode === "exact" ? parsePositiveInteger(draft.exactLines) : undefined;
  const lineMinChars = parseOptionalPositiveInteger(draft.lineMinChars);
  const lineMaxChars = parseOptionalPositiveInteger(draft.lineMaxChars);
  if (
    parsedMinChars === "invalid" ||
    maxChars === "invalid" ||
    minLines === "invalid" ||
    maxLines === "invalid" ||
    exactLines === "invalid" ||
    lineMinChars === "invalid" ||
    lineMaxChars === "invalid"
  ) {
    return "Constraint values must be positive integers";
  }
  const minChars = parsedMinChars ?? 1;
  if (draft.lineMode === "exact" && exactLines === undefined) {
    return "Exact lines is required";
  }
  if (maxChars !== undefined && maxChars < minChars) {
    return "Max chars must be at least min chars";
  }
  if (minLines !== undefined && maxLines !== undefined && maxLines < minLines) {
    return "Max lines must be at least min lines";
  }
  if (lineMinChars !== undefined && lineMaxChars !== undefined && lineMaxChars < lineMinChars) {
    return "Line max chars must be at least line min chars";
  }
  return {
    min_chars: minChars,
    ...(maxChars !== undefined ? { max_chars: maxChars } : {}),
    ...(minLines !== undefined ? { min_lines: minLines } : {}),
    ...(maxLines !== undefined ? { max_lines: maxLines } : {}),
    ...(exactLines !== undefined ? { exact_lines: exactLines } : {}),
    ...(lineMinChars !== undefined ? { line_min_chars: lineMinChars } : {}),
    ...(lineMaxChars !== undefined ? { line_max_chars: lineMaxChars } : {}),
    allow_blank_lines: draft.allowBlankLines,
  };
}

function parsePositiveInteger(value: string): number | "invalid" | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

function parseOptionalPositiveInteger(value: string): number | "invalid" | undefined {
  return parsePositiveInteger(value);
}

function formatVersionToDraft(version: EvidenceFormat["active_version"]): EvidenceFormatDraft {
  return {
    slug: "",
    name: "",
    description: "",
    minChars: String(version.min_chars),
    maxChars: version.max_chars?.toString() ?? "",
    lineMode: version.exact_lines !== undefined ? "exact" : "range",
    minLines: version.min_lines?.toString() ?? "",
    maxLines: version.max_lines?.toString() ?? "",
    exactLines: version.exact_lines?.toString() ?? "",
    lineMinChars: version.line_min_chars?.toString() ?? "",
    lineMaxChars: version.line_max_chars?.toString() ?? "",
    allowBlankLines: version.allow_blank_lines,
  };
}

export function evidenceFormatToDraft(format: EvidenceFormat): EvidenceFormatDraft {
  return {
    ...formatVersionToDraft(format.active_version),
    slug: format.slug,
    name: format.name,
    description: format.description ?? "",
  };
}

export function buildFormatEditPayloads(
  format: EvidenceFormat,
  draft: EvidenceFormatDraft,
): EvidenceFormatEditPayloads | string {
  const identityError = validateFormatIdentity(draft);
  if (identityError !== "") {
    return identityError;
  }
  const version = buildVersionPayload(draft);
  if (typeof version === "string") {
    return version;
  }

  const metadata: PatchEvidenceFormatRequest = {};
  const name = draft.name.trim();
  if (name !== format.name) {
    metadata.name = name;
  }
  const description = draft.description.trim();
  if (description !== (format.description ?? "")) {
    metadata.description = description === "" ? null : description;
  }

  return {
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(!sameVersionPayload(version, versionPayload(format.active_version)) ? { version } : {}),
  };
}

export function formatEditHasChanges(payloads: EvidenceFormatEditPayloads | string): boolean {
  return typeof payloads !== "string" && (payloads.metadata !== undefined || payloads.version !== undefined);
}

function versionPayload(version: EvidenceFormat["active_version"]): CreateEvidenceFormatVersionRequest {
  return {
    min_chars: version.min_chars,
    ...(version.max_chars !== undefined ? { max_chars: version.max_chars } : {}),
    ...(version.min_lines !== undefined ? { min_lines: version.min_lines } : {}),
    ...(version.max_lines !== undefined ? { max_lines: version.max_lines } : {}),
    ...(version.exact_lines !== undefined ? { exact_lines: version.exact_lines } : {}),
    ...(version.line_min_chars !== undefined ? { line_min_chars: version.line_min_chars } : {}),
    ...(version.line_max_chars !== undefined ? { line_max_chars: version.line_max_chars } : {}),
    allow_blank_lines: version.allow_blank_lines,
  };
}

function sameVersionPayload(
  left: CreateEvidenceFormatVersionRequest,
  right: CreateEvidenceFormatVersionRequest,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function formatConstraintSummary(version: EvidenceFormat["active_version"]): string {
  const parts: string[] = [];
  if (version.max_chars !== undefined) {
    parts.push(`${version.min_chars}-${version.max_chars} chars`);
  } else {
    parts.push(`${version.min_chars}+ chars`);
  }
  if (version.exact_lines !== undefined) {
    parts.push(`${version.exact_lines} lines`);
  } else if (version.min_lines !== undefined || version.max_lines !== undefined) {
    parts.push(`${version.min_lines ?? 1}-${version.max_lines ?? "any"} lines`);
  }
  if (!version.allow_blank_lines) {
    parts.push("no blanks");
  }
  return parts.join(" · ");
}
