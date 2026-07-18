import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { createInterface } from "node:readline";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BrowserExtractor,
  EXTRACTOR_VERSION,
  PROTOCOL_VERSION,
  WorkerError,
} from "../lib/browser-extractor.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const toolDirectory = path.dirname(testDirectory);
const corpusRoot = path.join(testDirectory, "fixtures", "corpus");
const extractor = new BrowserExtractor();

after(async () => {
  await extractor.close();
});

test("Chromium extracts UTF-8 rendered text, metadata, ruby, BR, and gaiji", async () => {
  const result = await extractor.extract({
    source_root: corpusRoot,
    html_path: "cards/000001/files/utf8-rich.html",
    encoding: "UTF-8",
  });

  assert.equal(result.encoding, "UTF-8");
  assert.equal(result.has_text, true);
  assert.equal(result.work_name, "試験作品");
  assert.deepEqual(result.author_names, ["山田 太郎"]);
  assert.doesNotMatch(
    result.main_text,
    /あおぞら|注記|スクリプト|ノースクリプト/,
  );
  assert.match(result.main_text, /青空の本です。/);
  assert.equal(result.occurrences_seen, 7);
  assert.equal(result.selectors_verified, 6);
  assert.equal(result.selectors_rejected, 1);
  assert.equal(result.rejections.gaiji, 1);

  const ruby = result.occurrences.find(
    (occurrence) => occurrence.exact_text === "青空の本です。",
  );
  assert.ok(ruby);
  assert.equal(ruby.selector.verified, true);
  assert.equal(ruby.selector.kind, "range");
  assert.ok(ruby.endpoints.some((endpoint) => endpoint.range_kind === "word"));
  assert.ok(
    ruby.endpoints.some((endpoint) => endpoint.range_kind === "grapheme3"),
  );

  const inline = result.occurrences.find((occurrence) =>
    occurrence.exact_text.startsWith("途中の"),
  );
  assert.ok(inline);
  assert.notDeepEqual(inline.range.start.path, inline.range.end.path);
  assert.equal(inline.selector.kind, "exact");

  const lineBreak = result.occurrences.find((occurrence) =>
    occurrence.exact_text.startsWith("改行の前"),
  );
  assert.ok(lineBreak);
  assert.equal(lineBreak.exact_text, "改行の前 改行の後です。");
  assert.equal(lineBreak.selector.kind, "range");
  assert.ok(lineBreak.selector.end);

  const special = result.occurrences.find((occurrence) =>
    occurrence.exact_text.startsWith("記号-"),
  );
  assert.ok(special);
  assert.match(special.selector.encoded, /%2D/);
  assert.match(special.selector.encoded, /%2C/);
  assert.match(special.selector.encoded, /%26/);
  assert.match(special.selector.encoded, /%25/);
  assert.match(special.selector.encoded, /%20/);
  assert.doesNotMatch(special.selector.encoded, /[&%](?![0-9A-F]{2})/);

  const quoted = result.occurrences.find(
    (occurrence) => occurrence.exact_text === "「末尾の語」。",
  );
  assert.ok(quoted);
  assert.deepEqual(
    quoted.endpoints.map((endpoint) => endpoint.range_kind),
    ["grapheme3"],
  );

  const whitespaceBeforePeriod = result.occurrences.find(
    (occurrence) => occurrence.exact_text === "空白末尾 。",
  );
  assert.ok(whitespaceBeforePeriod);
  assert.deepEqual(
    whitespaceBeforePeriod.endpoints.map((endpoint) => endpoint.range_kind),
    ["grapheme3"],
  );
  assert.equal(whitespaceBeforePeriod.endpoints[0].end_surface, "末尾 ");
});

