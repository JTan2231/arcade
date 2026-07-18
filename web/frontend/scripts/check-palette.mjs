import { readFileSync } from "node:fs";

import { checkArcadePalette, checkThemePalettes } from "../src/palette/check.ts";

const report = checkArcadePalette();
const themeReport = checkThemePalettes();
const fallbackCss = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const fallbackTokenNames = [
  ...new Set([...fallbackCss.matchAll(/^\s+(--(?:color|shadow|filter)-[a-z0-9-]+):/gm)].map((match) => match[1])),
].sort();
const fallbackCardTokenNames = [
  ...new Set([...fallbackCss.matchAll(/^\s+(--post-card-[a-z0-9-]+):/gm)].map((match) => match[1])),
].sort();

if (JSON.stringify(fallbackTokenNames) !== JSON.stringify(report.tokenNames)) {
  throw new Error("Generated palette tokens do not match the semantic fallback declarations in tokens.css");
}
if (JSON.stringify(fallbackCardTokenNames) !== JSON.stringify(themeReport.cardTokenNames)) {
  throw new Error("Generated card palette tokens do not match the scoped fallback declarations in tokens.css");
}

console.log(
  `Palette: ${report.tokenCount} tokens, ${report.contrastCheckCount} contrast checks, ${report.distinctionCheckCount} distinction checks, ${report.responseCheckCount} response checks`,
);
console.log(
  `Calibration: average OKLab distance ${report.averageTargetDistance.toFixed(4)}, maximum ${report.maximumTargetDistance.toFixed(4)}`,
);
console.log(
  `Themes: ${themeReport.darkProfileId}, ${themeReport.lightProfileId}; ${themeReport.sampleCount} dual-profile card samples`,
);
