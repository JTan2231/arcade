import {
  black,
  clamp,
  clampGamut,
  colorDistance,
  contrastRatio,
  linearRgbToCss,
  linearRgbToOklch,
  luminance,
  mix,
  oklchToLinearRgb,
} from "./color";
import { renderToken } from "./render";
import {
  arcadeDarkProfile,
  arcadeLightProfile,
  getActiveThemeProfile,
  getThemeProfile,
  type ThemeMode,
  type ThemeProfile,
  type ThemeProfileId,
} from "./themeProfiles";
import type { CssTokenMap, LinearRgb, Material, RenderedColor, TokenRecipe } from "./types";

export const cardPaletteTokenNames = Object.freeze([
  "--post-card-surface",
  "--post-card-surface-dim",
  "--post-card-border",
  "--post-card-border-dim",
  "--post-card-text",
  "--post-card-text-dim",
  "--post-card-muted",
  "--post-card-muted-dim",
  "--post-card-accent",
  "--post-card-control-surface",
  "--post-card-control-border",
  "--post-card-control-text",
  "--post-card-control-hover",
  "--post-card-spotlight",
  "--post-card-spotlight-transparent",
  "--post-card-syntax-attribute",
  "--post-card-syntax-attribute-dim",
  "--post-card-syntax-comment",
  "--post-card-syntax-comment-dim",
  "--post-card-syntax-keyword",
  "--post-card-syntax-keyword-dim",
  "--post-card-syntax-literal",
  "--post-card-syntax-literal-dim",
  "--post-card-syntax-meta",
  "--post-card-syntax-meta-dim",
  "--post-card-syntax-string",
  "--post-card-syntax-string-dim",
  "--post-card-syntax-title",
  "--post-card-syntax-title-dim",
] as const);

export type CardPaletteTokenName = (typeof cardPaletteTokenNames)[number];

export type CardPaletteIntent = Readonly<{
  accent_colorfulness?: number | null;
  accent_hue?: number | null;
  model: "arcade-pigment-v1";
  surface_colorfulness: number;
  surface_hue: number;
}>;

export type CanonicalCardPaletteIntent = Readonly<{
  accent_colorfulness: number | null;
  accent_hue: number | null;
  model: "arcade-pigment-v1";
  surface_colorfulness: number;
  surface_hue: number;
}>;

export type CardPaletteValidation = Readonly<{
  issues: ReadonlyArray<string>;
  valid: boolean;
}>;

export type CompiledCardPalette = Readonly<{
  colors: Readonly<Record<CardPaletteTokenName, RenderedColor>>;
  intent: CanonicalCardPaletteIntent;
  profileId: ThemeProfileId;
  tokens: Readonly<Record<CardPaletteTokenName, string>>;
  validation: CardPaletteValidation;
}>;

export type CompiledCardPalettePair = Readonly<{
  dark: CompiledCardPalette;
  light: CompiledCardPalette;
}>;

export type CardPaletteCssProperties = Readonly<Record<CardPaletteTokenName, string>>;

export const chalkboardCardPaletteIntent: CanonicalCardPaletteIntent = Object.freeze({
  accent_colorfulness: 74,
  accent_hue: 173,
  model: "arcade-pigment-v1",
  surface_colorfulness: 95,
  surface_hue: 167,
});

const surfacePigmentLightness = 0.7092;
const surfacePigmentChroma = 0.14075;
const accentPigmentLightness = 0.8586;
const accentPigmentChroma = 0.14;
const borderPigmentLightness = 0.51685;
const borderPigmentChroma = 0.08525;
const opaqueRecipe: TokenRecipe = Object.freeze({ material: "card", elevation: 0, occlusion: 0, rim: 0 });

const syntaxRoleSources = Object.freeze({
  "--post-card-syntax-attribute": "--color-code-attribute",
  "--post-card-syntax-comment": "--color-code-comment",
  "--post-card-syntax-keyword": "--color-code-keyword",
  "--post-card-syntax-literal": "--color-code-literal",
  "--post-card-syntax-meta": "--color-code-meta",
  "--post-card-syntax-string": "--color-code-string",
  "--post-card-syntax-title": "--color-code-title",
} as const);