test("selector generation covers range and every contextual strategy", async () => {
  const result = await extractor.extract({
    source_root: corpusRoot,
    html_path: "cards/000001/files/selectors.html",
  });
  const repeated = result.occurrences.filter(
    (occurrence) => occurrence.exact_text === "同じ文です。",
  );
  assert.equal(repeated.length, 3);
  assert.deepEqual(
    repeated.map((occurrence) => occurrence.selector.strategy).sort(),
    ["exact_prefix", "exact_prefix_suffix", "exact_suffix"],
  );
  assert.ok(
    repeated.every(
      (occurrence) => occurrence.selector.kind === "contextual_exact",
    ),
  );

  const long = result.occurrences.find((occurrence) =>
    occurrence.exact_text.startsWith("Antidisestablishmentarianismあ"),
  );
  assert.ok(long);
  assert.equal(long.selector.strategy, "range");
  assert.equal(long.selector.kind, "range");
  assert.match(long.selector.start, /^Antidisestablishmentarianism/);
  assert.ok(long.sentence_graphemes > 120);

  const longContext = result.occurrences.filter(
    (occurrence) => occurrence.exact_text === "長語対象です。",
  );
  assert.equal(longContext.length, 2);
  assert.ok(
    longContext.every(
      (occurrence) =>
        occurrence.selector.strategy === "exact_prefix" &&
        occurrence.selector.prefix.length > 16,
    ),
  );

  assert.equal(
    result.occurrences.some(
      (occurrence) => occurrence.exact_text === "同文です。",
    ),
    false,
  );
  assert.ok(result.rejections.unmatched_or_ambiguous >= 2);
});

test("Shift-JIS bytes decode through explicit aliases and in-page metadata", async () => {
  const request = {
    source_root: corpusRoot,
    html_path: "cards/000002/files/shift-jis.html",
  };
  const explicit = await extractor.extract({
    ...request,
    encoding: "ShiftJIS",
  });
  assert.equal(explicit.encoding, "Shift_JIS");
  assert.equal(explicit.work_name, "シフト試験");
  assert.equal(explicit.occurrences[0].exact_text, "シフトJISの本文です。");

  const sniffed = await extractor.extract(request);
  assert.equal(sniffed.encoding, "Shift_JIS");
  assert.equal(sniffed.occurrences[1].exact_text, "二番目の文です。");
});

test("the Neko regression rejects a title-owned range and scrolls a safe ruby range", async () => {
  const result = await extractor.extract({
    source_root: corpusRoot,
    html_path: "cards/000148/files/789_14547.html",
    native_sample: true,
  });
  assert.equal(result.work_name, "吾輩は猫である");
  assert.match(result.main_text, /吾輩は猫である。/);
  assert.equal(
    result.occurrences.some(
      (occurrence) => occurrence.exact_text === "吾輩は猫である。",
    ),
    false,
  );
  assert.equal(result.rejections.unmatched_or_ambiguous, 1);
  const sampled = result.occurrences.find(
    (occurrence) => occurrence.index === result.native_sample.occurrence_index,
  );
  assert.equal(sampled.exact_text, "名前はまだ無い。");
  assert.doesNotMatch(sampled.exact_text, /なまえ/);
  assert.equal(sampled.selector.kind, "range");
  assert.equal(result.native_sample.baseline_out_of_view, true);
  assert.equal(result.native_sample.intended_range_in_view, true);
});

test("document-wide verification sees rendered content excluded from linguistic text", async (context) => {
  const cases = [
    {
      name: "outside main",
      file: "search-outside.html",
      exact: "外部衝突の対象文です。",
      simple: false,
    },
    {
      name: "notes",
      file: "search-notes.html",
      exact: "注記衝突の対象文です。",
      simple: false,
    },
    {
      name: "noscript",
      file: "search-noscript.html",
      exact: "ノースクリプト衝突の対象文です。",
      simple: false,
    },
    {
      name: "ruby annotation",
      file: "search-ruby.html",
      exact: "わがはい から始まる十分に長い対象文です。",
      simple: false,
      range: true,
    },
    {
      name: "ruby term boundary",
      file: "search-ruby-boundary.html",
      exact: "表記よみの合成語です。",
      simple: false,
    },
    {
      name: "display none",
      file: "search-hidden.html",
      exact: "非表示対照の対象文です。",
      simple: true,
    },
  ];

  for (const fixture of cases) {
    await context.test(fixture.name, async () => {
      const result = await extractor.extract({
        source_root: corpusRoot,
        html_path: `cards/000001/files/${fixture.file}`,
        native_sample: true,
      });
      const target = result.occurrences.find(
        (occurrence) => occurrence.exact_text === fixture.exact,
      );
      assert.ok(target, `${fixture.name} target must remain publishable`);
      assert.equal(target.selector.verified, true);
      if (fixture.simple) {
        assert.equal(target.selector.strategy, "exact");
      } else {
        assert.notEqual(
          target.selector.strategy,
          fixture.range ? "range" : "exact",
        );
      }
      if (fixture.range) assert.equal(target.selector.kind, "contextual_range");
      assert.equal(result.occurrences_seen, 2);
      assert.deepEqual(result.native_sample, {
        attempted: true,
        occurrence_index: target.index,
        baseline_out_of_view: true,
        intended_range_in_view: true,
      });

      const resolvesFromDocument = await extractor.page.evaluate((range) => {
        function resolve(pathParts) {
          let node = document;
          for (const part of pathParts) node = node?.childNodes[part];
          return node;
        }
        const start = resolve(range.start.path);
        const end = resolve(range.end.path);
        if (!start || !end) return false;
        const resolved = document.createRange();
        try {
          resolved.setStart(start, range.start.offset);
          resolved.setEnd(end, range.end.offset);
        } catch {
          return false;
        }
        return !resolved.collapsed;
      }, target.range);
      assert.equal(resolvesFromDocument, true);
    });
  }
});

