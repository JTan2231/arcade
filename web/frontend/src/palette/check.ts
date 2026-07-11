import { colorDistance, cssColorToLinearRgb, luminance } from "./color";
import { arcadeColorTargets, createArcadePalette, defaultScene } from "./defaults";
import { assertPaletteValid } from "./render";
import { arcadeTokenSnapshot } from "./snapshot";
import type { CssTokenMap, CssTokenName } from "./types";

function assertTokenSnapshot(actual: CssTokenMap, expected: CssTokenMap) {
  const actualNames = Object.keys(actual).sort();
  const expectedNames = Object.keys(expected).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("Generated palette token names do not match the checked-in snapshot");
  }

  const changes = expectedNames.flatMap((rawName) => {
    const name = rawName as CssTokenName;
    return actual[name] === expected[name] ? [] : [`${name}: expected ${expected[name]}, received ${actual[name]}`];
  });
  if (changes.length > 0) {
    throw new Error(`Generated palette does not match the checked-in snapshot:\n${changes.join("\n")}`);
  }
}

export function checkArcadePalette() {
  const palette = createArcadePalette();
  assertPaletteValid(palette.validation);
  assertTokenSnapshot(palette.tokens, arcadeTokenSnapshot);

  const targetDistances = Object.entries(arcadeColorTargets).map(([rawName, target]) => {
    const name = rawName as CssTokenName;
    const rendered = palette.colors[name];
    if (rendered === undefined) {
      throw new Error(`Generated palette is missing rendered color ${name}`);
    }
    return colorDistance(rendered.color, cssColorToLinearRgb(target).color);
  });
  const maximumTargetDistance = Math.max(...targetDistances);
  const averageTargetDistance = targetDistances.reduce((sum, distance) => sum + distance, 0) / targetDistances.length;
  const orderedSurfaces = [
    "--color-page",
    "--color-surface",
    "--color-surface-subtle",
    "--color-surface-hover",
    "--color-surface-muted",
  ] as const;

  let previousLuminance = -1;
  for (const name of orderedSurfaces) {
    const rendered = palette.colors[name];
    if (rendered === undefined) {
      throw new Error(`Generated palette is missing ordered surface ${name}`);
    }
    const currentLuminance = luminance(rendered.color);
    if (currentLuminance <= previousLuminance) {
      throw new Error(`Generated surface hierarchy is not increasing at ${name}`);
    }
    previousLuminance = currentLuminance;
  }

  const exposedPalette = createArcadePalette({ ...defaultScene, exposure: defaultScene.exposure * 1.03 });
  for (const name of orderedSurfaces) {
    const original = palette.colors[name];
    const exposed = exposedPalette.colors[name];
    if (original === undefined || exposed === undefined || luminance(exposed.color) <= luminance(original.color)) {
      throw new Error(`${name} did not respond monotonically to increased scene exposure`);
    }
  }

  return Object.freeze({
    tokenNames: Object.freeze(Object.keys(palette.tokens).sort()),
    tokenCount: Object.keys(palette.tokens).length,
    contrastCheckCount: palette.validation.contrast.length,
    distinctionCheckCount: palette.validation.distinction.length,
    responseCheckCount: orderedSurfaces.length,
    maximumTargetDistance,
    averageTargetDistance,
  });
}
