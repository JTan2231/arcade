import { black, cssColorToLinearRgb, srgbToLinear } from "./color";
import {
  arcadeGlowRecipes,
  arcadeRequiredTokens,
  arcadeShadowRecipes,
  createArcadePalette,
  defaultScene,
} from "./defaults";
import { createPalette } from "./render";
import type {
  ColorRecipeMap,
  CssTokenName,
  Material,
  Palette,
  PaletteValidationConfig,
  Scene,
  TokenRecipe,
} from "./types";

export type ThemeMode = "dark" | "light";
export type ThemeProfileId = "arcade-dark-v1" | "arcade-light-v1";

export type ThemeProfile = Readonly<{
  colorScheme: ThemeMode;
  id: ThemeProfileId;
  mode: ThemeMode;
  palette: Palette;
  scene: Scene;
}>;

function displayMaterial(value: string): Material {
  const parsed = cssColorToLinearRgb(value);
  return Object.freeze({
    albedo: black,
    metalness: 0,
    roughness: 1,
    specularIntensity: 0,
    emissivity: parsed.color,
    translucency: 0,
  });
}

function displayRecipe(material: string, value: string): TokenRecipe {
  const alpha = cssColorToLinearRgb(value).alpha;
  return Object.freeze({ material, elevation: 0, occlusion: 0, rim: 0, ...(alpha < 1 ? { alpha } : {}) });
}

export const arcadeLightScene: Scene = Object.freeze({
  key: Object.freeze({ color: black, intensity: 0 }),
  ambient: Object.freeze({ color: black, intensity: 0 }),
  localIlluminants: Object.freeze({}),
  exposure: 1,
  adaptationWhitePoint: srgbToLinear("#ffffff"),
  tintStrength: 1,
  toneResponse: Object.freeze({
    blackPoint: 0,
    midGray: 0.18,
    whitePoint: 1,
    contrast: 1,
    toe: Object.freeze({ length: 0, strength: 0 }),
    shoulder: Object.freeze({ start: 1, strength: 0 }),
  }),
  chromaResponse: Object.freeze({
    byLuminance: Object.freeze([
      Object.freeze({ luminance: 0, chromaScale: 1 }),
      Object.freeze({ luminance: 1, chromaScale: 1 }),
    ]),
  }),
});

export const arcadeLightColorTargets = Object.freeze({
  "--color-page": "#eef2f5",
  "--color-surface": "#ffffff",
  "--color-surface-subtle": "#f6f8fa",
  "--color-surface-hover": "#e7ecf1",
  "--color-surface-muted": "#dce3e9",
  "--color-text": "#171c24",
  "--color-text-muted": "#586575",
  "--color-text-nav-muted": "#657384",
  "--color-text-nav-active-parent": "#2f3e4d",
  "--color-icon-muted": "#667586",
  "--color-border": "#b6c1cc",
  "--color-border-subtle": "#d3dbe2",
  "--color-border-hover": "#7d8b99",
  "--color-accent": "#294b68",
  "--color-accent-hover": "#183a56",
  "--color-accent-surface": "#dbe7f1",
  "--color-accent-surface-hover": "#c8d8e6",
  "--color-accent-badge-surface": "#e1ebf3",
  "--color-accent-border": "#667d92",
  "--color-accent-border-hover": "#445f78",
  "--color-accent-badge-border": "#8da0b1",
  "--color-accent-action": "#294b68",
  "--color-accent-action-hover": "#183a56",
  "--color-accent-action-text": "#ffffff",
  "--color-danger": "#a72828",
  "--color-danger-surface": "#f8e3e2",
  "--color-danger-border": "#c56561",
  "--color-danger-border-hover": "#9d3532",
  "--color-post-tag": "#8b521d",
  "--color-leaderboard-gold": "#806b14",
  "--color-leaderboard-silver": "#59636b",
  "--color-leaderboard-bronze": "#8b542d",
  "--color-header": "#ffffff",
  "--color-header-muted": "#586575",
  "--color-inverse-text": "#f2f4f2",
  "--color-overlay": "rgb(12 20 28 / 40%)",
  "--color-toast": "#ffffff",
  "--color-output-item-title-dim": "#667586",
  "--color-feed-spotlight": "rgb(72 111 145 / 8%)",
  "--color-feed-spotlight-transparent": "rgb(72 111 145 / 0%)",
  "--color-post-spotlight": "rgb(54 126 99 / 10%)",
  "--color-post-spotlight-transparent": "rgb(54 126 99 / 0%)",
  "--color-code-surface": "#e5f2ec",
  "--color-code-border": "#7f9f91",
  "--color-code-accent": "#16735e",
  "--color-code-fade-start": "rgb(229 242 236 / 0%)",
  "--color-code-attribute": "#176b6b",
  "--color-code-comment": "#536a62",
  "--color-code-keyword": "#075d86",
  "--color-code-literal": "#775500",
  "--color-code-meta": "#973d43",
  "--color-code-string": "#3c6e18",
  "--color-code-title": "#67458a",
} satisfies Partial<Record<CssTokenName, string>>);

