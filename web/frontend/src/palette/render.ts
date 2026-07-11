import {
  adaptWhitePoint,
  add,
  addMany,
  applyChromaResponse,
  applyToneResponse,
  black,
  clamp01,
  clampGamut,
  colorDistance,
  composite,
  contrastRatio,
  cssColorToLinearRgb,
  linearRgbToCss,
  linearRgbToOklch,
  luminance,
  mix,
  mul,
  scale,
} from "./color";
import type {
  CssTokenMap,
  CssTokenName,
  GlowRecipe,
  LinearRgb,
  Material,
  Palette,
  PaletteInput,
  PaletteValidation,
  PaletteValidationConfig,
  RenderedColor,
  Scene,
  ShadowRecipe,
  TokenRecipe,
} from "./types";

const emptyValidation: PaletteValidation = Object.freeze({
  valid: true,
  missingTokens: Object.freeze([]),
  unexpectedTokens: Object.freeze([]),
  contrast: Object.freeze([]),
  distinction: Object.freeze([]),
  targetDistances: Object.freeze([]),
  issues: Object.freeze([]),
});

function requireFinite(name: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function requireRange(name: string, value: number, minimum: number, maximum: number) {
  requireFinite(name, value);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
}

function validateColor(name: string, color: LinearRgb) {
  requireFinite(`${name}.r`, color.r);
  requireFinite(`${name}.g`, color.g);
  requireFinite(`${name}.b`, color.b);
}

function validateScene(scene: Scene) {
  validateColor("scene.key.color", scene.key.color);
  validateColor("scene.ambient.color", scene.ambient.color);
  validateColor("scene.adaptationWhitePoint", scene.adaptationWhitePoint);
  if (luminance(scene.adaptationWhitePoint) <= 0) {
    throw new Error("scene.adaptationWhitePoint must have positive luminance");
  }
  requireRange("scene.key.intensity", scene.key.intensity, 0, Number.MAX_VALUE);
  requireRange("scene.ambient.intensity", scene.ambient.intensity, 0, Number.MAX_VALUE);
  requireRange("scene.exposure", scene.exposure, Number.EPSILON, Number.MAX_VALUE);
  requireRange("scene.tintStrength", scene.tintStrength, 0, 1);

  const tone = scene.toneResponse;
  requireRange("scene.toneResponse.blackPoint", tone.blackPoint, 0, Number.MAX_VALUE);
  requireRange("scene.toneResponse.whitePoint", tone.whitePoint, Number.EPSILON, Number.MAX_VALUE);
  if (tone.whitePoint <= tone.blackPoint) {
    throw new Error("scene.toneResponse.whitePoint must be greater than blackPoint");
  }
  if (tone.midGray <= tone.blackPoint || tone.midGray >= tone.whitePoint) {
    throw new Error("scene.toneResponse.midGray must be between blackPoint and whitePoint");
  }
  requireRange("scene.toneResponse.contrast", tone.contrast, Number.EPSILON, Number.MAX_VALUE);
  requireRange("scene.toneResponse.toe.length", tone.toe.length, 0, 1);
  requireRange("scene.toneResponse.toe.strength", tone.toe.strength, 0, 1);
  requireRange("scene.toneResponse.shoulder.start", tone.shoulder.start, 0, 1);
  requireRange("scene.toneResponse.shoulder.strength", tone.shoulder.strength, 0, Number.MAX_VALUE);

  let previousToneValue = -1;
  for (let index = 0; index <= 256; index += 1) {
    const input = (tone.whitePoint * index) / 256;
    const output = applyToneResponse({ r: input, g: input, b: input }, tone).r;
    if (output + Number.EPSILON < previousToneValue) {
      throw new Error("scene.toneResponse must be monotonic");
    }
    previousToneValue = output;
  }

  if (scene.chromaResponse.byLuminance.length === 0) {
    throw new Error("scene.chromaResponse.byLuminance must contain at least one point");
  }
  let previousLuminance = -1;
  for (const [index, point] of scene.chromaResponse.byLuminance.entries()) {
    requireRange(`scene.chromaResponse.byLuminance[${index}].luminance`, point.luminance, 0, 1);
    requireRange(`scene.chromaResponse.byLuminance[${index}].chromaScale`, point.chromaScale, 0, Number.MAX_VALUE);
    if (point.luminance <= previousLuminance) {
      throw new Error("scene.chromaResponse.byLuminance must be ordered by increasing luminance");
    }
    previousLuminance = point.luminance;
  }

  for (const [name, local] of Object.entries(scene.localIlluminants)) {
    validateColor(`scene.localIlluminants.${name}.color`, local.color);
    requireRange(`scene.localIlluminants.${name}.intensity`, local.intensity, 0, Number.MAX_VALUE);
    requireRange(`scene.localIlluminants.${name}.falloff`, local.falloff, 0, 1);
    if (local.zone.trim() === "") {
      throw new Error(`scene.localIlluminants.${name}.zone must not be empty`);
    }
  }
}

function validateMaterial(name: string, material: Material) {
  validateColor(`materials.${name}.albedo`, material.albedo);
  validateColor(`materials.${name}.emissivity`, material.emissivity);
  requireRange(`materials.${name}.metalness`, material.metalness, 0, 1);
  requireRange(`materials.${name}.roughness`, material.roughness, 0, 1);
  requireRange(`materials.${name}.specularIntensity`, material.specularIntensity, 0, Number.MAX_VALUE);
  requireRange(`materials.${name}.translucency`, material.translucency, 0, 1);
}

function validateTokenRecipe(name: string, scene: Scene, materialNames: ReadonlySet<string>, recipe: TokenRecipe) {
  if (!materialNames.has(recipe.material)) {
    throw new Error(`${name} references unknown material ${JSON.stringify(recipe.material)}`);
  }
  requireFinite(`${name}.elevation`, recipe.elevation);
  requireRange(`${name}.occlusion`, recipe.occlusion, 0, 1);
  requireRange(`${name}.rim`, recipe.rim, 0, 1);
  if (recipe.alpha !== undefined) {
    requireRange(`${name}.alpha`, recipe.alpha, 0, 1);
  }
  if (recipe.translucency !== undefined) {
    requireRange(`${name}.translucency`, recipe.translucency, 0, 1);
  }
  if (recipe.localIlluminant !== undefined && scene.localIlluminants[recipe.localIlluminant] === undefined) {
    throw new Error(`${name} references unknown local illuminant ${JSON.stringify(recipe.localIlluminant)}`);
  }
}

function validateShadowRecipe(name: string, recipe: ShadowRecipe) {
  requireFinite(`${name}.elevation`, recipe.elevation);
  requireRange(`${name}.softness`, recipe.softness, 0, Number.MAX_VALUE);
  requireRange(`${name}.occlusion`, recipe.occlusion, 0, 1);
  requireRange(`${name}.alpha`, recipe.alpha, 0, 1);
}

function validateGlowRecipe(name: string, recipe: GlowRecipe) {
  validateColor(`${name}.color`, recipe.color);
  requireFinite(`${name}.offsetX`, recipe.offsetX);
  requireFinite(`${name}.offsetY`, recipe.offsetY);
  requireRange(`${name}.blur`, recipe.blur, 0, Number.MAX_VALUE);
  requireRange(`${name}.alpha`, recipe.alpha, 0, 1);
}

export function diffuseScalar(elevation: number) {
  return clamp01(0.5 + elevation * 0.18);
}

function computeDiffuse(scene: Scene, material: Material, recipe: TokenRecipe): LinearRgb {
  const ambientReach = 1 - recipe.occlusion;
  const keyReach = diffuseScalar(recipe.elevation);
  const illuminants: LinearRgb[] = [
    scale(scene.ambient.color, scene.ambient.intensity * ambientReach),
    scale(scene.key.color, scene.key.intensity * keyReach),
  ];

  if (recipe.localIlluminant !== undefined) {
    const local = scene.localIlluminants[recipe.localIlluminant];
    if (local !== undefined) {
      const localReach = clamp01(keyReach * (1 - local.falloff * recipe.occlusion));
      illuminants.push(scale(local.color, local.intensity * localReach));
    }
  }

  return mul(material.albedo, addMany(illuminants));
}

export function specularShape(roughness: number, rim: number, elevation: number) {
  const narrowness = 1 - roughness;
  const elevationGain = clamp01(0.45 + elevation * 0.12);
  return clamp01(rim * (0.35 + narrowness * 0.65) * elevationGain);
}

function activeLight(scene: Scene, recipe: TokenRecipe) {
  let light = add(
    scale(scene.key.color, scene.key.intensity),
    scale(scene.ambient.color, scene.ambient.intensity * 0.25),
  );
  if (recipe.localIlluminant !== undefined) {
    const local = scene.localIlluminants[recipe.localIlluminant];
    if (local !== undefined) {
      light = add(light, scale(local.color, local.intensity * (1 - local.falloff)));
    }
  }
  return light;
}

function computeSpecular(scene: Scene, material: Material, recipe: TokenRecipe): LinearRgb {
  const light = activeLight(scene, recipe);
  const dielectric = light;
  const metallic = mul(material.albedo, light);
  const specularColor = mix(dielectric, metallic, material.metalness);
  const shape = specularShape(material.roughness, recipe.rim, recipe.elevation);
  return scale(specularColor, material.specularIntensity * shape);
}

function computeTranslucency(scene: Scene, material: Material, recipe: TokenRecipe): LinearRgb {
  const recipeTranslucency = recipe.translucency ?? 1;
  if (material.translucency === 0 || recipeTranslucency === 0) {
    return black;
  }
  const transmitted = add(
    scale(scene.ambient.color, scene.ambient.intensity),
    scale(scene.key.color, scene.key.intensity * diffuseScalar(recipe.elevation)),
  );
  return scale(transmitted, material.translucency * recipeTranslucency);
}

function materialIsLowChroma(material: Material) {
  const intrinsic = add(material.albedo, material.emissivity);
  return linearRgbToOklch(intrinsic).c <= 0.08;
}

export function renderToken(scene: Scene, material: Material, recipe: TokenRecipe): RenderedColor {
  const lit = addMany([
    computeDiffuse(scene, material, recipe),
    computeSpecular(scene, material, recipe),
    material.emissivity,
    computeTranslucency(scene, material, recipe),
  ]);
  const exposed = scale(lit, scene.exposure);
  const adapted = adaptWhitePoint(exposed, scene.adaptationWhitePoint);
  const chromaAdjusted = applyChromaResponse(
    adapted,
    scene.chromaResponse,
    scene.tintStrength,
    materialIsLowChroma(material),
  );
  const toned = applyToneResponse(chromaAdjusted, scene.toneResponse);
  return {
    color: clampGamut(toned),
    alpha: recipe.alpha ?? 1,
  };
}

function renderEffectColor(scene: Scene, color: LinearRgb) {
  const exposed = scale(color, scene.exposure);
  const adapted = adaptWhitePoint(exposed, scene.adaptationWhitePoint);
  const chromaAdjusted = applyChromaResponse(adapted, scene.chromaResponse, scene.tintStrength, false);
  return clampGamut(applyToneResponse(chromaAdjusted, scene.toneResponse));
}

function formatLength(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function renderShadow(scene: Scene, recipe: ShadowRecipe) {
  const ambient = scale(scene.ambient.color, scene.ambient.intensity);
  const tint = mix(black, renderEffectColor(scene, ambient), 0.28);
  const elevationScalar = clamp01(0.72 + Math.max(0, recipe.elevation) * 0.07);
  const alpha = recipe.alpha * recipe.occlusion * elevationScalar;
  const offsetY = Math.max(1, recipe.elevation * 3);
  const blur = 2 + recipe.softness * 6 + recipe.elevation * 2;
  return `0 ${formatLength(offsetY)}px ${formatLength(blur)}px ${linearRgbToCss(tint, alpha)}`;
}

export function renderGlow(scene: Scene, recipe: GlowRecipe) {
  const color = linearRgbToCss(renderEffectColor(scene, recipe.color), recipe.alpha);
  const body = `${formatLength(recipe.offsetX)}px ${formatLength(recipe.offsetY)}px ${formatLength(recipe.blur)}px ${color}`;
  return recipe.kind === "drop-shadow" ? `drop-shadow(${body})` : body;
}

function validateRenderedPalette(
  tokens: CssTokenMap,
  colors: Readonly<Record<CssTokenName, RenderedColor>>,
  config: PaletteValidationConfig,
): PaletteValidation {
  const tokenNames = new Set(Object.keys(tokens) as CssTokenName[]);
  const requiredNames = new Set(config.requiredTokens);
  const missingTokens = config.requiredTokens.filter((name) => !tokenNames.has(name));
  const unexpectedTokens = [...tokenNames].filter((name) => !requiredNames.has(name));
  const issues: string[] = [];

  for (const token of missingTokens) {
    issues.push(`Missing required token ${token}`);
  }
  for (const token of unexpectedTokens) {
    issues.push(`Unexpected generated token ${token}`);
  }

  const targetDistances = Object.entries(config.targets).flatMap(([name, target]) => {
    const token = name as CssTokenName;
    const rendered = colors[token];
    if (target === undefined || rendered === undefined) {
      return [];
    }
    const expected = cssColorToLinearRgb(target);
    const distance = Math.hypot(
      colorDistance(rendered.color, expected.color),
      Math.abs(rendered.alpha - expected.alpha) * 0.1,
    );
    const valid = distance <= config.maximumTargetDistance;
    if (!valid) {
      issues.push(
        `${token} is ${distance.toFixed(4)} from its target (maximum ${config.maximumTargetDistance.toFixed(4)})`,
      );
    }
    return [
      {
        token,
        distance,
        maximum: config.maximumTargetDistance,
        valid,
      },
    ];
  });

  const contrast = config.contrast.map((constraint) => {
    const foreground = colors[constraint.foreground];
    const background = colors[constraint.background];
    let ratio = 0;
    if (foreground !== undefined && background !== undefined) {
      const opaqueBackground = composite(background.color, background.alpha, black);
      const opaqueForeground = composite(foreground.color, foreground.alpha, opaqueBackground);
      ratio = contrastRatio(opaqueForeground, opaqueBackground);
    }
    const valid = ratio >= constraint.minimum;
    if (!valid) {
      issues.push(
        `${constraint.foreground} on ${constraint.background} has ${ratio.toFixed(2)}:1 contrast (minimum ${constraint.minimum.toFixed(2)}:1)`,
      );
    }
    return { ...constraint, ratio, valid };
  });

  const distinction = config.distinction.map((constraint) => {
    const first = colors[constraint.first];
    const second = colors[constraint.second];
    const distance = first === undefined || second === undefined ? 0 : colorDistance(first.color, second.color);
    const valid = distance >= constraint.minimumDistance;
    if (!valid) {
      issues.push(
        `${constraint.first} and ${constraint.second} are ${distance.toFixed(4)} apart (minimum ${constraint.minimumDistance.toFixed(4)})`,
      );
    }
    return { ...constraint, distance, valid };
  });

  return Object.freeze({
    valid: issues.length === 0,
    missingTokens: Object.freeze(missingTokens),
    unexpectedTokens: Object.freeze(unexpectedTokens),
    contrast: Object.freeze(contrast),
    distinction: Object.freeze(distinction),
    targetDistances: Object.freeze(targetDistances),
    issues: Object.freeze(issues),
  });
}

export function createPalette(input: PaletteInput): Palette {
  validateScene(input.scene);
  const materialNames = new Set(Object.keys(input.materials));
  for (const [name, material] of Object.entries(input.materials)) {
    validateMaterial(name, material);
  }

  const colors = {} as Record<CssTokenName, RenderedColor>;
  const tokens = {} as Record<CssTokenName, string>;
  for (const [rawName, recipe] of Object.entries(input.recipes)) {
    const name = rawName as CssTokenName;
    validateTokenRecipe(name, input.scene, materialNames, recipe);
    const material = input.materials[recipe.material];
    if (material === undefined) {
      throw new Error(`${name} references unknown material ${JSON.stringify(recipe.material)}`);
    }
    const rendered = renderToken(input.scene, material, recipe);
    colors[name] = Object.freeze(rendered);
    tokens[name] = linearRgbToCss(rendered.color, rendered.alpha);
  }

  const shadowRecipes = input.shadowRecipes ?? {};
  for (const [rawName, recipe] of Object.entries(shadowRecipes)) {
    const name = rawName as CssTokenName;
    validateShadowRecipe(name, recipe);
    tokens[name] = renderShadow(input.scene, recipe);
  }

  const glowRecipes = input.glowRecipes ?? {};
  for (const [rawName, recipe] of Object.entries(glowRecipes)) {
    const name = rawName as CssTokenName;
    validateGlowRecipe(name, recipe);
    tokens[name] = renderGlow(input.scene, recipe);
  }

  const frozenColors = Object.freeze(colors);
  const frozenTokens = Object.freeze(tokens);
  const validation =
    input.validation === undefined
      ? emptyValidation
      : validateRenderedPalette(frozenTokens, frozenColors, input.validation);

  return Object.freeze({
    scene: input.scene,
    materials: input.materials,
    recipes: input.recipes,
    shadowRecipes,
    glowRecipes,
    colors: frozenColors,
    tokens: frozenTokens,
    validation,
  });
}

export function assertPaletteValid(validation: PaletteValidation) {
  if (!validation.valid) {
    throw new Error(`Generated palette is invalid:\n${validation.issues.map((issue) => `- ${issue}`).join("\n")}`);
  }
}