function canonicalInteger(name: string, value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function canonicalizeCardPaletteIntent(intent: CardPaletteIntent): CanonicalCardPaletteIntent {
  if (intent.model !== "arcade-pigment-v1") {
    throw new Error(`Unsupported card palette model ${JSON.stringify(intent.model)}`);
  }

  const accentHue = intent.accent_hue ?? null;
  const accentColorfulness = intent.accent_colorfulness ?? null;
  if ((accentHue === null) !== (accentColorfulness === null)) {
    throw new Error("accent_hue and accent_colorfulness must either both be set or both be null");
  }

  return Object.freeze({
    accent_colorfulness:
      accentColorfulness === null ? null : canonicalInteger("accent_colorfulness", accentColorfulness, 0, 100),
    accent_hue: accentHue === null ? null : canonicalInteger("accent_hue", accentHue, 0, 359),
    model: "arcade-pigment-v1",
    surface_colorfulness: canonicalInteger("surface_colorfulness", intent.surface_colorfulness, 0, 100),
    surface_hue: canonicalInteger("surface_hue", intent.surface_hue, 0, 359),
  });
}

function reflectiveMaterial(color: LinearRgb): Material {
  return Object.freeze({
    albedo: color,
    metalness: 0,
    roughness: 0.82,
    specularIntensity: 0.08,
    emissivity: black,
    translucency: 0,
  });
}

function emissiveMaterial(color: LinearRgb): Material {
  return Object.freeze({
    albedo: black,
    metalness: 0,
    roughness: 1,
    specularIntensity: 0,
    emissivity: color,
    translucency: 0,
  });
}

function renderMaterial(profile: ThemeProfile, material: Material, alpha = 1) {
  return renderToken(profile.scene, material, { ...opaqueRecipe, ...(alpha < 1 ? { alpha } : {}) });
}

function shortestHueMix(first: number, second: number, amount: number) {
  const delta = ((second - first + 540) % 360) - 180;
  return (first + delta * amount + 360) % 360;
}

function resolvedAccent(intent: CanonicalCardPaletteIntent) {
  return {
    colorfulness: intent.accent_colorfulness ?? Math.max(24, Math.round(intent.surface_colorfulness * 0.78)),
    hue: intent.accent_hue ?? intent.surface_hue,
  };
}

function renderDarkSurface(profile: ThemeProfile, intent: CanonicalCardPaletteIntent) {
  const pigment = clampGamut(
    oklchToLinearRgb({
      l: surfacePigmentLightness,
      c: (intent.surface_colorfulness / 100) * surfacePigmentChroma,
      h: intent.surface_hue,
    }),
  );
  return renderToken(profile.scene, reflectiveMaterial(pigment), {
    material: "card",
    elevation: -0.45,
    occlusion: 0.62,
    rim: 0.02,
  });
}

function renderLightSurface(profile: ThemeProfile, intent: CanonicalCardPaletteIntent) {
  const color = clampGamut(
    oklchToLinearRgb({
      l: 0.925,
      c: (intent.surface_colorfulness / 100) * 0.055,
      h: intent.surface_hue,
    }),
  );
  return renderMaterial(profile, emissiveMaterial(color));
}

function renderSurface(profile: ThemeProfile, intent: CanonicalCardPaletteIntent) {
  return profile.mode === "dark" ? renderDarkSurface(profile, intent) : renderLightSurface(profile, intent);
}

function renderAccent(profile: ThemeProfile, intent: CanonicalCardPaletteIntent, alpha = 1) {
  const accent = resolvedAccent(intent);
  const color = clampGamut(
    oklchToLinearRgb(
      profile.mode === "dark"
        ? {
            l: accentPigmentLightness,
            c: (accent.colorfulness / 100) * accentPigmentChroma,
            h: accent.hue,
          }
        : {
            l: 0.52,
            c: (accent.colorfulness / 100) * 0.13,
            h: accent.hue,
          },
    ),
  );
  return renderMaterial(profile, emissiveMaterial(color), alpha);
}

function renderBorder(profile: ThemeProfile, intent: CanonicalCardPaletteIntent) {
  const accent = resolvedAccent(intent);
  const hue = shortestHueMix(intent.surface_hue, accent.hue, 0.5);
  const color = clampGamut(
    oklchToLinearRgb(
      profile.mode === "dark"
        ? {
            l: borderPigmentLightness,
            c: (intent.surface_colorfulness / 100) * borderPigmentChroma,
            h: hue,
          }
        : {
            l: 0.63,
            c: (intent.surface_colorfulness / 100) * 0.075,
            h: hue,
          },
    ),
  );
  return renderMaterial(profile, emissiveMaterial(color));
}

function rendered(color: LinearRgb, alpha = 1): RenderedColor {
  return Object.freeze({ color: clampGamut(color), alpha });
}

function profileColor(profile: ThemeProfile, name: keyof typeof profile.palette.colors) {
  const color = profile.palette.colors[name];
  if (color === undefined) {
    throw new Error(`Theme profile ${profile.id} is missing ${name}`);
  }
  return color;
}

function ensureContrast(foreground: LinearRgb, background: LinearRgb, minimum: number) {
  if (contrastRatio(foreground, background) >= minimum) {
    return foreground;
  }

  const source = linearRgbToOklch(foreground);
  const seekLighter = luminance(background) < 0.5;
  let passing = seekLighter ? 1 : 0;
  let failing = source.l;

  for (let index = 0; index < 32; index += 1) {
    const lightness = (passing + failing) / 2;
    const candidate = clampGamut(oklchToLinearRgb({ ...source, l: lightness }));
    if (contrastRatio(candidate, background) >= minimum) {
      passing = lightness;
    } else {
      failing = lightness;
    }
  }

  const adjusted = clampGamut(oklchToLinearRgb({ ...source, l: passing }));
  if (contrastRatio(adjusted, background) >= minimum) {
    return adjusted;
  }
  return seekLighter ? Object.freeze({ r: 1, g: 1, b: 1 }) : black;
}

function validateCompiledCardPalette(colors: Record<CardPaletteTokenName, RenderedColor>): CardPaletteValidation {
  const issues: string[] = [];
  const contrastChecks: ReadonlyArray<readonly [CardPaletteTokenName, CardPaletteTokenName, number]> = [
    ["--post-card-text", "--post-card-surface", 7],
    ["--post-card-text-dim", "--post-card-surface-dim", 7],
    ["--post-card-muted", "--post-card-surface", 4.5],
    ["--post-card-muted-dim", "--post-card-surface-dim", 4.5],
    ["--post-card-control-text", "--post-card-control-surface", 4.5],
    ["--post-card-control-border", "--post-card-control-surface", 3],
    ...Object.keys(syntaxRoleSources).map(
      (name) => [name as CardPaletteTokenName, "--post-card-surface", 4.5] as const,
    ),
    ...Object.keys(syntaxRoleSources).map(
      (name) => [`${name}-dim` as CardPaletteTokenName, "--post-card-surface-dim", 4.5] as const,
    ),
  ];

  for (const [foregroundName, backgroundName, minimum] of contrastChecks) {
    const ratio = contrastRatio(colors[foregroundName].color, colors[backgroundName].color);
    if (ratio + Number.EPSILON < minimum) {
      issues.push(`${foregroundName} on ${backgroundName} is ${ratio.toFixed(2)}:1 (minimum ${minimum}:1)`);
    }
  }

  const stateDistance = colorDistance(colors["--post-card-surface"].color, colors["--post-card-surface-dim"].color);
  if (stateDistance < 0.018) {
    issues.push(`Card surface states are ${stateDistance.toFixed(4)} apart (minimum 0.0180)`);
  }

  return Object.freeze({ issues: Object.freeze(issues), valid: issues.length === 0 });
}

export function compileCardPaletteForProfile(profile: ThemeProfile, rawIntent: CardPaletteIntent): CompiledCardPalette {
  const intent = canonicalizeCardPaletteIntent(rawIntent);
  const surface = renderSurface(profile, intent);
  const border = renderBorder(profile, intent);
  const accent = renderAccent(profile, intent);
  const spotlight = renderAccent(profile, intent, profile.mode === "dark" ? 0.09 : 0.1);
  const stateSurface = profileColor(
    profile,
    profile.mode === "dark" ? "--color-accent-surface" : "--color-surface-muted",
  ).color;
  const stateBorder = profileColor(profile, profile.mode === "dark" ? "--color-accent-border" : "--color-border").color;
  const dimAmount = profile.mode === "dark" ? 0.42 : 0.45;
  const surfaceTone = linearRgbToOklch(surface.color);
  const surfaceDim = rendered(
    profile.mode === "dark"
      ? mix(surface.color, stateSurface, dimAmount)
      : clampGamut(
          oklchToLinearRgb({
            ...surfaceTone,
            c: surfaceTone.c * 0.78,
            l: Math.max(0, surfaceTone.l - 0.045),
          }),
        ),
  );
  const borderDim = rendered(mix(border.color, stateBorder, dimAmount));
  const textSource = profileColor(profile, "--color-text").color;
  const mutedSource = profileColor(profile, "--color-text-muted").color;
  const text = rendered(ensureContrast(textSource, surface.color, 7));
  const textDim = rendered(ensureContrast(mix(textSource, mutedSource, 0.18), surfaceDim.color, 7));
  const muted = rendered(ensureContrast(mutedSource, surface.color, 4.5));
  const mutedDim = rendered(ensureContrast(mix(mutedSource, textSource, 0.12), surfaceDim.color, 4.5));
  const controlSurface = rendered(mix(surface.color, border.color, 0.18));
  const controlBorderCandidate = mix(border.color, text.color, 0.28);
  const controlBorder = rendered(ensureContrast(controlBorderCandidate, controlSurface.color, 3));
  const controlText = rendered(ensureContrast(text.color, controlSurface.color, 4.5));
  const controlHover = rendered(mix(surface.color, text.color, profile.mode === "dark" ? 0.18 : 0.1));

  const colors = {
    "--post-card-surface": surface,
    "--post-card-surface-dim": surfaceDim,
    "--post-card-border": border,
    "--post-card-border-dim": borderDim,
    "--post-card-text": text,
    "--post-card-text-dim": textDim,
    "--post-card-muted": muted,
    "--post-card-muted-dim": mutedDim,
    "--post-card-accent": accent,
    "--post-card-control-surface": controlSurface,
    "--post-card-control-border": controlBorder,
    "--post-card-control-text": controlText,
    "--post-card-control-hover": controlHover,
    "--post-card-spotlight": spotlight,
    "--post-card-spotlight-transparent": rendered(spotlight.color, 0),
  } as Record<CardPaletteTokenName, RenderedColor>;

  for (const [role, source] of Object.entries(syntaxRoleSources) as Array<
    [keyof typeof syntaxRoleSources, (typeof syntaxRoleSources)[keyof typeof syntaxRoleSources]]
  >) {
    colors[role] = rendered(ensureContrast(profileColor(profile, source).color, surface.color, 4.5));
    colors[`${role}-dim`] = rendered(
      ensureContrast(mix(profileColor(profile, source).color, mutedSource, 0.12), surfaceDim.color, 4.5),
    );
  }

  const tokens = Object.fromEntries(
    cardPaletteTokenNames.map((name) => {
      const value = colors[name];
      return [name, linearRgbToCss(value.color, value.alpha)];
    }),
  ) as Record<CardPaletteTokenName, string>;

  return Object.freeze({
    colors: Object.freeze(colors),
    intent,
    profileId: profile.id,
    tokens: Object.freeze(tokens),
    validation: validateCompiledCardPalette(colors),
  });
}

export function compileCardPalette(rawIntent: CardPaletteIntent) {
  return compileCardPaletteForProfile(getActiveThemeProfile(), rawIntent);
}

export function compileCardPalettePair(rawIntent: CardPaletteIntent): CompiledCardPalettePair {
  const intent = canonicalizeCardPaletteIntent(rawIntent);
  return Object.freeze({
    dark: compileCardPaletteForProfile(arcadeDarkProfile, intent),
    light: compileCardPaletteForProfile(arcadeLightProfile, intent),
  });
}

export function cardPaletteCssProperties(compiled: CompiledCardPalette): CardPaletteCssProperties {
  return compiled.tokens;
}

export function installCardPaletteCssProperties(element: HTMLElement, compiled: CompiledCardPalette) {
  for (const [name, value] of Object.entries(compiled.tokens)) {
    element.style.setProperty(name, value);
  }
  return () => {
    for (const name of cardPaletteTokenNames) {
      element.style.removeProperty(name);
    }
  };
}

export function renderCardPaletteWheelColor({
  colorfulness,
  hue,
  mode,
}: {
  colorfulness: number;
  hue: number;
  mode?: ThemeMode;
}) {
  const profile = mode === undefined ? getActiveThemeProfile() : getThemeProfile(mode);
  const intent = canonicalizeCardPaletteIntent({
    accent_colorfulness: null,
    accent_hue: null,
    model: "arcade-pigment-v1",
    surface_colorfulness: canonicalInteger("colorfulness", Math.round(clamp(colorfulness, 0, 100)), 0, 100),
    surface_hue: canonicalInteger("hue", Math.round(((hue % 360) + 360) % 360), 0, 359),
  });
  const surface = renderSurface(profile, intent);
  return linearRgbToCss(surface.color, surface.alpha);
}

export function defaultCardPaletteTokens(mode: ThemeMode): CssTokenMap {
  return compileCardPaletteForProfile(getThemeProfile(mode), chalkboardCardPaletteIntent).tokens;
}