test("invalid bodies and unsafe paths are rejected with stable codes", async () => {
  await assert.rejects(
    extractor.extract({
      source_root: corpusRoot,
      html_path: "cards/000001/files/duplicate-main.html",
    }),
    (error) =>
      error instanceof WorkerError && error.code === "invalid_main_text",
  );
  await assert.rejects(
    extractor.extract({
      source_root: corpusRoot,
      html_path: "cards/../outside.html",
    }),
    (error) =>
      error instanceof WorkerError && error.code === "invalid_html_path",
  );
  await assert.rejects(
    extractor.extract({
      source_root: corpusRoot,
      html_path: "cards/000001/files/utf8-rich.html",
      encoding: "EUC-JP",
    }),
    (error) =>
      error instanceof WorkerError && error.code === "unsupported_encoding",
  );
});

test("native sampling reports viewport confirmation without claiming highlighting", async () => {
  const result = await extractor.extract({
    source_root: corpusRoot,
    html_path: "cards/000001/files/native.html",
    native_sample: true,
  });
  assert.deepEqual(result.native_sample, {
    attempted: true,
    occurrence_index: 0,
    baseline_out_of_view: true,
    intended_range_in_view: true,
  });
});

test("stats expose pinned versions and separate DOM/native counters", async () => {
  const stats = await extractor.stats();
  assert.equal(stats.protocol_version, PROTOCOL_VERSION);
  assert.equal(stats.extractor_version, EXTRACTOR_VERSION);
  assert.match(stats.selector_engine_revision, /wicg-b0ac8732fae6/);
  assert.match(stats.playwright_version, /^1\.61\.1$/);
  assert.ok(stats.chromium_version);
  assert.ok(stats.selectors_verified > 0);
  assert.ok(stats.selectors_rejected > 0);
  assert.equal(stats.native_samples_attempted, 8);
  assert.equal(stats.native_samples_in_view, 8);
  assert.equal(stats.native_samples_not_in_view, 0);
});

test("JSONL entrypoint serves multiple requests from one process", async () => {
  const child = spawn(
    process.execPath,
    [path.join(toolDirectory, "extract.mjs")],
    {
      cwd: toolDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const responses = [];
  lines.on("line", (line) => responses.push(JSON.parse(line)));

  child.stdin.write(`${JSON.stringify({ id: "stats", op: "stats" })}\n`);
  child.stdin.write("not-json\n");
  child.stdin.write(`${JSON.stringify({ id: "bye", op: "shutdown" })}\n`);
  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 0);
  assert.equal(responses.length, 3);
  assert.equal(responses[0].id, "stats");
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].result.protocol_version, PROTOCOL_VERSION);
  assert.deepEqual(responses[1], {
    id: null,
    ok: false,
    error: { code: "invalid_json", message: "input line is not valid JSON" },
  });
  assert.deepEqual(responses[2], {
    id: "bye",
    ok: true,
    result: { shutdown: true },
  });
});
