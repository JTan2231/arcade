import type { EvidenceFormatVersion, GroupFeedPost } from "../../types";

export function normalizeEvidenceText(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function validateEvidenceText(text: string, version: EvidenceFormatVersion): string {
  const charCount = Array.from(text).length;
  if (charCount < version.min_chars) {
    return version.min_chars === 1
      ? "Evidence is required"
      : `Evidence must be at least ${version.min_chars} characters`;
  }
  if (version.max_chars !== undefined && charCount > version.max_chars) {
    return `Evidence must be at most ${version.max_chars} characters`;
  }

  const lines = text.split("\n");
  if (version.exact_lines !== undefined && lines.length !== version.exact_lines) {
    return `Evidence must be exactly ${version.exact_lines} lines`;
  }
  if (version.min_lines !== undefined && lines.length < version.min_lines) {
    return `Evidence must be at least ${version.min_lines} lines`;
  }
  if (version.max_lines !== undefined && lines.length > version.max_lines) {
    return `Evidence must be at most ${version.max_lines} lines`;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (!version.allow_blank_lines) {
        return "Evidence cannot contain blank lines";
      }
      continue;
    }
    const lineChars = Array.from(trimmed).length;
    if (version.line_min_chars !== undefined && lineChars < version.line_min_chars) {
      return `Each non-blank line must be at least ${version.line_min_chars} characters`;
    }
    if (version.line_max_chars !== undefined && lineChars > version.line_max_chars) {
      return `Each non-blank line must be at most ${version.line_max_chars} characters`;
    }
  }

  return "";
}

export function evidenceFormatConstraintSummary(version: EvidenceFormatVersion): string {
  const parts: string[] = [`v${version.version_number}`];
  if (version.max_chars !== undefined) {
    parts.push(`${version.min_chars}-${version.max_chars} chars`);
  } else if (version.min_chars > 1) {
    parts.push(`${version.min_chars}+ chars`);
  }
  if (version.exact_lines !== undefined) {
    parts.push(`${version.exact_lines} lines`);
  } else if (version.min_lines !== undefined || version.max_lines !== undefined) {
    parts.push(`${version.min_lines ?? 1}-${version.max_lines ?? "any"} lines`);
  }
  if (version.line_max_chars !== undefined) {
    parts.push(`line max ${version.line_max_chars}`);
  }
  if (!version.allow_blank_lines) {
    parts.push("no blank lines");
  }
  return parts.join(" · ");
}

export function shouldShowPostFormat(post: GroupFeedPost): boolean {
  return (
    post.evidence_format.slug !== "plain-text" ||
    post.evidence_format.archived_at !== undefined ||
    post.evidence_format_version.version_number !== 1
  );
}
