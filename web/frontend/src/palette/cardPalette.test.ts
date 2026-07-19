import { describe, expect, test } from "bun:test";

import { compileCardPaletteForProfile, type CardPaletteIntent } from "./cardPalette";
import { arcadeDarkProfile } from "./themeProfiles";

const linkedIntent: CardPaletteIntent = {
  model: "arcade-pigment-v1",
  surface_hue: 167,
  surface_colorfulness: 72,
};

describe("Card palette accent behavior", () => {
  test("moves the author accent and spotlight when a linked surface moves", () => {
    const original = compileCardPaletteForProfile(arcadeDarkProfile, linkedIntent);
    const moved = compileCardPaletteForProfile(arcadeDarkProfile, { ...linkedIntent, surface_hue: 210 });

    expect(moved.tokens["--post-card-accent"]).not.toBe(original.tokens["--post-card-accent"]);
    expect(moved.tokens["--post-card-spotlight"]).not.toBe(original.tokens["--post-card-spotlight"]);
  });

  test("keeps an explicit custom accent independent from surface changes", () => {
    const customIntent: CardPaletteIntent = {
      ...linkedIntent,
      accent_hue: 173,
      accent_colorfulness: 74,
    };
    const original = compileCardPaletteForProfile(arcadeDarkProfile, customIntent);
    const moved = compileCardPaletteForProfile(arcadeDarkProfile, { ...customIntent, surface_hue: 210 });

    expect(moved.tokens["--post-card-accent"]).toBe(original.tokens["--post-card-accent"]);
    expect(moved.tokens["--post-card-spotlight"]).toBe(original.tokens["--post-card-spotlight"]);
  });
});
