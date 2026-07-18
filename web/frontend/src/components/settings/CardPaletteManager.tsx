import { useState } from "react";

import type { PostCardPalette } from "../../types";
import { CardPaletteEditorDialog, type CardPaletteEditorInitialValue } from "./CardPaletteEditorDialog";
import { CardPaletteThumbnail } from "./CardPalettePreview";
import type { PostCardPaletteCollection } from "./usePostCardPalettes";

type EditorState =
  | {
      mode: "create";
      initial: CardPaletteEditorInitialValue;
    }
  | {
      mode: "edit";
      initial: CardPaletteEditorInitialValue;
      palette: PostCardPalette;
    };

export function CardPaletteManager({
  groupName,
  collection,
}: {
  groupName: string;
  collection: PostCardPaletteCollection;
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const mutationActive = collection.creating || collection.mutatingPaletteId !== null;
  const activePalettes = collection.palettes.filter((palette) => palette.archived_at === undefined);

  function openCreate(source: PostCardPalette, name = "") {
    collection.clearError();
    setEditor({
      mode: "create",
      initial: { name, materialIntent: source.material_intent },
    });
  }

  return (
    <section aria-label="Card palettes" className="card-palette-manager">
      <div className="section-header-row">
        <div className="meta">Shared card materials for post formats</div>
        <button
          aria-haspopup="dialog"
          className="secondary"
          disabled={collection.loading || mutationActive || activePalettes.length === 0}
          type="button"
          onClick={() => {
            const source = activePalettes.find((palette) => palette.system_key === "chalkboard") ?? activePalettes[0];
            if (source !== undefined) {
              openCreate(source);
            }
          }}
        >
          Add palette
        </button>
      </div>
      {collection.error !== "" && editor === null ? (
        <div className="form-error" role="alert">
          {collection.error}
        </div>
      ) : null}
      <div className="card-palette-list">
        {collection.loading ? <div className="meta">Loading palettes...</div> : null}
        {!collection.loading && collection.palettes.length === 0 ? (
          <div className="meta">No card palettes are available.</div>
        ) : null}
        {collection.palettes.map((palette) => {
          const archived = palette.archived_at !== undefined;
          const builtIn = palette.system_key !== undefined;
          const busy = collection.mutatingPaletteId === palette.id;
          const archiveBlocked = palette.active_format_count > 0;
          return (
            <article className={`card-palette-row ${archived ? "archived" : ""}`} key={palette.id}>
              <CardPaletteThumbnail materialIntent={palette.material_intent} />
              <div className="card-palette-row-copy">
                <div className="title">
                  {palette.name}
                  {builtIn ? <span className="card-palette-badge">Built-in</span> : null}
                </div>
                <div className="meta">{paletteUsageSummary(palette)}</div>
                {archived ? <div className="meta">Archived</div> : null}
              </div>
              <div className="compact-actions card-palette-row-actions">
                {!builtIn ? (
                  <button
                    aria-haspopup="dialog"
                    aria-label={`Edit ${palette.name}`}
                    className="secondary"
                    disabled={mutationActive}
                    type="button"
                    onClick={() => {
                      collection.clearError();
                      setEditor({
                        mode: "edit",
                        initial: { name: palette.name, materialIntent: palette.material_intent },
                        palette,
                      });
                    }}
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  aria-haspopup="dialog"
                  aria-label={`Duplicate ${palette.name}`}
                  className="secondary"
                  disabled={mutationActive}
                  type="button"
                  onClick={() => openCreate(palette, `${palette.name} copy`)}
                >
                  Duplicate
                </button>
                {!builtIn && archived ? (
                  <button
                    className="secondary"
                    disabled={mutationActive || busy}
                    type="button"
                    onClick={() => {
                      void collection.updatePalette(palette.id, {
                        archived: false,
                        expected_revision: palette.revision,
                      });
                    }}
                  >
                    Restore
                  </button>
                ) : null}
                {!builtIn && !archived ? (
                  <button
                    className="danger"
                    disabled={mutationActive || busy || archiveBlocked}
                    title={archiveBlocked ? "Move active formats to another palette before archiving." : undefined}
                    type="button"
                    onClick={() => {
                      void collection.updatePalette(palette.id, {
                        archived: true,
                        expected_revision: palette.revision,
                      });
                    }}
                  >
                    Archive
                  </button>
                ) : null}
              </div>
              {archiveBlocked && !builtIn && !archived ? (
                <div className="meta card-palette-row-note">Active formats block archiving.</div>
              ) : null}
            </article>
          );
        })}
      </div>
      {editor !== null ? (
        <CardPaletteEditorDialog
          error={collection.error}
          groupName={groupName}
          initial={editor.initial}
          mode={editor.mode}
          saving={collection.creating || collection.mutatingPaletteId !== null}
          activeUsageCount={editor.mode === "edit" ? editor.palette.active_format_count : 0}
          archivedUsageCount={editor.mode === "edit" ? editor.palette.archived_format_count : 0}
          onClose={() => {
            collection.clearError();
            setEditor(null);
          }}
          onDraftChanged={collection.clearError}
          onSave={async (value) => {
            const result =
              editor.mode === "create"
                ? await collection.createPalette({
                    name: value.name,
                    material_intent: value.materialIntent,
                  })
                : await collection.updatePalette(editor.palette.id, {
                    expected_revision: editor.palette.revision,
                    name: value.name,
                    material_intent: value.materialIntent,
                  });
            if (result !== null) {
              setEditor(null);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function paletteUsageSummary(palette: PostCardPalette): string {
  const active = `${palette.active_format_count} active ${palette.active_format_count === 1 ? "format" : "formats"}`;
  if (palette.archived_format_count === 0) {
    return active;
  }
  return `${active} · ${palette.archived_format_count} archived`;
}
