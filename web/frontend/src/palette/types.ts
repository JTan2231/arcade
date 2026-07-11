export type LinearRgb = Readonly<{
  r: number;
  g: number;
  b: number;
}>;

export type Oklch = Readonly<{
  l: number;
  c: number;
  h: number;
}>;

export type Illuminant = Readonly<{
  color: LinearRgb;
  intensity: number;
}>;

export type LocalIlluminant = Illuminant &
  Readonly<{
    zone: string;
    falloff: number;
  }>;

export type ToneResponse = Readonly<{
  blackPoint: number;
  midGray: number;
  whitePoint: number;
  contrast: number;
  toe: Readonly<{
    length: number;
    strength: number;
  }>;
  shoulder: Readonly<{
    start: number;
    strength: number;
  }>;
}>;

export type ChromaResponse = Readonly<{
  byLuminance: ReadonlyArray<
    Readonly<{
      luminance: number;
      chromaScale: number;
    }>
  >;
}>;

export type Scene = Readonly<{
  key: Illuminant;
  ambient: Illuminant;
  localIlluminants: Readonly<Record<string, LocalIlluminant>>;
  exposure: number;
  adaptationWhitePoint: LinearRgb;
  tintStrength: number;
  toneResponse: ToneResponse;
  chromaResponse: ChromaResponse;
}>;

export type Material = Readonly<{
  albedo: LinearRgb;
  metalness: number;
  roughness: number;
  specularIntensity: number;
  emissivity: LinearRgb;
  translucency: number;
}>;

export type TokenRecipe = Readonly<{
  material: string;
  elevation: number;
  occlusion: number;
  rim: number;
  localIlluminant?: string;
  translucency?: number;
  alpha?: number;
}>;

export type ShadowRecipe = Readonly<{
  elevation: number;
  softness: number;
  occlusion: number;
  alpha: number;
}>;

export type GlowRecipe = Readonly<{
  kind: "drop-shadow" | "text-shadow";
  color: LinearRgb;
  offsetX: number;
  offsetY: number;
  blur: number;
  alpha: number;
}>;

export type CssTokenName = `--${string}`;
export type CssTokenMap = Readonly<Record<CssTokenName, string>>;
export type ColorRecipeMap = Readonly<Record<CssTokenName, TokenRecipe>>;
export type ShadowRecipeMap = Readonly<Record<CssTokenName, ShadowRecipe>>;
export type GlowRecipeMap = Readonly<Record<CssTokenName, GlowRecipe>>;

export type RenderedColor = Readonly<{
  color: LinearRgb;
  alpha: number;
}>;

export type ContrastConstraint = Readonly<{
  foreground: CssTokenName;
  background: CssTokenName;
  minimum: number;
}>;

export type DistinctionConstraint = Readonly<{
  first: CssTokenName;
  second: CssTokenName;
  minimumDistance: number;
}>;

export type PaletteValidationConfig = Readonly<{
  requiredTokens: ReadonlyArray<CssTokenName>;
  targets: Readonly<Partial<Record<CssTokenName, string>>>;
  maximumTargetDistance: number;
  contrast: ReadonlyArray<ContrastConstraint>;
  distinction: ReadonlyArray<DistinctionConstraint>;
}>;

export type ContrastResult = ContrastConstraint &
  Readonly<{
    ratio: number;
    valid: boolean;
  }>;

export type DistinctionResult = DistinctionConstraint &
  Readonly<{
    distance: number;
    valid: boolean;
  }>;

export type TargetDistanceResult = Readonly<{
  token: CssTokenName;
  distance: number;
  maximum: number;
  valid: boolean;
}>;

export type PaletteValidation = Readonly<{
  valid: boolean;
  missingTokens: ReadonlyArray<CssTokenName>;
  unexpectedTokens: ReadonlyArray<CssTokenName>;
  contrast: ReadonlyArray<ContrastResult>;
  distinction: ReadonlyArray<DistinctionResult>;
  targetDistances: ReadonlyArray<TargetDistanceResult>;
  issues: ReadonlyArray<string>;
}>;

export type PaletteInput = Readonly<{
  scene: Scene;
  materials: Readonly<Record<string, Material>>;
  recipes: ColorRecipeMap;
  shadowRecipes?: ShadowRecipeMap;
  glowRecipes?: GlowRecipeMap;
  validation?: PaletteValidationConfig;
}>;

export type Palette = Readonly<{
  scene: Scene;
  materials: Readonly<Record<string, Material>>;
  recipes: ColorRecipeMap;
  shadowRecipes: ShadowRecipeMap;
  glowRecipes: GlowRecipeMap;
  colors: Readonly<Record<CssTokenName, RenderedColor>>;
  tokens: CssTokenMap;
  validation: PaletteValidation;
}>;
