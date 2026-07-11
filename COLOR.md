# Color System

This document describes the proposed color model for Arcade. It is a technical
design note for replacing hand-authored palette values with generated semantic
tokens.

The existing frontend contract remains intact:

- component CSS consumes semantic custom properties such as `--color-surface`;
- `web/frontend/src/styles/tokens.css` remains the fallback/base token block;
- raw component colors remain disallowed outside the token source of truth;
- generated values must preserve the current dark, low-saturation, work-focused
  product direction described in `docs/frontend-style.md`.

The color model is not a component styling API. It is a palette renderer whose
output is the existing semantic CSS token set.

## Architecture

The implementation has three runtime layers.

### 1. Palette runtime

The palette runtime is instantiated once near frontend boot. It owns the scene,
material definitions, semantic token recipes, color renderer, validation data,
and generated token map.

Representative startup shape:

```ts
const palette = createPalette({
  scene: defaultScene,
  materials: defaultMaterials,
  recipes: arcadeTokenRecipes,
});

installCssTokens(palette.tokens);
createRoot(root).render(<App />);
```

If React needs access to the generated palette for canvas, charts, previews, or
future editing controls, a provider can expose the palette object:

```tsx
createRoot(root).render(
  <PaletteProvider palette={palette}>
    <App />
  </PaletteProvider>,
);
```

The provider is optional for CSS consumption. CSS variables are installed on the
document root and are globally available after boot.

### 2. CSS token bridge

The bridge serializes the palette into CSS custom properties. The output is a
complete semantic map:

```ts
type CssTokenMap = Record<`--${string}`, string>;

const tokens: CssTokenMap = {
  "--color-page": "#060a10",
  "--color-surface": "#11151b",
  "--color-border": "#303947",
  "--shadow-panel": "0 1px 2px rgb(0 4 12 / 30%)",
};
```

Installation may use direct root properties:

```ts
for (const [name, value] of Object.entries(tokens)) {
  document.documentElement.style.setProperty(name, value);
}
```

or a generated style element:

```ts
const style = document.createElement("style");
style.dataset.palette = "runtime";
style.textContent = `:root { ${serializeDeclarations(tokens)} }`;
document.head.append(style);
```

The bridge must override the same semantic variables already declared in
`tokens.css`. `tokens.css` remains the fallback so the application has a valid
first paint and can run if the runtime palette is disabled.

### 3. Component CSS

Component CSS remains static and semantic:

```css
.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-panel);
}
```

Components do not reference illuminants, albedo, roughness, exposure,
adaptation, or tone response. Those parameters are implementation details of
token generation.

The effective dependency chain is:

```txt
scene + materials + token recipes
  -> rendered semantic token values
  -> CSS custom properties
  -> existing component CSS
```

## Runtime Data Model

The instantiated palette must contain concrete primitives, not preset strings.
Factory functions may have names, but the runtime object should be numeric and
composable.

### Color

Color calculations should be performed in linear light. Authoring may use sRGB,
OKLCH, OKLab, or named constructors, but rendering must normalize to a concrete
working representation.

```ts
type LinearRgb = {
  r: number;
  g: number;
  b: number;
};

type Oklch = {
  l: number;
  c: number;
  h: number;
};

type Color = LinearRgb;
```

Expected helper operations:

```ts
add(a, b)                // component-wise linear addition
mul(a, b)                // component-wise linear multiplication
scale(color, scalar)     // component-wise scalar multiplication
mix(a, b, t)             // linear interpolation
luminance(color)         // relative luminance in linear RGB
clampGamut(color)        // display-gamut mapping before serialization
```

### Scene

The scene is the global lighting rig and observer response.

```ts
type Illuminant = {
  color: Color;
  intensity: number;
};

type LocalIlluminant = Illuminant & {
  zone: string;
  falloff: number;
};

type ToneResponse = {
  blackPoint: number;
  midGray: number;
  whitePoint: number;
  contrast: number;
  toe: {
    length: number;
    strength: number;
  };
  shoulder: {
    start: number;
    strength: number;
  };
};

type ChromaResponse = {
  byLuminance: Array<{
    luminance: number;
    chromaScale: number;
  }>;
};

type Scene = {
  key: Illuminant;
  ambient: Illuminant;
  localIlluminants: Record<string, LocalIlluminant>;
  exposure: number;
  adaptationWhitePoint: Color;
  tintStrength: number;
  toneResponse: ToneResponse;
  chromaResponse: ChromaResponse;
};
```

