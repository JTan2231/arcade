import assert from "node:assert/strict";
import test from "node:test";

import {
  compileTextModel,
  encodeTextFragmentTerm,
  matchSelector,
  serializeSelector,
  verifySelector,
} from "../text-fragments/matcher.mjs";

function unitsFor(text, pathFor = (index) => [index]) {
  return [...text].map((value, index) => ({
    value,
    path: pathFor(index),
    start_offset: 0,
    end_offset: value.length,
    segment: 0,
    hard_boundary: false,
    gaiji: false,
  }));
}

test("selector terms use canonical Text Fragment escaping", () => {
  assert.equal(
    encodeTextFragmentTerm("記号-コンマ, & %"),
    "%E8%A8%98%E5%8F%B7%2D%E3%82%B3%E3%83%B3%E3%83%9E%2C%20%26%20%25",
  );
  assert.equal(
    serializeSelector({
      prefix: "前-夜",
      start: "その,朝",
      end: "帰った。",
      suffix: "次&日",
    }),
    "%E5%89%8D%2D%E5%A4%9C-,%E3%81%9D%E3%81%AE%2C%E6%9C%9D,%E5%B8%B0%E3%81%A3%E3%81%9F%E3%80%82,-%E6%AC%A1%26%E6%97%A5",
  );
});

test("matcher verifies exact DOM boundaries across inline text nodes", () => {
  const text = "前。インラインを越える。後。";
  const units = unitsFor(text, (index) =>
    index < 2 ? [0] : index < 8 ? [1, 0] : [2, 0],
  );
  const start = [..."前。"].length;
  const end = start + [..."インラインを越える。"].length;
  const intended = {
    start: { path: units[start].path, offset: 0 },
    end: { path: units[end - 1].path, offset: 1 },
  };
  const result = verifySelector(
    units,
    { start: "インラインを越える。" },
    intended,
  );
  assert.deepEqual(result, {
    verified: true,
    match_count: 1,
    matches_intended: true,
  });
});

test("prefix and suffix context select only the intended repeated range", () => {
  const text = "甲。対象です。共通。乙。対象です。共通。";
  const units = unitsFor(text);
  const selector = {
    prefix: "乙。",
    start: "対象です。",
    suffix: "共通。",
  };
  const matches = matchSelector(units, selector);
  assert.equal(matches.length, 1);
  assert.equal(
    text.slice(matches[0].start_unit, matches[0].end_unit),
    "対象です。",
  );
});

test("an old short normalized endpoint is not proof of a sentence range", () => {
  const text = "吾輩は猫である。名前はまだ無い。吾輩はここにいる。";
  const units = unitsFor(text);
  const firstSentenceLength = [..."吾輩は猫である。"].length;
  const intended = {
    start: { path: units[0].path, offset: 0 },
    end: { path: units[firstSentenceLength - 1].path, offset: 1 },
  };
  const result = verifySelector(units, { start: "吾輩" }, intended);
  assert.equal(result.verified, false);
  assert.equal(result.match_count, 2);
});

test("terms cannot cross a rendered hard boundary", () => {
  const units = unitsFor("改行前 改行後。");
  units[3].hard_boundary = true;
  units[3].segment = 0;
  for (let index = 4; index < units.length; index += 1)
    units[index].segment = 1;
  assert.equal(matchSelector(units, { start: "改行前 改行後。" }).length, 0);
  assert.equal(
    matchSelector(units, { start: "改行前", end: "改行後。" }).length,
    1,
  );
});

test("ruby annotation segment breaks forbid a synthetic exact term", () => {
  const units = unitsFor("吾輩は猫である。");
  for (let index = 2; index < units.length; index += 1)
    units[index].segment = 1;
  assert.equal(matchSelector(units, { start: "吾輩は猫である。" }).length, 0);
  const ranges = matchSelector(units, {
    start: "吾輩",
    end: "は猫である。",
  });
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start_unit, 0);
  assert.equal(ranges[0].end_unit, units.length);
});

test("WICG word bounds reject a substring inside a word", () => {
  const units = unitsFor("orange range");
  const matches = matchSelector(units, { start: "range" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].start_unit, [..."orange "].length);
});

