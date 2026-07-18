import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { chromium } from "playwright";

import { generateSelector } from "./selector-generator.mjs";
import {
  compileTextModel,
  SELECTOR_ENGINE_REVISION,
} from "../text-fragments/matcher.mjs";

const require = createRequire(import.meta.url);
const { version: playwrightVersion } = require("playwright/package.json");

export const PROTOCOL_VERSION = "aozora-dom-worker.v1";
export const EXTRACTOR_VERSION = "aozora-dom-extract-v3";

const periodCharacters = new Set(["。", "．", "｡"]);
const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const whitespacePattern = /^[\p{White_Space}\u3000]+$/u;

const mimeTypes = new Map([
  [".css", "text/css"],
  [".gif", "image/gif"],
  [".html", "text/html"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".xml", "application/xml"],
]);

export class WorkerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
  }
}

function normalizeEncodingLabel(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new WorkerError("invalid_encoding", "encoding must be a string");
  }
  const compact = value
    .trim()
    .toLowerCase()
    .replaceAll(/[_\-\s]/g, "");
  if (["utf8", "unicode11utf8"].includes(compact)) return "UTF-8";
  if (
    [
      "shiftjis",
      "sjis",
      "windows31j",
      "mskanji",
      "cp932",
      "csshiftjis",
      "xmscp932",
    ].includes(compact)
  ) {
    return "Shift_JIS";
  }
  throw new WorkerError(
    "unsupported_encoding",
    `unsupported HTML encoding label: ${value}`,
  );
}

function validateHTMLPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkerError("invalid_html_path", "html_path must be nonempty");
  }
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new WorkerError(
      "invalid_html_path",
      "html_path is not a safe relative path",
    );
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new WorkerError(
      "invalid_html_path",
      "html_path contains an unsafe segment",
    );
  }
  if (
    path.posix.normalize(value) !== value ||
    !value.toLowerCase().endsWith(".html")
  ) {
    throw new WorkerError(
      "invalid_html_path",
      "html_path must identify an HTML file",
    );
  }
  return value;
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function cleanMetadataText(value) {
  return (value ?? "")
    .normalize("NFC")
    .replaceAll(/[\p{White_Space}\u3000]+/gu, " ")
    .trim();
}

function identityText(value) {
  return cleanMetadataText(value);
}

export function kanaSoundKey(value) {
  let output = "";
  for (const character of value.normalize("NFKD")) {
    const codePoint = character.codePointAt(0);
    if (
      (codePoint >= 0x30a1 && codePoint <= 0x30f6) ||
      codePoint === 0x30fd ||
      codePoint === 0x30fe
    ) {
      output += String.fromCodePoint(codePoint - 0x60);
    } else {
      output += character;
    }
  }
  return output.normalize("NFC");
}

function sentenceEndpoints(exactText) {
  // Remove exactly the recognized terminal period. Rendered whitespace is
  // still linguistic input: trimming it would falsely make a word adjacent
  // to the period and would change literal grapheme endpoint surfaces.
  const analysis = exactText.slice(0, -1);
  if (!analysis) return [];
  const endpoints = [];
  const words = [...wordSegmenter.segment(analysis)].filter(
    (segment) => segment.isWordLike,
  );
  // Preserve the prototype's period-adjacent ending rule. A closing quote or
  // other punctuation between the final word and terminal period makes the
  // word projection ineligible, while grapheme3 remains literal and adjacent.
  if (
    words.length > 0 &&
    words[words.length - 1].index + words[words.length - 1].segment.length ===
      analysis.length
  ) {
    const start = words[0].segment;
    const end = words[words.length - 1].segment;
    endpoints.push({
      range_kind: "word",
      start_surface: start,
      end_surface: end,
      start_key: kanaSoundKey(start),
      end_key: kanaSoundKey(end),
    });
  }
  const graphemes = [...graphemeSegmenter.segment(analysis)].map(
    (segment) => segment.segment,
  );
  if (graphemes.length >= 3) {
    const start = graphemes.slice(0, 3).join("");
    const end = graphemes.slice(-3).join("");
    endpoints.push({
      range_kind: "grapheme3",
      start_surface: start,
      end_surface: end,
      start_key: kanaSoundKey(start),
      end_key: kanaSoundKey(end),
    });
  }
  return endpoints;
}

