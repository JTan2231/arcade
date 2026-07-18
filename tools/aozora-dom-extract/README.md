# Aozora DOM extraction worker

This directory is the browser-only part of the Aozora catalogue builder. It
serves raw corpus bytes on an ephemeral loopback HTTP server, reuses one pinned
Chromium instance and page, and emits newline-delimited JSON on standard
output. Diagnostics use standard error. It never returns a complete public or
local document URL.

Install and test with:

```sh
npm ci
npx playwright install chromium
npm test
```

Start the long-lived worker with `node extract.mjs`. Requests are processed in
input order and contain an arbitrary scalar `id`, which is copied to the
response.

## Protocol

Extract one document:

```json
{
  "id": 1,
  "op": "extract",
  "source_root": "/absolute/aozora/root",
  "html_path": "cards/000148/files/789_14547.html",
  "encoding": "ShiftJIS",
  "native_sample": false
}
```

`encoding` may be omitted so Chromium sniffs the payload. Accepted explicit
labels are UTF-8 and the common Shift-JIS/Windows-31J aliases. A successful
response has this shape (large arrays abbreviated):

```json
{
  "id": 1,
  "ok": true,
  "result": {
    "html_path": "cards/000148/files/789_14547.html",
    "encoding": "Shift_JIS",
    "has_text": true,
    "work_name": "吾輩は猫である",
    "author_names": ["夏目 漱石"],
    "main_text": "吾輩は猫である。名前はまだ無い。",
    "occurrences_seen": 2,
    "selectors_verified": 2,
    "selectors_rejected": 0,
    "rejections": {
      "gaiji": 0,
      "no_endpoints": 0,
      "unmatched_or_ambiguous": 0
    },
    "native_sample": null,
    "occurrences": [
      {
        "index": 0,
        "exact_text": "吾輩は猫である。",
        "identity_text": "吾輩は猫である。",
        "duplicate_ordinal": 0,
        "sentence_graphemes": 8,
        "range": {
          "start": { "path": [0], "offset": 0 },
          "end": { "path": [0], "offset": 8 }
        },
        "selector": {
          "kind": "range",
          "start": "吾輩",
          "end": "は猫である。",
          "encoded": "%E5%90%BE%E8%BC%A9,%E3%81%AF%E7%8C%AB%E3%81%A7%E3%81%82%E3%82%8B%E3%80%82",
          "strategy": "range",
          "verified": true
        },
        "endpoints": [
          {
            "range_kind": "word",
            "start_surface": "吾輩",
            "end_surface": "ある",
            "start_key": "吾輩",
            "end_key": "ある"
          }
        ]
      }
    ]
  }
}
```

Selector `kind` is one of `exact`, `range`, `contextual_exact`, or
`contextual_range`. `prefix`, `end`, and `suffix` are absent unless used and
are never empty. `encoded` is only the canonical value following `text=`.

Request cumulative provenance and validation counters with
`{"id":2,"op":"stats"}`. The result includes protocol, extractor, pinned
matcher, Playwright, Chromium, and Node versions plus DOM-verification and
native-navigation sample counts. A native sample records only whether the
intended range was out of view at the no-fragment baseline and in view after a
fresh fragment navigation; it does not claim that native highlighting was
observable. Documents with no offscreen verified occurrence are skipped and
do not increment the attempted-sample counter.

Finish with `{"id":3,"op":"shutdown"}`. Errors always retain JSONL framing:

```json
{
  "id": 1,
  "ok": false,
  "error": {
    "code": "invalid_main_text",
    "message": "expected exactly one div.main_text; found 0"
  }
}
```
