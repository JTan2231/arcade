import type { PostCardPaletteMaterialIntent } from "../../types";

export type PostCardPaletteDraft = {
  name: string;
  surfaceHue: number;
  surfaceColorfulness: number;
  accentEnabled: boolean;
  accentHue: number;
  accentColorfulness: number;
};

export function postCardPaletteDraft(
  name: string,
  materialIntent: PostCardPaletteMaterialIntent,
): PostCardPaletteDraft {
  return {
    name,
    surfaceHue: materialIntent.surface_hue,
    surfaceColorfulness: materialIntent.surface_colorfulness,
    accentEnabled: materialIntent.accent_hue !== undefined && materialIntent.accent_colorfulness !== undefined,
    accentHue: materialIntent.accent_hue ?? materialIntent.surface_hue,
    accentColorfulness: materialIntent.accent_colorfulness ?? materialIntent.surface_colorfulness,
  };
}

export function materialIntentFromDraft(draft: PostCardPaletteDraft): PostCardPaletteMaterialIntent {
  return {
    model: "arcade-pigment-v1",
    surface_hue: normalizeHue(draft.surfaceHue),
    surface_colorfulness: clampPercentage(draft.surfaceColorfulness),
    ...(draft.accentEnabled
      ? {
          accent_hue: normalizeHue(draft.accentHue),
          accent_colorfulness: clampPercentage(draft.accentColorfulness),
        }
      : {}),
  };
}

export function materialIntentWithDerivedAccent(
  materialIntent: PostCardPaletteMaterialIntent,
): PostCardPaletteMaterialIntent {
  return {
    model: materialIntent.model,
    surface_hue: materialIntent.surface_hue,
    surface_colorfulness: materialIntent.surface_colorfulness,
  };
}

export function validatePostCardPaletteDraft(draft: PostCardPaletteDraft): string {
  if (draft.name.trim() === "") {
    return "Name is required";
  }
  if ([...draft.name.trim()].length > 48) {
    return "Name must be 48 characters or fewer";
  }
  if (!Number.isInteger(draft.surfaceHue) || draft.surfaceHue < 0 || draft.surfaceHue > 359) {
    return "Surface hue must be between 0 and 359";
  }
  if (!validPercentage(draft.surfaceColorfulness)) {
    return "Surface color intensity must be between 0 and 100";
  }
  if (draft.accentEnabled && (!Number.isInteger(draft.accentHue) || draft.accentHue < 0 || draft.accentHue > 359)) {
    return "Accent hue must be between 0 and 359";
  }
  if (draft.accentEnabled && !validPercentage(draft.accentColorfulness)) {
    return "Accent color intensity must be between 0 and 100";
  }
  return "";
}

export function sameMaterialIntent(left: PostCardPaletteMaterialIntent, right: PostCardPaletteMaterialIntent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validPercentage(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

function normalizeHue(value: number): number {
  return Math.round(((value % 360) + 360) % 360);
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