function boundaryStart(unit) {
  return { path: unit.path, offset: unit.start_offset };
}

function boundaryEnd(unit) {
  return { path: unit.path, offset: unit.end_offset };
}

function trimUnitStart(units, start, end) {
  while (
    start < end &&
    !units[start].gaiji &&
    whitespacePattern.test(units[start].value)
  ) {
    start += 1;
  }
  return start;
}

function buildOccurrences(units, searchUnits = units) {
  const matcherModel = compileTextModel(searchUnits);
  const verified = [];
  const duplicates = new Map();
  const rejection = {
    gaiji: 0,
    no_endpoints: 0,
    unmatched_or_ambiguous: 0,
  };
  let occurrencesSeen = 0;
  let sentenceStart = 0;

  for (let periodIndex = 0; periodIndex < units.length; periodIndex += 1) {
    if (!periodCharacters.has(units[periodIndex].value)) continue;
    const start = trimUnitStart(units, sentenceStart, periodIndex);
    sentenceStart = periodIndex + 1;
    if (start >= periodIndex) continue;

    occurrencesSeen += 1;
    const selected = units.slice(start, periodIndex + 1);
    const exactText = selected.map((unit) => unit.value).join("");
    const identity = identityText(exactText);
    const duplicateOrdinal = duplicates.get(identity) ?? 0;
    duplicates.set(identity, duplicateOrdinal + 1);
    if (selected.some((unit) => unit.gaiji)) {
      rejection.gaiji += 1;
      continue;
    }

    const endpoints = sentenceEndpoints(exactText);
    if (endpoints.length === 0) {
      rejection.no_endpoints += 1;
      continue;
    }
    const range = {
      start: boundaryStart(units[start]),
      end: boundaryEnd(units[periodIndex]),
    };
    const selector = generateSelector(
      units,
      {
        start_unit: start,
        end_unit: periodIndex + 1,
        range,
      },
      matcherModel,
    );
    if (!selector) {
      rejection.unmatched_or_ambiguous += 1;
      continue;
    }

    verified.push({
      index: occurrencesSeen - 1,
      exact_text: exactText,
      identity_text: identity,
      duplicate_ordinal: duplicateOrdinal,
      sentence_graphemes: [...graphemeSegmenter.segment(exactText)].length,
      range,
      selector,
      endpoints,
    });
  }

  return { verified, occurrencesSeen, rejection };
}

class LocalCorpusServer {
  constructor() {
    this.registrations = new Map();
    this.server = null;
    this.origin = null;
  }

