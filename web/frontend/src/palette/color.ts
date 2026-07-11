import type { ChromaResponse, LinearRgb, Oklch, ToneResponse } from "./types";

const d65White = [0.95047, 1, 1.08883] as const;
const epsilon = 1e-9;

export const black: LinearRgb = Object.freeze({ r: 0, g: 0, b: 0 });

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function add(a: LinearRgb, b: LinearRgb): LinearRgb {
  return { r: a.r + b.r, g: a.g + b.g, b: a.b + b.b };
}

export function addMany(colors: ReadonlyArray<LinearRgb>): LinearRgb {
  return colors.reduce<LinearRgb>((sum, color) => add(sum, color), black);
}

export function mul(a: LinearRgb, b: LinearRgb): LinearRgb {
  return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b };
}

export function scale(color: LinearRgb, scalar: number): LinearRgb {
  return { r: color.r * scalar, g: color.g * scalar, b: color.b * scalar };
}

export function mix(a: LinearRgb, b: LinearRgb, amount: number): LinearRgb {
  const t = clamp01(amount);
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export function luminance(color: LinearRgb) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function parseHexPair(value: string) {
  return Number.parseInt(value, 16) / 255;
}

function srgbChannelToLinear(value: number) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(value: number) {
  const bounded = clamp01(value);
  return bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * Math.pow(bounded, 1 / 2.4) - 0.055;
}

export function srgbToLinear(value: string): LinearRgb {
  const compact = value.trim().toLowerCase();
  const expanded = /^#[0-9a-f]{3}$/.test(compact)
    ? `#${compact[1]}${compact[1]}${compact[2]}${compact[2]}${compact[3]}${compact[3]}`
    : compact;

  if (!/^#[0-9a-f]{6}$/.test(expanded)) {
    throw new Error(`Expected an sRGB hex color, received ${JSON.stringify(value)}`);
  }

  return {
    r: srgbChannelToLinear(parseHexPair(expanded.slice(1, 3))),
    g: srgbChannelToLinear(parseHexPair(expanded.slice(3, 5))),
    b: srgbChannelToLinear(parseHexPair(expanded.slice(5, 7))),
  };
}

function linearRgbToXyz(color: LinearRgb): readonly [number, number, number] {
  return [
    color.r * 0.4124564 + color.g * 0.3575761 + color.b * 0.1804375,
    color.r * 0.2126729 + color.g * 0.7151522 + color.b * 0.072175,
    color.r * 0.0193339 + color.g * 0.119192 + color.b * 0.9503041,
  ];
}

function xyzToLinearRgb(xyz: readonly [number, number, number]): LinearRgb {
  const [x, y, z] = xyz;
  return {
    r: x * 3.2404542 + y * -1.5371385 + z * -0.4985314,
    g: x * -0.969266 + y * 1.8760108 + z * 0.041556,
    b: x * 0.0556434 + y * -0.2040259 + z * 1.0572252,
  };
}

function multiplyMatrix(
  matrix: ReadonlyArray<readonly [number, number, number]>,
  vector: readonly [number, number, number],
): readonly [number, number, number] {
  const [x, y, z] = vector;
  const first = matrix[0];
  const second = matrix[1];
  const third = matrix[2];
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("A color transform matrix must contain three rows");
  }
  return [
    first[0] * x + first[1] * y + first[2] * z,
    second[0] * x + second[1] * y + second[2] * z,
    third[0] * x + third[1] * y + third[2] * z,
  ];
}

const bradford = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
] as const;

const inverseBradford = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
] as const;

export function adaptWhitePoint(color: LinearRgb, adaptationWhitePoint: LinearRgb): LinearRgb {
  const sourceXyz = linearRgbToXyz(adaptationWhitePoint);
  const sourceScale = Math.max(sourceXyz[1], epsilon);
  const normalizedSource = sourceXyz.map((channel) => channel / sourceScale) as [number, number, number];
  const sourceLms = multiplyMatrix(bradford, normalizedSource);
  const referenceLms = multiplyMatrix(bradford, d65White);
  const colorLms = multiplyMatrix(bradford, linearRgbToXyz(color));
  const adaptedLms: [number, number, number] = [
    colorLms[0] * (referenceLms[0] / Math.max(sourceLms[0], epsilon)),
    colorLms[1] * (referenceLms[1] / Math.max(sourceLms[1], epsilon)),
    colorLms[2] * (referenceLms[2] / Math.max(sourceLms[2], epsilon)),
  ];
  return xyzToLinearRgb(multiplyMatrix(inverseBradford, adaptedLms));
}

