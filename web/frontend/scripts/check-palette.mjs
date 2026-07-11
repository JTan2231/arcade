import { readFileSync } from "node:fs";

import { checkArcadePalette } from "../src/palette/check.ts";

const report = checkArcadePalette();
const fallbackCss = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const fallbackTokenNames = [...fallbackCss.matchAll(/^\s+(--(?:color|shadow|filter)-[a-z0-9-]+):/gm)]
  .map((match) => match[1])
  .sort();

if (JSON.stringify(fallbackTokenNames) !== JSON.stringify(report.tokenNames)) {
  throw new Error("Generated palette tokens do not match the semantic fallback declarations in tokens.css");
}

console.log(
  `Palette: ${report.tokenCount} tokens, ${report.contrastCheckCount} contrast checks, ${report.distinctionCheckCount} distinction checks, ${report.responseCheckCount} response checks`,
);
console.log(
  `Calibration: average OKLab distance ${report.averageTargetDistance.toFixed(4)}, maximum ${report.maximumTargetDistance.toFixed(4)}`,
);
