import { FormEvent, useCallback, useEffect, useState } from "react";

import type {
  CreateEvidenceFormatRequest,
  CreateEvidenceFormatVersionRequest,
  EvidenceFormat,
  PatchEvidenceFormatRequest,
} from "../../types";
import { CreateEvidenceFormatDialog } from "./CreateEvidenceFormatDialog";
import { EvidenceFormatConstraintFields } from "./EvidenceFormatConstraintFields";
import type { EvidenceFormatDraft } from "./evidenceFormatDraft";
import {
  buildVersionPayload,
  formatConstraintSummary,
  formatVersionToDraft,
  versionPayload,
} from "./evidenceFormatDraft";

export function EvidenceFormatManager({
  groupName,
  formats,
  error,
  loading,
  saving,
  updatingFormatId,
  deletingFormatId,
  onCreateFormat,
  onClearError,
  onUpdateFormat,
  onCreateFormatVersion,
  onDeleteFormat,
}: {
  groupName: string;
  formats: EvidenceFormat[];
  error: string;
  loading: boolean;
  saving: boolean;
  updatingFormatId: string | null;
  deletingFormatId: string | null;
  onCreateFormat: (payload: CreateEvidenceFormatRequest) => void;
  onClearError: () => void;
  onUpdateFormat: (formatId: string, payload: PatchEvidenceFormatRequest) => void;
  onCreateFormatVersion: (formatId: string, payload: CreateEvidenceFormatVersionRequest) => void;
  onDeleteFormat: (formatId: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createAwaitingResult, setCreateAwaitingResult] = useState(false);
  const [createSawSaving, setCreateSawSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const canAddFormat = !loading && !saving;

  const closeCreateDialog = useCallback(() => {
    setCreateOpen(false);
    setCreateAwaitingResult(false);
    setCreateSawSaving(false);
    setCreateError("");
    onClearError();
  }, [onClearError]);

  useEffect(() => {
    if (!createOpen || !createAwaitingResult) {
      return;
    }
    if (saving) {
      setCreateSawSaving(true);
      return;
    }
    if (!createSawSaving) {
      return;
    }
    if (error === "") {
      closeCreateDialog();
      return;
    }
    setCreateError(error);
    setCreateAwaitingResult(false);
    setCreateSawSaving(false);
  }, [closeCreateDialog, createAwaitingResult, createOpen, createSawSaving, error, saving]);

  return (
    <section className="evidence-format-manager" aria-label="Evidence formats">
      <div className="section-header-row">
        <div>
          <div className="section-title">Post formats</div>
          <div className="meta">Reusable rules for member posts</div>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={!canAddFormat}
          onClick={() => {
            setCreateError("");
            onClearError();
            setCreateOpen(true);
          }}
        >
          Add format
        </button>
      </div>
      {error !== "" && !createOpen ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="evidence-format-list">
        {loading ? <div className="meta">Loading formats...</div> : null}
        {!loading && formats.length === 0 ? <div className="meta">No formats</div> : null}
        {formats.map((format) => (
          <EvidenceFormatManagerRow
            deleting={deletingFormatId === format.id}
            format={format}
            key={format.id}
            updating={updatingFormatId === format.id}
            onCreateFormatVersion={onCreateFormatVersion}
            onDeleteFormat={onDeleteFormat}
            onUpdateFormat={onUpdateFormat}
          />
        ))}
      </div>
      {createOpen ? (
        <CreateEvidenceFormatDialog
          groupName={groupName}
          saving={saving || createAwaitingResult}
          submissionError={createError}
          onClose={closeCreateDialog}
          onDraftChanged={() => {
            setCreateError("");
            onClearError();
          }}
          onCreate={(payload) => {
            setCreateError("");
            setCreateAwaitingResult(true);
            onCreateFormat(payload);
          }}
        />
      ) : null}
    </section>
  );
}

function EvidenceFormatManagerRow({
  format,
  updating,
  deleting,
  onUpdateFormat,
  onCreateFormatVersion,
  onDeleteFormat,
}: {
  format: EvidenceFormat;
  updating: boolean;
  deleting: boolean;
  onUpdateFormat: (formatId: string, payload: PatchEvidenceFormatRequest) => void;
  onCreateFormatVersion: (formatId: string, payload: CreateEvidenceFormatVersionRequest) => void;
  onDeleteFormat: (formatId: string) => void;
}) {
  const [name, setName] = useState(format.name);
  const [description, setDescription] = useState(format.description ?? "");
  const [draft, setDraft] = useState<EvidenceFormatDraft>(() => formatVersionToDraft(format.active_version));
  const [formError, setFormError] = useState("");
  const archived = format.archived_at !== undefined;
  const busy = updating || deleting;
  const metadataChanged = name.trim() !== format.name || description.trim() !== (format.description ?? "");
  const constraintsChanged =
    JSON.stringify(buildVersionPayload(draft)) !== JSON.stringify(versionPayload(format.active_version));
  const archiveBlocked = !archived && format.assigned_feed_count > 0;

  useEffect(() => {
    if (busy) {
      return;
    }
    setName(format.name);
    setDescription(format.description ?? "");
    setDraft(formatVersionToDraft(format.active_version));
  }, [busy, format]);

  function updateDraft(patch: Partial<EvidenceFormatDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError("");
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setFormError("Name is required");
      return;
    }
    const metadataPayload: PatchEvidenceFormatRequest = {};
    if (trimmedName !== format.name) {
      metadataPayload.name = trimmedName;
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription !== (format.description ?? "")) {
      metadataPayload.description = trimmedDescription === "" ? null : trimmedDescription;
    }
    const constraintsPayload = buildVersionPayload(draft);
    if (typeof constraintsPayload === "string") {
      setFormError(constraintsPayload);
      return;
    }
    setFormError("");
    if (Object.keys(metadataPayload).length > 0) {
      onUpdateFormat(format.id, metadataPayload);
    }
    if (constraintsChanged) {
      onCreateFormatVersion(format.id, constraintsPayload);
    }
  }

  return (
    <form className={`evidence-format-row ${archived ? "archived" : ""}`} onSubmit={handleSave}>
      <div className="row-top">
        <div>
          <div className="title">{format.name}</div>
          <div className="meta">
            {format.slug} · v{format.active_version.version_number} · {formatConstraintSummary(format.active_version)}
          </div>
        </div>
        <div className="meta">{format.assigned_feed_count} feeds</div>
      </div>
      <div className="form-grid two-column">
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </div>
      <EvidenceFormatConstraintFields draft={draft} onChange={updateDraft} />
      <div className="post-tag-manager-actions">
        <button
          type="submit"
          className="secondary"
          disabled={busy || (!metadataChanged && !constraintsChanged) || name.trim() === "" || archived}
        >
          Save
        </button>
        {archived ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onUpdateFormat(format.id, { archived: false })}
          >
            Unarchive
          </button>
        ) : (
          <button
            type="button"
            className="danger"
            disabled={busy || archiveBlocked}
            title={archiveBlocked ? "Move feeds to another format before archiving." : undefined}
            onClick={() => onDeleteFormat(format.id)}
          >
            Archive
          </button>
        )}
      </div>
      {archived ? <div className="meta">Archived</div> : null}
      {archiveBlocked ? <div className="meta">Assigned feeds block archiving.</div> : null}
      {formError !== "" ? (
        <div className="form-error" role="alert">
          {formError}
        </div>
      ) : null}
    </form>
  );
}
