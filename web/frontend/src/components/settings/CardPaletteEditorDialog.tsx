import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { compileCardPalettePair } from "../../palette";
import type { PostCardPaletteMaterialIntent } from "../../types";
import { CardPalettePreviewPair } from "./CardPalettePreview";
import { CardPaletteWheel } from "./CardPaletteWheel";
import { drawCanonicalCardPaletteWheel } from "./cardPaletteWheelRenderer";
import {
  materialIntentFromDraft,
  postCardPaletteDraft,
  sameMaterialIntent,
  validatePostCardPaletteDraft,
} from "./postCardPaletteDraft";

export type CardPaletteEditorInitialValue = {
  name: string;
  materialIntent: PostCardPaletteMaterialIntent;
};

export function CardPaletteEditorDialog({
  mode,
  groupName,
  initial,
  activeUsageCount,
  archivedUsageCount,
  saving,
  error,
  onClose,
  onDraftChanged,
  onSave,
}: {
  mode: "create" | "edit";
  groupName: string;
  initial: CardPaletteEditorInitialValue;
  activeUsageCount: number;
  archivedUsageCount: number;
  saving: boolean;
  error: string;
  onClose: () => void;
  onDraftChanged: () => void;
  onSave: (value: { name: string; materialIntent: PostCardPaletteMaterialIntent }) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(() => postCardPaletteDraft(initial.name, initial.materialIntent));
  const [editingTarget, setEditingTarget] = useState<"surface" | "accent">("surface");
  const [validationError, setValidationError] = useState("");
  const materialIntent = useMemo(() => materialIntentFromDraft(draft), [draft]);
  const compiledPair = useMemo(() => compileCardPalettePair(materialIntent), [materialIntent]);
  const renderingValid = compiledPair.dark.validation.valid && compiledPair.light.validation.valid;
  const unchanged = draft.name.trim() === initial.name && sameMaterialIntent(materialIntent, initial.materialIntent);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    nameInputRef.current?.focus();
    return () => {
      if (dialog?.open === true) {
        dialog.close();
      }
    };
  }, []);

  function updateDraft(patch: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setValidationError("");
    onDraftChanged();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validatePostCardPaletteDraft(draft);
    if (validation !== "") {
      setValidationError(validation);
      return;
    }
    if (!renderingValid) {
      setValidationError("Choose a material that stays distinct and readable in both viewer modes");
      return;
    }
    void onSave({ name: draft.name.trim(), materialIntent });
  }

  const wheelValue =
    editingTarget === "accent"
      ? { hue: draft.accentHue, colorfulness: draft.accentColorfulness }
      : { hue: draft.surfaceHue, colorfulness: draft.surfaceColorfulness };

  const dialog = (
    <dialog
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-panel card-palette-editor-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) {
          onClose();
        }
      }}
    >
      <form className="card-palette-editor-form" onSubmit={handleSubmit}>
        <header className="card-palette-editor-header">
          <div>
            <h2 id={titleId}>{mode === "create" ? "Add card palette" : `Edit ${initial.name}`}</h2>
            <div className="meta">{groupName}</div>
          </div>
          <button aria-label="Close" className="icon-button" disabled={saving} type="button" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="card-palette-editor-body">
          <div className="card-palette-editor-controls">
            <label>
              Name
              <input
                disabled={saving}
                ref={nameInputRef}
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </label>
            <div className="card-palette-target-control" role="group" aria-label="Material to edit">
              <button
                aria-pressed={editingTarget === "surface"}
                className="secondary card-palette-target-option"
                disabled={saving}
                type="button"
                onClick={() => setEditingTarget("surface")}
              >
                Surface
              </button>
              {draft.accentEnabled ? (
                <button
                  aria-pressed={editingTarget === "accent"}
                  className="secondary card-palette-target-option"
                  disabled={saving}
                  type="button"
                  onClick={() => setEditingTarget("accent")}
                >
                  Accent
                </button>
              ) : null}
            </div>
            <CardPaletteWheel
              disabled={saving}
              drawWheel={drawCanonicalCardPaletteWheel}
              label={editingTarget === "accent" ? "Accent" : "Surface"}
              value={wheelValue}
              onChange={(value) => {
                if (editingTarget === "accent") {
                  updateDraft({ accentHue: value.hue, accentColorfulness: value.colorfulness });
                } else {
                  updateDraft({ surfaceHue: value.hue, surfaceColorfulness: value.colorfulness });
                }
              }}
            />
            <label className="checkbox-row card-palette-accent-toggle">
              <input
                checked={draft.accentEnabled}
                disabled={saving}
                type="checkbox"
                onChange={(event) => {
                  const enabled = event.target.checked;
                  updateDraft({ accentEnabled: enabled });
                  setEditingTarget(enabled ? "accent" : "surface");
                }}
              />
              Use a separate accent for the border and spotlight
            </label>
            <div className="field-hint">
              The wheel chooses material hue and color intensity. Arcade derives depth, ink, borders, and spotlight for
              each viewer mode.
            </div>
          </div>
          <div className="card-palette-editor-preview">
            <div className="section-title">Preview</div>
            <CardPalettePreviewPair materialIntent={materialIntent} />
            {mode === "edit" && activeUsageCount + archivedUsageCount > 0 ? (
              <div className="card-palette-impact-note">
                Used by {paletteImpactSummary(activeUsageCount, archivedUsageCount)}. Saving changes existing posts
                everywhere those formats appear.
              </div>
            ) : null}
          </div>
          {validationError !== "" ? (
            <div className="form-error card-palette-editor-error" role="alert">
              {validationError}
            </div>
          ) : null}
          {error !== "" ? (
            <div className="form-error card-palette-editor-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <footer className="card-palette-editor-footer">
          <button className="secondary" disabled={saving} type="button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={saving || !renderingValid || (mode === "edit" && unchanged)} type="submit">
            {saving ? "Saving..." : mode === "create" ? "Add palette" : "Save palette"}
          </button>
        </footer>
      </form>
    </dialog>
  );

  return createPortal(dialog, document.body);
}

function formatUsage(count: number, status: "active" | "archived") {
  return `${count} ${status} ${count === 1 ? "format" : "formats"}`;
}

function paletteImpactSummary(activeCount: number, archivedCount: number) {
  return [
    ...(activeCount > 0 ? [formatUsage(activeCount, "active")] : []),
    ...(archivedCount > 0 ? [formatUsage(archivedCount, "archived")] : []),
  ].join(" and ");
}