const lightMaterials = Object.freeze(
  Object.fromEntries(
    Object.entries(arcadeLightColorTargets).map(([name, value]) => [`light-${name.slice(2)}`, displayMaterial(value)]),
  ),
);

const lightTokenRecipes = Object.freeze(
  Object.fromEntries(
    Object.entries(arcadeLightColorTargets).map(([name, value]) => [
      name,
      displayRecipe(`light-${name.slice(2)}`, value),
    ]),
  ) as ColorRecipeMap,
);

export const arcadeLightPaletteValidation: PaletteValidationConfig = Object.freeze({
  requiredTokens: arcadeRequiredTokens,
  targets: arcadeLightColorTargets,
  maximumTargetDistance: 0.002,
  contrast: Object.freeze([
    Object.freeze({ foreground: "--color-text", background: "--color-page", minimum: 7 }),
    Object.freeze({ foreground: "--color-text", background: "--color-surface", minimum: 7 }),
    Object.freeze({ foreground: "--color-text-muted", background: "--color-surface", minimum: 4.5 }),
    Object.freeze({ foreground: "--color-danger", background: "--color-surface", minimum: 4.5 }),
    Object.freeze({ foreground: "--color-accent", background: "--color-page", minimum: 3 }),
    Object.freeze({ foreground: "--color-accent", background: "--color-surface", minimum: 3 }),
    Object.freeze({
      foreground: "--color-accent-action-text",
      background: "--color-accent-action",
      minimum: 4.5,
    }),
  ]),
  distinction: Object.freeze([
    Object.freeze({ first: "--color-page", second: "--color-surface", minimumDistance: 0.025 }),
    Object.freeze({ first: "--color-surface", second: "--color-surface-subtle", minimumDistance: 0.018 }),
    Object.freeze({ first: "--color-surface-subtle", second: "--color-surface-hover", minimumDistance: 0.025 }),
    Object.freeze({ first: "--color-surface-hover", second: "--color-surface-muted", minimumDistance: 0.018 }),
    Object.freeze({ first: "--color-surface", second: "--color-accent-surface", minimumDistance: 0.03 }),
    Object.freeze({
      first: "--color-accent-surface",
      second: "--color-accent-surface-hover",
      minimumDistance: 0.025,
    }),
    Object.freeze({ first: "--color-border", second: "--color-accent-border", minimumDistance: 0.06 }),
  ]),
});

export function createArcadeLightPalette() {
  return createPalette({
    scene: arcadeLightScene,
    materials: lightMaterials,
    recipes: lightTokenRecipes,
    shadowRecipes: arcadeShadowRecipes,
    glowRecipes: arcadeGlowRecipes,
    validation: arcadeLightPaletteValidation,
  });
}

export const arcadeDarkProfile: ThemeProfile = Object.freeze({
  colorScheme: "dark",
  id: "arcade-dark-v1",
  mode: "dark",
  palette: createArcadePalette(),
  scene: defaultScene,
});

export const arcadeLightProfile: ThemeProfile = Object.freeze({
  colorScheme: "light",
  id: "arcade-light-v1",
  mode: "light",
  palette: createArcadeLightPalette(),
  scene: arcadeLightScene,
});

export const arcadeThemeProfiles = Object.freeze({
  dark: arcadeDarkProfile,
  light: arcadeLightProfile,
} satisfies Record<ThemeMode, ThemeProfile>);

let activeThemeMode: ThemeMode = "dark";

export function getThemeProfile(mode: ThemeMode) {
  return arcadeThemeProfiles[mode];
}

export function getActiveThemeProfile() {
  return getThemeProfile(activeThemeMode);
}

export function setActiveThemeProfileMode(mode: ThemeMode) {
  activeThemeMode = mode;
}
