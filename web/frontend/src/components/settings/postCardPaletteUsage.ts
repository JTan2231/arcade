import type { EvidenceFormat, PostCardPalette } from "../../types";

export function derivePostCardPaletteUsage(palettes: PostCardPalette[], formats: EvidenceFormat[]): PostCardPalette[] {
  const usageByPalette = new Map<string, { active: number; archived: number }>();

  for (const format of formats) {
    const usage = usageByPalette.get(format.content_card_palette_id) ?? { active: 0, archived: 0 };
    if (format.archived_at === undefined) {
      usage.active += 1;
    } else {
      usage.archived += 1;
    }
    usageByPalette.set(format.content_card_palette_id, usage);
  }

  return palettes.map((palette) => {
    const usage = usageByPalette.get(palette.id);
    return {
      ...palette,
      active_format_count: usage?.active ?? 0,
      archived_format_count: usage?.archived ?? 0,
    };
  });
}