test("primary Latin folding exposes ambiguity but preserves Japanese dakuten", () => {
  const units = unitsFor("CAFE。café。か。が。");
  const model = compileTextModel(units);
  assert.equal(
    compileTextModel(units),
    model,
    "compiled models are cached per unit array",
  );
  assert.equal(matchSelector(model, { start: "cafe。" }).length, 2);
  assert.equal(matchSelector(model, { start: "か。" }).length, 1);
  assert.equal(matchSelector(model, { start: "が。" }).length, 1);
});

test("primary folding removes non-kana diacritics", () => {
  const units = unitsFor("ά。α。");
  assert.equal(matchSelector(units, { start: "α。" }).length, 2);
});

test("primary folding equates voiced kana iteration marks only", () => {
  const units = unitsFor("ゞ。ゝ。ヾ。ヽ。ガ。カ。");
  const model = compileTextModel(units);
  assert.equal(matchSelector(model, { start: "ゝ。" }).length, 4);
  assert.equal(matchSelector(model, { start: "ヽ。" }).length, 4);
  assert.equal(matchSelector(model, { start: "ガ。" }).length, 1);
  assert.equal(matchSelector(model, { start: "カ。" }).length, 1);
});

test("primary folding mirrors native kana, width, sharp-s, and sigma equivalence", () => {
  const units = unitsFor(
    "カナ。かな。ｶﾅ。ＡＢＣ。abc。Straße。STRASSE。ος。οσ。ガ。ｶﾞ。カ。",
  );
  const model = compileTextModel(units);
  assert.equal(matchSelector(model, { start: "かな。" }).length, 3);
  assert.equal(matchSelector(model, { start: "ABC。" }).length, 2);
  assert.equal(matchSelector(model, { start: "strasse。" }).length, 2);
  assert.equal(matchSelector(model, { start: "οσ。" }).length, 2);
  assert.equal(matchSelector(model, { start: "ガ。" }).length, 2);
  assert.equal(matchSelector(model, { start: "カ。" }).length, 1);
});

test("primary folding applies confirmed Latin expansions only", () => {
  const units = unitsFor(
    "œ。oe。æ。ae。ø。o。ł。l。đ。d。ð。ĳ。ij。þ。th。ŋ。n。ı。i。",
  );
  const model = compileTextModel(units);
  assert.equal(matchSelector(model, { start: "oe。" }).length, 2);
  assert.equal(matchSelector(model, { start: "ae。" }).length, 2);
  assert.equal(matchSelector(model, { start: "o。" }).length, 2);
  assert.equal(matchSelector(model, { start: "l。" }).length, 2);
  assert.equal(matchSelector(model, { start: "d。" }).length, 3);
  assert.equal(matchSelector(model, { start: "ij。" }).length, 2);
  assert.equal(matchSelector(model, { start: "þ。" }).length, 1);
  assert.equal(matchSelector(model, { start: "th。" }).length, 1);
  assert.equal(matchSelector(model, { start: "ŋ。" }).length, 1);
  assert.equal(matchSelector(model, { start: "n。" }).length, 1);
  assert.equal(matchSelector(model, { start: "ı。" }).length, 1);
  assert.equal(matchSelector(model, { start: "i。" }).length, 1);
});

test("range matching owns the first following end term", () => {
  const units = unitsFor("start one end two end");
  const matches = matchSelector(units, { start: "start", end: "end" });
  assert.equal(matches.length, 1);
  assert.equal(
    units
      .slice(matches[0].start_unit, matches[0].end_unit)
      .map((unit) => unit.value)
      .join(""),
    "start one end",
  );
});

test("range matching advances end terms only to satisfy suffix", () => {
  const units = unitsFor("start one end wrong end suffix");
  const matches = matchSelector(units, {
    start: "start",
    end: "end",
    suffix: "suffix",
  });
  assert.equal(matches.length, 1);
  assert.equal(
    units
      .slice(matches[0].start_unit, matches[0].end_unit)
      .map((unit) => unit.value)
      .join(""),
    "start one end wrong end",
  );
});
