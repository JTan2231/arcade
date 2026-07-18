import { describe, expect, test } from "bun:test";

import type { EvidenceFormat, PostCardPalette } from "../../types";
import { buildFormatEditPayloads, buildFormatPayload, evidenceFormatToDraft } from "./evidenceFormatDraft";
import { materialIntentFromDraft, postCardPaletteDraft, validatePostCardPaletteDraft } from "./postCardPaletteDraft";
import { derivePostCardPaletteUsage } from "./postCardPaletteUsage";
import { sortPostCardPalettes } from "./usePostCardPalettes";

const palette = postCardPalette({ id: "palette-chalkboard", name: "Chalkboard", system_key: "chalkboard" });

describe("Post Format appearance drafts", () => {
  test("includes mutable appearance when creating a format", () => {
    const payload = buildFormatPayload({
      ...evidenceFormatToDraft(evidenceFormat()),
      slug: "daily-note",
      name: "Daily note",
      contentTypeface: "serif",
      contentCardPaletteId: "palette-ocean",
    });

    expect(payload).not.toBeString();
    expect(payload).toMatchObject({
      slug: "daily-note",
      name: "Daily note",
      content_typeface: "serif",
      content_card_palette_id: "palette-ocean",
    });
  });

  test("keeps appearance changes out of immutable rule versions", () => {
    const format = evidenceFormat();
    const payloads = buildFormatEditPayloads(format, {
      ...evidenceFormatToDraft(format),
      contentTypeface: "serif",
      contentCardPaletteId: "palette-ocean",
    });

    expect(payloads).toEqual({
      metadata: {
        content_typeface: "serif",
        content_card_palette_id: "palette-ocean",
      },
    });
  });
});

describe("Card palette settings", () => {
  test("omits the optional accent as a complete pair", () => {
    const draft = postCardPaletteDraft("Soft green", palette.material_intent);
    const intent = materialIntentFromDraft({ ...draft, accentEnabled: false });

    expect(intent).toEqual({
      model: "arcade-pigment-v1",
      surface_hue: 167,
      surface_colorfulness: 95,
    });
  });

  test("sorts the active built-in first and archived palettes last", () => {
    const custom = postCardPalette({ id: "palette-custom", name: "Amber" });
    const archived = postCardPalette({ id: "palette-archived", name: "Archived", archived_at: "2026-01-01" });

    expect(sortPostCardPalettes([archived, custom, palette]).map((candidate) => candidate.id)).toEqual([
      palette.id,
      custom.id,
      archived.id,
    ]);
  });

  test("prevalidates the backend palette name limit", () => {
    const draft = postCardPaletteDraft("x".repeat(49), palette.material_intent);

    expect(validatePostCardPaletteDraft(draft)).toBe("Name must be 48 characters or fewer");
  });

  test("derives current active and archived usage from formats", () => {
    const custom = postCardPalette({
      id: "palette-ocean",
      name: "Ocean",
      active_format_count: 9,
      archived_format_count: 9,
    });
    const formats = [
      evidenceFormat({ id: "format-active", content_card_palette_id: custom.id }),
      evidenceFormat({ id: "format-archived", content_card_palette_id: custom.id, archived_at: "2026-02-01" }),
      evidenceFormat({ id: "format-built-in", content_card_palette_id: palette.id }),
    ];

    expect(
      derivePostCardPaletteUsage([palette, custom], formats).map(
        ({ id, active_format_count, archived_format_count }) => ({
          id,
          active_format_count,
          archived_format_count,
        }),
      ),
    ).toEqual([
      { id: palette.id, active_format_count: 1, archived_format_count: 0 },
      { id: custom.id, active_format_count: 1, archived_format_count: 1 },
    ]);
  });
});

function evidenceFormat(overrides: Partial<EvidenceFormat> = {}): EvidenceFormat {
  return {
    id: "format-1",
    slug: "daily-note",
    name: "Daily note",
    content_typeface: "monospace",
    content_card_palette_id: palette.id,
    content_card_palette: palette,
    active_version: {
      id: "version-1",
      format_id: "format-1",
      version_number: 1,
      min_chars: 1,
      allow_blank_lines: true,
      created_at: "2026-01-01T00:00:00Z",
    },
    assigned_feed_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function postCardPalette(overrides: Partial<PostCardPalette>): PostCardPalette {
  return {
    id: "palette-1",
    group_id: "group-1",
    name: "Palette",
    material_intent: {
      model: "arcade-pigment-v1",
      surface_hue: 167,
      surface_colorfulness: 95,
      accent_hue: 173,
      accent_colorfulness: 74,
    },
    revision: 1,
    active_format_count: 0,
    archived_format_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