  async start() {
    if (this.server) return;
    this.server = createServer((request, response) => {
      this.serve(request, response).catch((error) => {
        response.statusCode = 500;
        response.end("local corpus server error");
        process.stderr.write(`aozora local server: ${error.message}\n`);
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async register(sourceRoot, htmlPath, encoding) {
    await this.start();
    const root = await realpath(sourceRoot).catch(() => {
      throw new WorkerError(
        "source_root_not_found",
        "source_root does not exist",
      );
    });
    const info = await stat(root);
    if (!info.isDirectory()) {
      throw new WorkerError(
        "invalid_source_root",
        "source_root is not a directory",
      );
    }
    const relative = validateHTMLPath(htmlPath);
    const target = await realpath(
      path.join(root, ...relative.split("/")),
    ).catch(() => {
      throw new WorkerError(
        "document_not_found",
        "selected HTML document does not exist",
      );
    });
    if (!pathWithin(root, target)) {
      throw new WorkerError(
        "invalid_html_path",
        "html_path escapes source_root",
      );
    }
    const targetInfo = await stat(target);
    if (!targetInfo.isFile()) {
      throw new WorkerError(
        "document_not_found",
        "selected HTML document is not a file",
      );
    }
    const token = randomBytes(18).toString("hex");
    this.registrations.set(token, { root, relative, target, encoding });
    return {
      token,
      navigationURL: `${this.origin}/document/${token}/${relative
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    };
  }

  unregister(token) {
    this.registrations.delete(token);
  }

  async serve(request, response) {
    const incoming = new URL(request.url, this.origin);
    const match = /^\/document\/([a-f0-9]+)\/(.+)$/u.exec(incoming.pathname);
    if (!match) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    const registration = this.registrations.get(match[1]);
    if (!registration) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    let relative;
    try {
      relative = match[2]
        .split("/")
        .map((part) => decodeURIComponent(part))
        .join("/");
    } catch {
      response.statusCode = 400;
      response.end("bad path");
      return;
    }
    if (
      relative.startsWith("/") ||
      relative.includes("\\") ||
      relative.split("/").some((part) => part === ".." || part === ".")
    ) {
      response.statusCode = 403;
      response.end("forbidden");
      return;
    }
    const candidate = path.resolve(registration.root, ...relative.split("/"));
    if (!pathWithin(registration.root, candidate)) {
      response.statusCode = 403;
      response.end("forbidden");
      return;
    }
    const resolvedCandidate = await realpath(candidate).catch(() => null);
    if (!resolvedCandidate) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    if (!pathWithin(registration.root, resolvedCandidate)) {
      response.statusCode = 403;
      response.end("forbidden");
      return;
    }
    const file = await readFile(resolvedCandidate).catch(() => null);
    if (!file) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    const extension = path.extname(resolvedCandidate).toLowerCase();
    let contentType = mimeTypes.get(extension) ?? "application/octet-stream";
    if (
      path.resolve(resolvedCandidate) === path.resolve(registration.target) &&
      registration.encoding
    ) {
      contentType += `; charset=${registration.encoding}`;
    }
    response.setHeader("Content-Type", contentType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(file);
  }

  async close() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.origin = null;
    this.registrations.clear();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function extractDOMModel(page) {
  return page.evaluate(() => {
    const bodies = document.querySelectorAll("div.main_text");
    if (bodies.length !== 1) {
      return {
        error: {
          code: "invalid_main_text",
          message: `expected exactly one div.main_text; found ${bodies.length}`,
        },
      };
    }
    const main = bodies[0];
    const linguistic = { units: [], segment: 0 };
    const searchable = { units: [], segment: 0 };
    const blockDisplays = new Set([
      "block",
      "table",
      "flow-root",
      "grid",
      "flex",
      "list-item",
    ]);
    const nonRenderedTags = new Set(["SCRIPT", "STYLE", "TEMPLATE"]);

    function nodePath(node) {
      const result = [];
      while (node && node !== document) {
        const parent = node.parentNode;
        if (!parent) return [];
        result.push(Array.prototype.indexOf.call(parent.childNodes, node));
        node = parent;
      }
      return result.reverse();
    }

    function pushUnit(
      collector,
      value,
      node,
      startOffset,
      endOffset,
      extra = {},
    ) {
      collector.units.push({
        value,
        path: nodePath(node),
        start_offset: startOffset,
        end_offset: endOffset,
        segment: collector.segment,
        hard_boundary: false,
        gaiji: false,
        ...extra,
      });
    }

    function hardSpace(collector, node) {
      if (
        collector.units.length > 0 &&
        /^\s$/u.test(collector.units.at(-1).value)
      ) {
        collector.units.at(-1).hard_boundary = true;
      } else if (collector.units.length > 0) {
        pushUnit(collector, " ", node, 0, 0, { hard_boundary: true });
      }
      collector.segment += 1;
    }

    function selectorBreak(collector) {
      collector.segment += 1;
    }

    function appendText(collector, node) {
      const style = getComputedStyle(node.parentElement);
      if (style.visibility !== "visible") return;
      const preserve = ["pre", "pre-wrap", "break-spaces"].includes(
        style.whiteSpace,
      );
      const data = node.data;
      for (let offset = 0; offset < data.length; ) {
        const codePoint = data.codePointAt(offset);
        const value = String.fromCodePoint(codePoint);
        const width = value.length;
        if (!preserve && /^[\t\n\f\r ]$/u.test(value)) {
          const runStart = offset;
          offset += width;
          while (offset < data.length && /^[\t\n\f\r ]$/u.test(data[offset])) {
            offset += 1;
          }
          if (
            collector.units.length === 0 ||
            !/^\s$/u.test(collector.units.at(-1).value)
          ) {
            pushUnit(collector, " ", node, runStart, offset);
          } else if (
            collector.units.at(-1).path.join(".") === nodePath(node).join(".")
          ) {
            collector.units.at(-1).end_offset = offset;
          }
          continue;
        }
        pushUnit(collector, value, node, offset, offset + width);
        offset += width;
      }
    }

    function isGaiji(element) {
      const source = element.getAttribute("src") ?? "";
      return (
        element.classList.contains("gaiji") ||
        element.hasAttribute("gaiji") ||
        /(^|\/)gaiji\//u.test(source)
      );
    }

    function renderedStyle(element) {
      const style = getComputedStyle(element);
      if (
        style.display === "none" ||
        style.contentVisibility === "hidden" ||
        element.hasAttribute("inert")
      ) {
        return null;
      }
      return style;
    }

    function hasSearchableContent(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (
            child.data.length > 0 &&
            getComputedStyle(child.parentElement).visibility === "visible"
          ) {
            return true;
          }
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (nonRenderedTags.has(child.tagName)) continue;
        const style = renderedStyle(child);
        if (!style) continue;
        if (
          style.visibility === "visible" &&
          (child.tagName === "IMG" || child.tagName === "BR")
        ) {
          return true;
        }
        if (hasSearchableContent(child)) return true;
      }
      return false;
    }

    function visitSearch(node, root) {
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(searchable, node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node;
      if (nonRenderedTags.has(element.tagName)) return;
      const style = renderedStyle(element);
      if (!style) return;
      if (element.tagName === "IMG") {
        if (style.visibility === "visible") selectorBreak(searchable);
        return;
      }
      if (element.tagName === "BR") {
        if (style.visibility === "visible") hardSpace(searchable, element);
        return;
      }
      const block =
        style.visibility === "visible" &&
        element !== root &&
        blockDisplays.has(style.display);
      if (block) hardSpace(searchable, element);
      for (const child of element.childNodes) visitSearch(child, root);
      if (block) hardSpace(searchable, element);
    }

    function visitLinguistic(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(linguistic, node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node;
      if (nonRenderedTags.has(element.tagName)) return;
      const style = renderedStyle(element);
      if (!style) return;
      if (element.tagName === "NOSCRIPT") {
        // JavaScript is disabled, so this content participates in native
        // search. It remains non-linguistic and interrupts an exact term.
        if (hasSearchableContent(element)) selectorBreak(linguistic);
        return;
      }
      if (element.matches("span.notes")) {
        if (hasSearchableContent(element)) hardSpace(linguistic, element);
        return;
      }
      if (element.matches("rt, rp")) {
        // Keep ruby readings out of sentence/end-point text while preventing
        // a synthetic exact term across the annotation or visible fallback.
        if (hasSearchableContent(element)) selectorBreak(linguistic);
        return;
      }
      if (element.tagName === "IMG") {
        if (style.visibility !== "visible") return;
        if (isGaiji(element)) {
          hardSpace(linguistic, element);
          pushUnit(linguistic, "\uFFFC", element, 0, 0, { gaiji: true });
          hardSpace(linguistic, element);
        } else {
          selectorBreak(linguistic);
        }
        return;
      }
      if (element.tagName === "BR") {
        if (style.visibility === "visible") hardSpace(linguistic, element);
        return;
      }
      const block =
        style.visibility === "visible" &&
        element !== main &&
        blockDisplays.has(style.display);
      if (block) hardSpace(linguistic, element);
      for (const child of element.childNodes) visitLinguistic(child);
      if (block) hardSpace(linguistic, element);
    }

    function trimCollector(collector) {
      while (
        collector.units.length > 0 &&
        /^\s$/u.test(collector.units[0].value)
      ) {
        collector.units.shift();
      }
      while (
        collector.units.length > 0 &&
        /^\s$/u.test(collector.units.at(-1).value)
      ) {
        collector.units.pop();
      }
    }

    const searchRoot = document.body ?? document.documentElement;
    visitSearch(searchRoot, searchRoot);
    visitLinguistic(main);
    trimCollector(searchable);
    trimCollector(linguistic);

    function metadataText(selector) {
      const element = document.querySelector(selector);
      return element?.textContent ?? "";
    }

    let workName = metadataText(".metadata .title, h1.title");
    if (!workName) {
      workName =
        document
          .querySelector('meta[name="DC.Title" i]')
          ?.getAttribute("content") ?? "";
    }
    if (!workName) workName = document.title;
    let authorNames = [
      ...document.querySelectorAll(".metadata .author, h2.author"),
    ].map((element) => element.textContent ?? "");
    if (authorNames.length === 0) {
      const creator = document
        .querySelector('meta[name="DC.Creator" i]')
        ?.getAttribute("content");
      if (creator) authorNames = [creator];
    }

    return {
      units: linguistic.units,
      search_units: searchable.units,
      work_name: workName,
      author_names: authorNames,
      character_set: document.characterSet,
    };
  });
}

function nativeSampleIndex(htmlPath, occurrences) {
  if (occurrences.length === 0) return -1;
  const digest = createHash("sha256").update(htmlPath).digest();
  return digest.readUInt32BE(0) % occurrences.length;
}

async function rangesInView(page, occurrences) {
  await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: "instant" }));
  return page.evaluate(
    (rangeDescriptions) => {
      const main = document.querySelector("div.main_text");
      if (!main) return rangeDescriptions.map(() => false);
      function resolve(pathParts) {
        let node = document;
        for (const part of pathParts) node = node?.childNodes[part];
        return node;
      }
      return rangeDescriptions.map((rangeDescription) => {
        const start = resolve(rangeDescription.start.path);
        const end = resolve(rangeDescription.end.path);
        if (!start || !end) return false;
        const range = document.createRange();
        try {
          range.setStart(start, rangeDescription.start.offset);
          range.setEnd(end, rangeDescription.end.offset);
        } catch {
          return false;
        }
        return [...range.getClientRects()].some(
          (rect) =>
            rect.bottom >= 0 &&
            rect.right >= 0 &&
            rect.top <= innerHeight &&
            rect.left <= innerWidth,
        );
      });
    },
    occurrences.map((occurrence) => occurrence.range),
  );
}

async function checkNativeNavigation(page, navigationURL, occurrence) {
  // Do not let Chromium optimize this into a same-document hash navigation;
  // the sampled check is explicitly a fresh parse/navigation of raw bytes.
  await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  await page.goto(`${navigationURL}#:~:text=${occurrence.selector.encoded}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(100);
  return page.evaluate((rangeDescription) => {
    const main = document.querySelector("div.main_text");
    if (!main) return false;
    function resolve(pathParts) {
      let node = document;
      for (const part of pathParts) node = node?.childNodes[part];
      return node;
    }
    const start = resolve(rangeDescription.start.path);
    const end = resolve(rangeDescription.end.path);
    if (!start || !end) return false;
    const range = document.createRange();
    try {
      range.setStart(start, rangeDescription.start.offset);
      range.setEnd(end, rangeDescription.end.offset);
    } catch {
      return false;
    }
    return [...range.getClientRects()].some(
      (rect) =>
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= innerHeight &&
        rect.left <= innerWidth,
    );
  }, occurrence.range);
}

export class BrowserExtractor {
  constructor() {
    this.localServer = new LocalCorpusServer();
    this.browser = null;
    this.context = null;
    this.page = null;
    this.chromiumVersion = null;
    this.counters = {
      documents_processed: 0,
      documents_with_text: 0,
      documents_rejected: 0,
      occurrences_seen: 0,
      selectors_verified: 0,
      selectors_rejected: 0,
      gaiji_rejections: 0,
      no_endpoint_rejections: 0,
      unmatched_or_ambiguous_rejections: 0,
      native_samples_attempted: 0,
      native_samples_in_view: 0,
      native_samples_not_in_view: 0,
    };
  }

  async ensureStarted() {
    if (this.browser) return;
    await this.localServer.start();
    this.browser = await chromium.launch({ headless: true });
    this.chromiumVersion = this.browser.version();
    this.context = await this.browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 800 },
    });
    const origin = this.localServer.origin;
    await this.context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === "about:") {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    this.page = await this.context.newPage();
  }

  async extract(request) {
    await this.ensureStarted();
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new WorkerError(
        "invalid_request",
        "extract request must be an object",
      );
    }
    if (typeof request.source_root !== "string" || !request.source_root) {
      throw new WorkerError(
        "invalid_source_root",
        "source_root must be nonempty",
      );
    }
    const htmlPath = validateHTMLPath(request.html_path);
    const encoding = normalizeEncodingLabel(request.encoding);
    const registration = await this.localServer.register(
      request.source_root,
      htmlPath,
      encoding,
    );
    try {
      await this.page.goto(registration.navigationURL, {
        waitUntil: "domcontentloaded",
      });
      const model = await extractDOMModel(this.page);
      if (model.error) {
        throw new WorkerError(model.error.code, model.error.message);
      }
      const extracted = buildOccurrences(model.units, model.search_units);
      const workName = cleanMetadataText(model.work_name);
      const authorNames = [
        ...new Set(model.author_names.map(cleanMetadataText).filter(Boolean)),
      ];
      const hasText = model.units.some(
        (unit) => !unit.gaiji && !whitespacePattern.test(unit.value),
      );
      let nativeSample = null;
      if (request.native_sample === true && extracted.verified.length > 0) {
        const baseline = await rangesInView(this.page, extracted.verified);
        const offscreen = extracted.verified.filter(
          (_, index) => !baseline[index],
        );
        if (offscreen.length === 0) {
          nativeSample = {
            attempted: false,
            skipped_reason: "no_offscreen_verified_occurrence",
          };
        } else {
          const index = nativeSampleIndex(htmlPath, offscreen);
          this.counters.native_samples_attempted += 1;
          const inView = await checkNativeNavigation(
            this.page,
            registration.navigationURL,
            offscreen[index],
          );
          if (inView) this.counters.native_samples_in_view += 1;
          else this.counters.native_samples_not_in_view += 1;
          nativeSample = {
            attempted: true,
            occurrence_index: offscreen[index].index,
            baseline_out_of_view: true,
            intended_range_in_view: inView,
          };
        }
      }

      this.counters.documents_processed += 1;
      if (hasText) this.counters.documents_with_text += 1;
      this.counters.occurrences_seen += extracted.occurrencesSeen;
      this.counters.selectors_verified += extracted.verified.length;
      const rejected =
        extracted.rejection.gaiji +
        extracted.rejection.no_endpoints +
        extracted.rejection.unmatched_or_ambiguous;
      this.counters.selectors_rejected += rejected;
      this.counters.gaiji_rejections += extracted.rejection.gaiji;
      this.counters.no_endpoint_rejections += extracted.rejection.no_endpoints;
      this.counters.unmatched_or_ambiguous_rejections +=
        extracted.rejection.unmatched_or_ambiguous;

      return {
        html_path: htmlPath,
        encoding: model.character_set,
        has_text: hasText,
        work_name: workName,
        author_names: authorNames,
        main_text: model.units
          .filter((unit) => !unit.gaiji)
          .map((unit) => unit.value)
          .join(""),
        occurrences_seen: extracted.occurrencesSeen,
        selectors_verified: extracted.verified.length,
        selectors_rejected: rejected,
        rejections: extracted.rejection,
        native_sample: nativeSample,
        occurrences: extracted.verified,
      };
    } catch (error) {
      this.counters.documents_rejected += 1;
      throw error;
    } finally {
      this.localServer.unregister(registration.token);
    }
  }

  async stats() {
    await this.ensureStarted();
    return {
      protocol_version: PROTOCOL_VERSION,
      extractor_version: EXTRACTOR_VERSION,
      selector_engine_revision: SELECTOR_ENGINE_REVISION,
      node_version: process.version,
      playwright_version: playwrightVersion,
      chromium_version: this.chromiumVersion,
      ...this.counters,
    };
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    await this.localServer.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