export function linearRgbToOklch(color: LinearRgb): Oklch {
  const l = Math.cbrt(0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b);
  const m = Math.cbrt(0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b);
  const s = Math.cbrt(0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, b);
  const hue = chroma < epsilon ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

export function oklchToLinearRgb(color: Oklch): LinearRgb {
  const angle = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(angle);
  const b = color.c * Math.sin(angle);
  const l = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const m = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const s = color.l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

function inDisplayGamut(color: LinearRgb) {
  return color.r >= 0 && color.r <= 1 && color.g >= 0 && color.g <= 1 && color.b >= 0 && color.b <= 1;
}

export function clampGamut(color: LinearRgb): LinearRgb {
  if (inDisplayGamut(color)) {
    return color;
  }

  const source = linearRgbToOklch(color);
  const lightness = clamp01(source.l);
  let low = 0;
  let high = Math.max(0, source.c);
  let candidate = oklchToLinearRgb({ l: lightness, c: 0, h: source.h });

  for (let index = 0; index < 24; index += 1) {
    const chroma = (low + high) / 2;
    const attempt = oklchToLinearRgb({ l: lightness, c: chroma, h: source.h });
    if (inDisplayGamut(attempt)) {
      low = chroma;
      candidate = attempt;
    } else {
      high = chroma;
    }
  }

  return {
    r: clamp01(candidate.r),
    g: clamp01(candidate.g),
    b: clamp01(candidate.b),
  };
}

function interpolateChromaScale(response: ChromaResponse, value: number) {
  const points = response.byLuminance;
  const first = points[0];
  if (first === undefined) {
    return 1;
  }
  if (value <= first.luminance) {
    return first.chromaScale;
  }

  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    const previous = points[index - 1];
    if (next !== undefined && previous !== undefined && value <= next.luminance) {
      const range = Math.max(next.luminance - previous.luminance, epsilon);
      const amount = (value - previous.luminance) / range;
      return previous.chromaScale + (next.chromaScale - previous.chromaScale) * amount;
    }
  }

  return points[points.length - 1]?.chromaScale ?? 1;
}

export function applyChromaResponse(
  color: LinearRgb,
  response: ChromaResponse,
  tintStrength: number,
  neutralize: boolean,
): LinearRgb {
  const oklch = linearRgbToOklch(color);
  const responseScale = interpolateChromaScale(response, luminance(color));
  const tintScale = neutralize ? clamp01(tintStrength) : 1;
  return oklchToLinearRgb({
    l: oklch.l,
    c: oklch.c * responseScale * tintScale,
    h: oklch.h,
  });
}

function toneChannel(value: number, response: ToneResponse) {
  const range = Math.max(response.whitePoint - response.blackPoint, epsilon);
  const normalized = Math.max(0, (value - response.blackPoint) / range);
  const pivot = clamp((response.midGray - response.blackPoint) / range, epsilon, 1);
  const contrasted = pivot * Math.pow(normalized / pivot, 1 / Math.max(response.contrast, epsilon));

  let withToe = contrasted;
  if (response.toe.length > 0 && contrasted < response.toe.length) {
    const position = clamp01(contrasted / response.toe.length);
    const lifted = response.toe.length * Math.pow(position, 1 / (1 + Math.max(0, response.toe.strength)));
    withToe = contrasted + (lifted - contrasted) * clamp01(response.toe.strength);
  }

  if (withToe <= response.shoulder.start || response.shoulder.strength <= 0) {
    return clamp01(withToe);
  }

  const shoulderRange = Math.max(1 - response.shoulder.start, epsilon);
  const position = Math.max(0, (withToe - response.shoulder.start) / shoulderRange);
  const compressed = position / (1 + response.shoulder.strength * position);
  return clamp01(response.shoulder.start + shoulderRange * compressed);
}

export function applyToneResponse(color: LinearRgb, response: ToneResponse): LinearRgb {
  return {
    r: toneChannel(color.r, response),
    g: toneChannel(color.g, response),
    b: toneChannel(color.b, response),
  };
}

function inverseToneChannel(value: number, response: ToneResponse) {
  let low = response.blackPoint;
  let high = Math.max(response.whitePoint * 4, 4);
  for (let index = 0; index < 48; index += 1) {
    const middle = (low + high) / 2;
    if (toneChannel(middle, response) < value) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

export function invertToneResponse(color: LinearRgb, response: ToneResponse): LinearRgb {
  return {
    r: inverseToneChannel(color.r, response),
    g: inverseToneChannel(color.g, response),
    b: inverseToneChannel(color.b, response),
  };
}

function toByte(value: number) {
  return Math.round(linearChannelToSrgb(value) * 255);
}

function byteToHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

function formatPercentage(value: number) {
  return Number((clamp01(value) * 100).toFixed(2)).toString();
}

export function linearRgbToCss(color: LinearRgb, alpha = 1) {
  const mapped = clampGamut(color);
  const red = toByte(mapped.r);
  const green = toByte(mapped.g);
  const blue = toByte(mapped.b);
  if (alpha < 1) {
    return `rgb(${red} ${green} ${blue} / ${formatPercentage(alpha)}%)`;
  }
  return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}`;
}

export function cssColorToLinearRgb(value: string): Readonly<{ color: LinearRgb; alpha: number }> {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(normalized)) {
    return { color: srgbToLinear(normalized), alpha: 1 };
  }

  const match = normalized.match(
    /^rgb\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)%\s*\)$/,
  );
  if (match === null) {
    throw new Error(`Unsupported CSS color ${JSON.stringify(value)}`);
  }
  const red = Number(match[1]) / 255;
  const green = Number(match[2]) / 255;
  const blue = Number(match[3]) / 255;
  return {
    color: {
      r: srgbChannelToLinear(red),
      g: srgbChannelToLinear(green),
      b: srgbChannelToLinear(blue),
    },
    alpha: Number(match[4]) / 100,
  };
}

export function composite(foreground: LinearRgb, alpha: number, background: LinearRgb): LinearRgb {
  return add(scale(foreground, clamp01(alpha)), scale(background, 1 - clamp01(alpha)));
}

export function contrastRatio(foreground: LinearRgb, background: LinearRgb) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function colorDistance(a: LinearRgb, b: LinearRgb) {
  const first = linearRgbToOklch(a);
  const second = linearRgbToOklch(b);
  const firstAngle = (first.h * Math.PI) / 180;
  const secondAngle = (second.h * Math.PI) / 180;
  const firstA = first.c * Math.cos(firstAngle);
  const firstB = first.c * Math.sin(firstAngle);
  const secondA = second.c * Math.cos(secondAngle);
  const secondB = second.c * Math.sin(secondAngle);
  return Math.hypot(first.l - second.l, firstA - secondA, firstB - secondB);
}