No field should contain values such as `"soft-clip-dark-ui"` or
`"desaturate-shadows-slightly"`. Those are factory labels, not model inputs.

### Material

Materials describe intrinsic reflectance and self-luminous behavior before
semantic token recipes apply geometry.

```ts
type Material = {
  albedo: Color;
  metalness: number;
  roughness: number;
  specularIntensity: number;
  emissivity: Color;
  translucency: number;
};
```

For this UI, most surfaces are dark, rough, dielectric materials:

- `metalness` is usually `0`;
- `roughness` is high for panels, rows, controls, and menus;
- `specularIntensity` is low and mostly visible through borders, hovers, and
  selected states;
- `emissivity` is primarily for text, focus rings, active links, destructive
  text, code accents, and glow-like effects;
- `translucency` is reserved for overlays, scrims, and soft spotlight effects.

### Token Recipe

Token recipes bind semantic roles to material samples and geometric scalars.
Most token differences should be recipes, not new equations.

```ts
type TokenRecipe = {
  material: string;
  elevation: number;
  occlusion: number;
  rim: number;
  localIlluminant?: string;
  translucency?: number;
  alpha?: number;
};
```

Example recipes:

```ts
const arcadeTokenRecipes = {
  "--color-page": {
    material: "neutral",
    elevation: -2,
    occlusion: 0.8,
    rim: 0,
  },

  "--color-surface": {
    material: "neutral",
    elevation: 0,
    occlusion: 0.35,
    rim: 0.05,
  },

  "--color-surface-hover": {
    material: "neutral",
    elevation: 1,
    occlusion: 0.2,
    rim: 0.15,
  },

  "--color-border": {
    material: "neutral",
    elevation: 0.5,
    occlusion: 0.1,
    rim: 0.6,
  },

  "--color-text": {
    material: "text",
    elevation: 0,
    occlusion: 0,
    rim: 0,
  },
} satisfies Record<string, TokenRecipe>;
```

## Rendering Model

The palette uses one core rendering equation plus a small set of response
functions. The parameters are not independent equations. They are inputs to a
pipeline.

High-level pipeline:

```txt
scene + material + token recipe
  -> diffuse light
  -> specular light
  -> emissive light
  -> exposure
  -> adaptation
  -> chroma response
  -> tone response
  -> gamut mapping
  -> CSS serialization
```

### Core equation

For a single token sample:

```txt
linear =
  exposure * (
    diffuse(albedo, scene, recipe)
    + specular(material, scene, recipe)
    + emissive(material)
    + translucent(material, scene, recipe)
  )
```

A practical implementation:

```ts
function renderToken(scene: Scene, material: Material, recipe: TokenRecipe): Color {
  const lit = addMany([
    computeDiffuse(scene, material, recipe),
    computeSpecular(scene, material, recipe),
    computeEmissive(material),
    computeTranslucency(scene, material, recipe),
  ]);

  const exposed = scale(lit, scene.exposure);
  const adapted = adaptWhitePoint(exposed, scene.adaptationWhitePoint);
  const chromaAdjusted = applyChromaResponse(adapted, scene.chromaResponse, scene.tintStrength);
  const toned = applyToneResponse(chromaAdjusted, scene.toneResponse);

  return clampGamut(toned);
}
```

The exact order of chroma response and tone response should be chosen
empirically and kept stable after calibration. Both operate on concrete curves,
not named presets.

### Diffuse term

Diffuse light is albedo multiplied by available illuminants.

```txt
ambientReach = 1 - occlusion
keyReach = diffuseScalar(elevation)

diffuse =
  albedo * (
    ambient.color * ambient.intensity * ambientReach
    + key.color * key.intensity * keyReach
    + sum(local.color * local.intensity * localReach)
  )
```

For UI, `diffuseScalar(elevation)` does not need a 3D normal. It can be a
monotonic scalar mapping semantic elevation to light reach:

```ts
function diffuseScalar(elevation: number): number {
  return clamp01(0.5 + elevation * 0.18);
}
```

The mapping is part of calibration. It should preserve ordering:

```txt
page < surface < surface-subtle < hover < muted/action < selected-hover
```

### Specular term

Specular light models glancing highlights, borders, focus rims, and selected
edge brightness.

```txt
dielectricSpecularColor = lightColor
metalSpecularColor = albedo * lightColor
specularColor = mix(dielectricSpecularColor, metalSpecularColor, metalness)

specular =
  specularColor
  * specularIntensity
  * specularShape(roughness, rim, elevation)
```

A UI-oriented shape can be:

```ts
function specularShape(roughness: number, rim: number, elevation: number): number {
  const narrowness = 1 - roughness;
  const elevationGain = clamp01(0.45 + elevation * 0.12);
  return clamp01(rim * (0.35 + narrowness * 0.65) * elevationGain);
}
```

This is physically inspired rather than physically complete. It gives semantic
control over edge response without requiring per-component normals.

### Emissive term

Emissive contribution is additive and independent of illuminants.

```txt
emissive = material.emissivity
```

Text and active affordances should generally be modeled as emissive. That keeps
legibility independent from surface lighting and prevents text from becoming a
dim reflectance sample.

### Translucency term

Translucency is for overlays, scrims, fades, glows, and spotlight-like effects.
It should not be used as a general substitute for surface color.

```txt
translucent =
  transmittedLight(scene, recipe)
  * material.translucency
  * recipe.translucency
```

Alpha-bearing tokens serialize to `rgb(... / alpha)` rather than opaque hex.

### Adaptation

Adaptation models the observer white-balanced to a scene white point. A von
Kries style transform is sufficient:

```txt
xyz = linearRgbToXyz(color)
lms = xyzToLms(xyz)
adaptedLms = lms * (referenceWhiteLms / adaptationWhiteLms)
adapted = xyzToLinearRgb(lmsToXyz(adaptedLms))
```

Bradford or CAT02 matrices are appropriate. The selected transform should be
fixed so calibration is stable.

### Chroma response

Chroma response controls how saturation changes with luminance. It is a curve
over luminance, not a named behavior.

```ts
type ChromaResponse = {
  byLuminance: Array<{
    luminance: number;
    chromaScale: number;
  }>;
};
```

Evaluation:

```txt
y = luminance(color)
scale = interpolate(chromaResponse.byLuminance, y)
oklch = linearRgbToOklch(color)
adjusted = { l: oklch.l, c: oklch.c * scale, h: oklch.h }
```

`tintStrength` controls interpolation between neutralized and fully tinted
output:

```txt
neutral = { l: adjusted.l, c: 0, h: adjusted.h }
tinted = adjusted
result = mixOklch(neutral, tinted, tintStrength)
```

The neutral/tinted interpolation may be applied only to low-chroma surface
materials. Emissive content such as danger, code syntax, and leaderboard medals
may use material-specific tint limits.

### Tone response

Tone response maps linear scene light to display values. It is a numeric curve.

```ts
type ToneResponse = {
  blackPoint: number;
  midGray: number;
  whitePoint: number;
  contrast: number;
  toe: {
    length: number;
    strength: number;
  };
  shoulder: {
    start: number;
    strength: number;
  };
};
```

Required properties:

- monotonic;
- stable around dark UI midtones;
- nonzero separation near black;
- soft clipping near white;
- predictable inverse or approximate inverse for calibration tools.

A concrete implementation can use piecewise response:

```txt
normalized = (x - blackPoint) / (whitePoint - blackPoint)
contrasted = pow(max(normalized, 0), 1 / contrast)
toe = liftDarkValues(contrasted, toe.length, toe.strength)
shoulder = compressHighlights(toe, shoulder.start, shoulder.strength)
display = clamp01(shoulder)
```

The precise toe and shoulder functions are implementation details, but their
parameters must remain explicit. Presets may construct this object; they must
not survive as runtime string values.

## Shadow Rendering

Shadow tokens are part of the palette because their color and opacity are
derived from the same lighting model.

```ts
type ShadowRecipe = {
  elevation: number;
  softness: number;
  occlusion: number;
  alpha: number;
};
```

