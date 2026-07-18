import { useSyncExternalStore } from "react";

import type { EvidenceFormat, PostCardPaletteSummary, PostContentTypeface } from "./types";

export type PostFormatAppearance = Readonly<{
  contentCardPalette: PostCardPaletteSummary;
  contentTypeface: PostContentTypeface;
  formatId: string;
  updatedAt: string;
}>;

const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, PostFormatAppearance> = new Map();

function rfc3339Nanoseconds(value: string): bigint | null {
  const match = /^(.*:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }

  const [, wholeSecond, rawFraction = "", offset] = match;
  const wholeSecondMillis = Date.parse(`${wholeSecond}${offset}`);
  if (!Number.isFinite(wholeSecondMillis)) {
    return null;
  }

  const fractionalNanoseconds = BigInt(rawFraction.padEnd(9, "0"));
  return BigInt(wholeSecondMillis) * 1_000_000n + fractionalNanoseconds;
}

export function comparePostFormatAppearanceUpdatedAt(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  const leftNanoseconds = rfc3339Nanoseconds(left);
  const rightNanoseconds = rfc3339Nanoseconds(right);
  if (leftNanoseconds !== null && rightNanoseconds !== null) {
    return leftNanoseconds === rightNanoseconds ? 0 : leftNanoseconds < rightNanoseconds ? -1 : 1;
  }

  return left < right ? -1 : 1;
}

export function publishPostFormatAppearance(format: EvidenceFormat) {
  const appearance: PostFormatAppearance = {
    contentCardPalette: format.content_card_palette,
    contentTypeface: format.content_typeface,
    formatId: format.id,
    updatedAt: format.updated_at,
  };
  const current = snapshot.get(format.id);
  if (current !== undefined && comparePostFormatAppearanceUpdatedAt(current.updatedAt, appearance.updatedAt) >= 0) {
    return;
  }

  const next = new Map(snapshot);
  next.set(format.id, appearance);
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

export function publishPostFormatAppearances(formats: ReadonlyArray<EvidenceFormat>) {
  for (const format of formats) {
    publishPostFormatAppearance(format);
  }
}

export function resolvePostFormatAppearance(
  embedded: EvidenceFormat,
  liveAppearances: ReadonlyMap<string, PostFormatAppearance>,
): PostFormatAppearance {
  const live = liveAppearances.get(embedded.id);
  if (live !== undefined && comparePostFormatAppearanceUpdatedAt(live.updatedAt, embedded.updated_at) >= 0) {
    return live;
  }
  return {
    contentCardPalette: embedded.content_card_palette,
    contentTypeface: embedded.content_typeface,
    formatId: embedded.id,
    updatedAt: embedded.updated_at,
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function useLivePostFormatAppearances() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
