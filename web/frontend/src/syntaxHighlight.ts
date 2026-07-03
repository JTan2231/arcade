import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.safeMode();
hljs.configure({
  ignoreUnescapedHTML: true,
  throwUnescapedHTML: false,
});

const HIGHLIGHT_LANGUAGES = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["go", go],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["kotlin", kotlin],
  ["markdown", markdown],
  ["php", php],
  ["python", python],
  ["ruby", ruby],
  ["rust", rust],
  ["shell", shell],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
] as const;

for (const [languageName, language] of HIGHLIGHT_LANGUAGES) {
  hljs.registerLanguage(languageName, language);
}

const AUTO_DETECT_LANGUAGES = hljs.listLanguages();
const MIN_AUTO_DETECT_RELEVANCE = 3;
const CODE_SHAPE_PATTERNS = [
  /[{}()[\];]/,
  /<\/?[a-z][^>]*>/i,
  /(?:^|\n)\s*#include\b/,
  /(?:^|\n)\s*(?:class|const|def|export|from|func|function|if|import|interface|let|package|return|var|while)\b/,
  /(?:^|\n)\s*(?:create|delete|insert|select|update)\s+/i,
  /(?:^|\n)\s*[A-Za-z_$][\w$]*\s*[:=]/,
];

export type PreparedCodeBlock = {
  code: string;
  languageHint: string | null;
};

export type HighlightedCodeBlock = {
  html: string;
  language: string;
};

export function prepareCodeBlock(value: string): PreparedCodeBlock {
  const fencedBlock = parseFencedCodeBlock(value);
  if (fencedBlock !== null) {
    return fencedBlock;
  }

  return {
    code: value,
    languageHint: null,
  };
}

export function highlightCodeBlock(
  displayCode: string,
  detectionCode: string,
  languageHint: string | null,
): HighlightedCodeBlock | null {
  const hintedLanguage = languageHint === null ? null : normalizeLanguage(languageHint);
  if (hintedLanguage !== null) {
    return highlightWithLanguage(displayCode, hintedLanguage);
  }

  const detectedLanguage = detectLanguage(detectionCode);
  if (detectedLanguage === null) {
    return null;
  }

  return highlightWithLanguage(displayCode, detectedLanguage);
}

function parseFencedCodeBlock(value: string): PreparedCodeBlock | null {
  const trimmed = value.trim();
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) {
    return null;
  }

  const firstLine = lines[0];
  if (firstLine === undefined) {
    return null;
  }

  const firstLineMatch = /^(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]*)[^\S\r\n]*.*$/.exec(firstLine);
  if (firstLineMatch === null) {
    return null;
  }

  const fence = firstLineMatch[1];
  if (fence === undefined) {
    return null;
  }

  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined || lastLine.trim() !== fence) {
    return null;
  }

  const rawLanguageHint = firstLineMatch[2]?.trim() ?? "";
  return {
    code: lines.slice(1, -1).join("\n"),
    languageHint: rawLanguageHint === "" ? null : rawLanguageHint,
  };
}

function normalizeLanguage(languageHint: string): string | null {
  const normalized = languageHint
    .trim()
    .toLowerCase()
    .replace(/^language-/, "");
  if (normalized === "" || normalized === "plain" || normalized === "plaintext" || normalized === "text") {
    return null;
  }

  return hljs.getLanguage(normalized) === undefined ? null : normalized;
}

function detectLanguage(code: string): string | null {
  const trimmed = code.trim();
  if (trimmed === "" || !looksLikeCode(trimmed)) {
    return null;
  }

  const syntaxHint = detectLanguageBySyntax(trimmed);
  if (syntaxHint !== null) {
    return syntaxHint;
  }

  const result = hljs.highlightAuto(trimmed, AUTO_DETECT_LANGUAGES);
  if (result.language === undefined || result.relevance < MIN_AUTO_DETECT_RELEVANCE) {
    return null;
  }

  return result.language;
}

function looksLikeCode(code: string): boolean {
  return CODE_SHAPE_PATTERNS.some((pattern) => pattern.test(code));
}

function detectLanguageBySyntax(code: string): string | null {
  if (isJSON(code)) {
    return "json";
  }
  if (/<\/?[a-z][^>]*>/i.test(code)) {
    return "xml";
  }
  if (/\bpackage\s+\w+\b[\s\S]*\bfunc\s+\w+\s*\(/.test(code)) {
    return "go";
  }
  if (/(?:\bdef\s+\w+\s*\([^)]*\):|\bclass\s+\w+\s*(?:\([^)]*\))?:|\bfrom\s+\w+(?:\.\w+)*\s+import\b)/.test(code)) {
    return "python";
  }
  if (/\b(?:interface|type)\s+[A-Z_$][\w$]*\b/.test(code) || /\)\s*:\s*[A-Za-z_$][\w$<>, |[\]]*\s*=>/.test(code)) {
    return "typescript";
  }
  if (/\b(?:const|let|var|function)\b/.test(code) || /\bconsole\.\w+\s*\(/.test(code) || /=>/.test(code)) {
    return "javascript";
  }
  if (/\b(?:select|insert|update|delete|create)\b[\s\S]*\b(?:from|into|set|table|where)\b/i.test(code)) {
    return "sql";
  }
  if (/\bfn\s+\w+\s*\(/.test(code) || /\blet\s+mut\b/.test(code) || /\buse\s+std::/.test(code)) {
    return "rust";
  }
  if (/\bpublic\s+class\s+\w+\b/.test(code) || /\bSystem\.out\.println\s*\(/.test(code)) {
    return "java";
  }
  if (/\busing\s+System\b/.test(code) || /\bConsole\.WriteLine\s*\(/.test(code)) {
    return "csharp";
  }
  if (/\bstd::/.test(code) || /\b(?:cout|cin)\s*(?:<<|>>)/.test(code)) {
    return "cpp";
  }
  if (/#include\s*</.test(code) || /\bint\s+main\s*\(/.test(code)) {
    return "c";
  }
  if (/(?:^|\n)\s*[.#]?[A-Za-z][\w-]*(?:\s+[.#]?[A-Za-z][\w-]*)?\s*\{[\s\S]*\b[A-Za-z-]+\s*:/.test(code)) {
    return "css";
  }
  if (/(?:^|\n)\s*(?:#!\/.*sh|bun|cargo|cd|git|go|mkdir|npm|pnpm|python|rm|yarn)\s+/.test(code)) {
    return "shell";
  }
  if (yamlKeyCount(code) >= 2 || /(?:^|\n)\s*-\s+[A-Za-z0-9_-]+:/.test(code)) {
    return "yaml";
  }

  return null;
}

function isJSON(code: string): boolean {
  if (!/^\s*[{[]/.test(code)) {
    return false;
  }

  try {
    JSON.parse(code);
    return true;
  } catch {
    return false;
  }
}

function yamlKeyCount(code: string): number {
  return code.match(/(?:^|\n)\s*[A-Za-z0-9_-]+:\s*(?:\S|$)/g)?.length ?? 0;
}

function highlightWithLanguage(code: string, language: string): HighlightedCodeBlock | null {
  try {
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return {
      html: result.value,
      language: result.language ?? language,
    };
  } catch {
    return null;
  }
}