Shadow color should derive from ambient and occlusion:

```txt
shadowTint = mix(black, ambient.color, shadowTintStrength)
shadowAlpha = baseAlpha * occlusion * elevationScalar
blur = baseBlur + softness * elevationBlur
offsetY = baseOffset + elevation * offsetScale
```

Example output:

```txt
--shadow-panel: 0 1px 2px rgb(0 4 12 / 30%)
--shadow-popover: 0 12px 28px rgb(0 4 12 / 45%)
```

## Sensible Defaults

Defaults should be calibrated, not invented. The current token values in
`tokens.css` are the initial target palette.

### Calibration inputs

Use three sources:

1. Current token values as the target output.
2. Product direction from `docs/frontend-style.md`.
3. Validation constraints from real rendered UI.

The target direction is:

- cool dark surfaces;
- blue-black app background;
- low-saturation neutral chrome;
- cool white primary text;
- light blue-gray selection and focus treatment;
- muted red only for destructive/error states;
- restrained multi-hue code colors treated as content.

### Calibration process

Calibration should optimize scene, material, and recipe defaults against the
current palette.

For each semantic token:

```txt
target = current token value from tokens.css
candidate = renderToken(defaultScene, material, recipe)
error = colorDistance(candidate, target)
```

Use a perceptual distance such as OKLab Euclidean distance or DeltaE-like
distance, with higher weights for high-impact tokens:

```txt
high weight:
  --color-page
  --color-surface
  --color-text
  --color-text-muted
  --color-border
  --color-accent

medium weight:
  hover, selected, action, header, overlay, toast

low/specialized weight:
  leaderboard, code syntax, feed spotlight
```

Contrast constraints are hard validation constraints, not only distance terms:

```txt
text on page >= required contrast
text on surface >= required contrast
muted text on surface >= required contrast for its role
danger text on surface >= required contrast
focus ring visible against adjacent surfaces
selected state distinguishable from hover/resting states
```

Rendered UI screenshots should be compared with `locator.ts` for affected
regions. The default generated palette is acceptable only if the app is visually
near-identical to the current palette before any theme variation is introduced.

### Default scene shape

The first calibrated scene should be close to:

```ts
const defaultScene: Scene = {
  key: {
    color: srgbToLinear("#f0f6ff"),
    intensity: 0.32,
  },
  ambient: {
    color: srgbToLinear("#0b1420"),
    intensity: 0.68,
  },
  localIlluminants: {},
  exposure: 1,
  adaptationWhitePoint: srgbToLinear("#f0f6ff"),
  tintStrength: 0.35,
  toneResponse: {
    blackPoint: 0.002,
    midGray: 0.18,
    whitePoint: 1,
    contrast: 1.04,
    toe: {
      length: 0.12,
      strength: 0.55,
    },
    shoulder: {
      start: 0.82,
      strength: 0.35,
    },
  },
  chromaResponse: {
    byLuminance: [
      { luminance: 0, chromaScale: 0.62 },
      { luminance: 0.05, chromaScale: 0.72 },
      { luminance: 0.18, chromaScale: 0.92 },
      { luminance: 0.65, chromaScale: 1 },
      { luminance: 1, chromaScale: 0.96 },
    ],
  },
};
```

These values are starting estimates. They should be replaced by calibrated
values after fitting against the current token set.

### Default material families

The material set should be small. Semantic variety should mostly come from token
recipes and scene response, not from many near-duplicate materials.

```ts
const defaultMaterials = {
  neutral: {
    albedo: srgbToLinear("#111821"),
    metalness: 0,
    roughness: 0.85,
    specularIntensity: 0.08,
    emissivity: black,
    translucency: 0,
  },

  text: {
    albedo: srgbToLinear("#f0f4f8"),
    metalness: 0,
    roughness: 1,
    specularIntensity: 0,
    emissivity: srgbToLinear("#f0f4f8"),
    translucency: 0,
  },

  accent: {
    albedo: srgbToLinear("#dcecff"),
    metalness: 0,
    roughness: 0.72,
    specularIntensity: 0.16,
    emissivity: scale(srgbToLinear("#f0f6ff"), 0.2),
    translucency: 0,
  },

  danger: {
    albedo: srgbToLinear("#ff9592"),
    metalness: 0,
    roughness: 0.78,
    specularIntensity: 0.05,
    emissivity: scale(srgbToLinear("#ff9592"), 0.35),
    translucency: 0,
  },
};
```

