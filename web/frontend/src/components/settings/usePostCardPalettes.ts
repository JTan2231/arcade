import { useCallback, useEffect, useState } from "react";

import { createGroupPostCardPalette, listGroupPostCardPalettes, updateGroupPostCardPalette } from "../../api";
import { publishPostCardPalette, publishPostCardPalettes } from "../../postCardPalettes";
import type { CreatePostCardPaletteRequest, PatchPostCardPaletteRequest, PostCardPalette } from "../../types";

export type PostCardPaletteCollection = {
  palettes: PostCardPalette[];
  error: string;
  loading: boolean;
  mutatingPaletteId: string | null;
  creating: boolean;
  clearError: () => void;
  createPalette: (payload: CreatePostCardPaletteRequest) => Promise<PostCardPalette | null>;
  updatePalette: (paletteId: string, payload: PatchPostCardPaletteRequest) => Promise<PostCardPalette | null>;
};

export function usePostCardPalettes(groupId: string): PostCardPaletteCollection {
  const [palettes, setPalettes] = useState<PostCardPalette[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutatingPaletteId, setMutatingPaletteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    void listGroupPostCardPalettes(groupId, { includeArchived: true }, { signal: controller.signal })
      .then((result) => {
        publishPostCardPalettes(result);
        setPalettes(sortPostCardPalettes(result));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [groupId]);

  const createPalette = useCallback(
    async (payload: CreatePostCardPaletteRequest) => {
      setCreating(true);
      setError("");
      try {
        const created = await createGroupPostCardPalette(groupId, payload);
        publishPostCardPalette(created);
        setPalettes((current) => upsertPostCardPalette(current, created));
        return created;
      } catch (reason: unknown) {
        setError(errorMessage(reason));
        return null;
      } finally {
        setCreating(false);
      }
    },
    [groupId],
  );

  const updatePalette = useCallback(
    async (paletteId: string, payload: PatchPostCardPaletteRequest) => {
      setMutatingPaletteId(paletteId);
      setError("");
      try {
        const updated = await updateGroupPostCardPalette(groupId, paletteId, payload);
        publishPostCardPalette(updated);
        setPalettes((current) => upsertPostCardPalette(current, updated));
        return updated;
      } catch (reason: unknown) {
        setError(errorMessage(reason));
        return null;
      } finally {
        setMutatingPaletteId(null);
      }
    },
    [groupId],
  );

  return {
    palettes,
    error,
    loading,
    mutatingPaletteId,
    creating,
    clearError: () => setError(""),
    createPalette,
    updatePalette,
  };
}

export function sortPostCardPalettes(palettes: PostCardPalette[]): PostCardPalette[] {
  return [...palettes].sort((left, right) => {
    const leftArchived = left.archived_at !== undefined;
    const rightArchived = right.archived_at !== undefined;
    if (leftArchived !== rightArchived) {
      return leftArchived ? 1 : -1;
    }
    const leftBuiltIn = left.system_key !== undefined;
    const rightBuiltIn = right.system_key !== undefined;
    if (leftBuiltIn !== rightBuiltIn) {
      return leftBuiltIn ? -1 : 1;
    }
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    return byName === 0 ? left.id.localeCompare(right.id) : byName;
  });
}

function upsertPostCardPalette(palettes: PostCardPalette[], palette: PostCardPalette): PostCardPalette[] {
  return sortPostCardPalettes([...palettes.filter((candidate) => candidate.id !== palette.id), palette]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
