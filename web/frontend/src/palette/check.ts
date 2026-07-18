import { colorDistance, cssColorToLinearRgb, luminance } from "./color";
import { arcadeColorTargets, createArcadePalette, defaultScene } from "./defaults";
import { assertPaletteValid } from "./render";
import { arcadeTokenSnapshot } from "./snapshot";
import { arcadeLightTokenSnapshot } from "./snapshot";
import {
  cardPaletteTokenNames,
  chalkboardCardPaletteIntent,
  compileCardPaletteForProfile,
  type CardPaletteIntent,
} from "./cardPalette";
import { arcadeDarkProfile, arcadeLightProfile } from "./themeProfiles";
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

function assertSurfaceOrder(
  palette: ReturnType<typeof createArcadePalette>,
  names: ReadonlyArray<CssTokenName>,
  direction: "increasing" | "decreasing",
) {
  let previous: number | null = null;
  for (const name of names) {
    const rendered = palette.colors[name];
    if (rendered === undefined) {
      throw new Error(`Generated palette is missing ordered surface ${name}`);
    }
    const current = luminance(rendered.color);
    if (
      previous !== null &&
      ((direction === "increasing" && current <= previous) || (direction === "decreasing" && current >= previous))
    ) {
      throw new Error(`${direction} surface hierarchy failed at ${name}`);
    }
    previous = current;
  }
}

export function checkThemePalettes() {
  const dark = arcadeDarkProfile.palette;
  const light = arcadeLightProfile.palette;
  assertPaletteValid(dark.validation);
  assertPaletteValid(light.validation);
  assertTokenSnapshot(dark.tokens, arcadeTokenSnapshot);
  assertTokenSnapshot(light.tokens, arcadeLightTokenSnapshot);

  assertSurfaceOrder(
    dark,
    ["--color-page", "--color-surface", "--color-surface-subtle", "--color-surface-hover", "--color-surface-muted"],
    "increasing",
  );
  assertSurfaceOrder(
    light,
    ["--color-surface", "--color-surface-subtle", "--color-surface-hover", "--color-surface-muted"],
    "decreasing",
  );

  const samples: CardPaletteIntent[] = [
    chalkboardCardPaletteIntent,
    ...[0, 60, 120, 180, 240, 300].flatMap((surface_hue) =>
      [0, 50, 100].map(
        (surface_colorfulness): CardPaletteIntent => ({
          accent_colorfulness: null,
          accent_hue: null,
          model: "arcade-pigment-v1",
          surface_colorfulness,
          surface_hue,
        }),
      ),
    ),
  ];
  for (const profile of [arcadeDarkProfile, arcadeLightProfile]) {
    for (const intent of samples) {
      const compiled = compileCardPaletteForProfile(profile, intent);
      if (!compiled.validation.valid) {
        throw new Error(
          `${profile.id} card palette ${intent.surface_hue}/${intent.surface_colorfulness} is invalid:\n${compiled.validation.issues.join("\n")}`,
        );
      }
    }
  }

  const chalkboard = compileCardPaletteForProfile(arcadeDarkProfile, chalkboardCardPaletteIntent);
  const chalkboardGolden = {
    "--post-card-border": "#44745f",
    "--post-card-spotlight": "rgb(137 225 190 / 9%)",
    "--post-card-surface": "#2c4a3e",
  } as const;
  for (const [name, value] of Object.entries(chalkboardGolden)) {
    if (chalkboard.tokens[name as keyof typeof chalkboardGolden] !== value) {
      throw new Error(
        `Chalkboard ${name} expected ${value}, received ${chalkboard.tokens[name as keyof typeof chalkboardGolden]}`,
      );
    }
  }

  return Object.freeze({
    baseTokenNames: Object.freeze(Object.keys(dark.tokens).sort()),
    cardTokenNames: Object.freeze([...cardPaletteTokenNames].sort()),
    darkProfileId: arcadeDarkProfile.id,
    lightProfileId: arcadeLightProfile.id,
    sampleCount: samples.length,
  });
}