### Free and fixed defaults

Not all parameters should be equally free in Arcade.

Mostly fixed:

- `metalness`: `0` for normal UI.
- `roughness`: high for all dark UI surfaces.
- `translucency`: `0` except overlays, fades, scrims, and glows.
- `localIlluminants`: empty unless a specific zone needs special treatment.

Primary global knobs:

- key illuminant chromaticity and intensity;
- ambient illuminant chromaticity and intensity;
- exposure;
- adaptation white point;
- tone response curve;
- chroma response curve;
- tint strength.

Primary per-token knobs:

- material family;
- elevation;
- occlusion;
- rim;
- alpha for translucent tokens.

## Token Classification

Current tokens map into model responsibilities as follows.

### Lit neutral surfaces

These should be generated from `neutral` material plus elevation, occlusion, and
rim:

```txt
--color-page
--color-surface
--color-surface-subtle
--color-surface-hover
--color-surface-muted
--color-header
--color-toast
```

### Neutral edges and dividers

These should use high rim response and low to moderate elevation:

```txt
--color-border
--color-border-subtle
--color-border-hover
```

### Text and icons

These should be mostly emissive and validated by contrast:

```txt
--color-text
--color-text-muted
--color-text-nav-muted
--color-text-nav-active-parent
--color-icon-muted
--color-header-muted
--color-inverse-text
```

### Accent states

These should use the `accent` material, with selected surfaces still relatively
close to neutral UI material:

```txt
--color-accent
--color-accent-hover
--color-accent-surface
--color-accent-surface-hover
--color-accent-badge-surface
--color-accent-border
--color-accent-border-hover
--color-accent-badge-border
--color-accent-action
--color-accent-action-hover
--color-accent-action-text
```

### Danger states

These should use the `danger` material and remain reserved for destructive or
error states:

```txt
--color-danger
--color-danger-surface
--color-danger-border
--color-danger-border-hover
```

### Content colors

These may be material families or explicit calibrated content colors. They are
not general UI chrome:

```txt
--color-post-tag
--color-leaderboard-gold
--color-leaderboard-silver
--color-leaderboard-bronze
--color-code-surface
--color-code-border
--color-code-accent
--color-code-attribute
--color-code-comment
--color-code-keyword
--color-code-literal
--color-code-meta
--color-code-string
--color-code-title
```

### Alpha and effects

These serialize as alpha colors or effect strings and should derive from the
same scene where possible:

```txt
--color-overlay
--color-output-item-title-dim
--color-feed-spotlight
--color-feed-spotlight-transparent
--color-code-fade-start
--shadow-panel
--shadow-popover
--shadow-modal
--shadow-toast
--filter-leaderboard-gold-glow
--shadow-leaderboard-gold-text
```

## Implementation Constraints

The first implementation should favor deterministic pure functions over mutable
class instances.

Preferred shape:

```ts
const palette = createPalette({ scene, materials, recipes });
```

over:

```ts
const palette = new Palette();
palette.scene.key.setIntensity(0.3);
```

Reasons:

- deterministic output for snapshots;
- simple serialization for future editor state;
- no lifecycle coupling between palette construction and React rendering;
- easier calibration tooling;
- easier generated CSS comparison.

Classes are acceptable only if they are thin wrappers around immutable data and
pure render functions.

Generated token output must be complete. Partial runtime overrides make the
semantic system harder to reason about because some tokens would come from CSS
and others from TypeScript.

Generated output should be validated by:

- token snapshot comparison;
- contrast checks;
- CSS lint rules;
- visual inspection with `locator.ts`;
- full project validation when code changes are made.

## Design Principle

The physical model is the mechanism. Semantic tokens are the product API.

The goal is not physically accurate rendering. The goal is coherent palette
motion: changing ambient color, exposure, or adaptation should move the entire
UI consistently while preserving hierarchy, contrast, and Arcade's current
visual identity.
