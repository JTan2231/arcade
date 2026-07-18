import { useSyncExternalStore } from "react";

import type { PostCardPalette, PostCardPaletteSummary } from "./types";

const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, PostCardPaletteSummary> = new Map();

export function publishPostCardPalette(palette: PostCardPaletteSummary) {
  const current = snapshot.get(palette.id);
  if (current !== undefined && current.revision >= palette.revision) {
    return;
  }

  const next = new Map(snapshot);
  next.set(palette.id, palette);
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

export function publishPostCardPalettes(palettes: ReadonlyArray<PostCardPalette | PostCardPaletteSummary>) {
  for (const palette of palettes) {
    publishPostCardPalette(palette);
  }
}

export function resolvePostCardPalette(
  embedded: PostCardPaletteSummary,
  livePalettes: ReadonlyMap<string, PostCardPaletteSummary>,
) {
  const live = livePalettes.get(embedded.id);
  return live !== undefined && live.revision >= embedded.revision ? live : embedded;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function useLivePostCardPalettes() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
