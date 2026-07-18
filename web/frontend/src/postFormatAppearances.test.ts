import { describe, expect, test } from "bun:test";

import { comparePostFormatAppearanceUpdatedAt } from "./postFormatAppearances";

describe("post format appearance ordering", () => {
  test("orders variable-precision RFC3339 timestamps chronologically", () => {
    expect(comparePostFormatAppearanceUpdatedAt("2026-07-18T12:00:00.1Z", "2026-07-18T12:00:00.11Z")).toBeLessThan(0);
    expect(comparePostFormatAppearanceUpdatedAt("2026-07-18T12:00:00Z", "2026-07-18T12:00:00.000001Z")).toBeLessThan(0);
    expect(
      comparePostFormatAppearanceUpdatedAt("2026-07-18T12:00:00.100001Z", "2026-07-18T12:00:00.100002Z"),
    ).toBeLessThan(0);
  });

  test("normalizes timezone offsets before comparing", () => {
    expect(comparePostFormatAppearanceUpdatedAt("2026-07-18T07:00:00.25-05:00", "2026-07-18T12:00:00.25Z")).toBe(0);
    expect(
      comparePostFormatAppearanceUpdatedAt("2026-07-18T07:00:00.250001-05:00", "2026-07-18T12:00:00.25Z"),
    ).toBeGreaterThan(0);
  });
});
