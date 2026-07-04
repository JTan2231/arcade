import { FormEvent, useEffect, useState } from "react";

import type {
  CreateEvidenceFormatRequest,
  CreateEvidenceFormatVersionRequest,
  EvidenceFormat,
  PatchEvidenceFormatRequest,
} from "../../types";
import type { EvidenceFormatDraft } from "./evidenceFormatDraft";
import {
  buildFormatPayload,
  buildVersionPayload,
  emptyFormatDraft,
  formatConstraintSummary,
  formatVersionToDraft,
  versionPayload,
} from "./evidenceFormatDraft";

export function EvidenceFormatManager({
  formats,
  error,
  loading,
  saving,
  updatingFormatId,
  deletingFormatId,
  onCreateFormat,
  onUpdateFormat,
  onCreateFormatVersion,
  onDeleteFormat,
}: {
  formats: EvidenceFormat[];
  error: string;
  loading: boolean;
  saving: boolean;
  updatingFormatId: string | null;
  deletingFormatId: string | null;
  onCreateFormat: (payload: CreateEvidenceFormatRequest) => void;
  onUpdateFormat: (formatId: string, payload: PatchEvidenceFormatRequest) => void;
  onCreateFormatVersion: (formatId: string, payload: CreateEvidenceFormatVersionRequest) => void;
  onDeleteFormat: (formatId: string) => void;
}) {
  const [draft, setDraft] = useState<EvidenceFormatDraft>(emptyFormatDraft);
  const [formError, setFormError] = useState("");

  function updateDraft(patch: Partial<EvidenceFormatDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError("");
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = buildFormatPayload(draft);
    if (typeof payload === "string") {
      setFormError(payload);
      return;
    }
    setFormError("");
    onCreateFormat(payload);
    setDraft(emptyFormatDraft);
  }

  return (
    <section className="evidence-format-manager" aria-label="Evidence formats">
      <div className="section-title">Post formats</div>
      {error !== "" ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <form className="evidence-format-create-form" onSubmit={handleCreate}>
        <div className="form-grid two-column">
          <label>
            Slug
            <input value={draft.slug} onChange={(event) => updateDraft({ slug: event.target.value })} />
          </label>
          <label>
            Name
            <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
          </label>
        </div>
        <label>
          Description
          <textarea value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
        </label>
        <EvidenceFormatConstraintFields draft={draft} onChange={updateDraft} />
        <button type="submit" disabled={loading || saving || draft.slug.trim() === "" || draft.name.trim() === ""}>
          Add format
        </button>
      </form>
      {formError !== "" ? (
        <div className="form-error" role="alert">
          {formError}
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

function EvidenceFormatConstraintFields({
  draft,
  onChange,
}: {
  draft: EvidenceFormatDraft;
  onChange: (patch: Partial<EvidenceFormatDraft>) => void;
}) {
  return (
    <>
      <div className="form-grid three-column">
        <label>
          Min chars
          <input
            min="1"
            type="number"
            value={draft.minChars}
            onChange={(event) => onChange({ minChars: event.target.value })}
          />
        </label>
        <label>
          Max chars
          <input
            min="1"
            type="number"
            value={draft.maxChars}
            onChange={(event) => onChange({ maxChars: event.target.value })}
          />
        </label>
        <label className="checkbox-row status-checkbox">
          <input
            checked={draft.allowBlankLines}
            type="checkbox"
            onChange={(event) => onChange({ allowBlankLines: event.target.checked })}
          />
          Blank lines
        </label>
      </div>
      <div className="form-grid three-column">
        <label>
          Line mode
          <select
            value={draft.lineMode}
            onChange={(event) => onChange({ lineMode: event.target.value as "range" | "exact" })}
          >
            <option value="range">Range</option>
            <option value="exact">Exact</option>
          </select>
        </label>
        {draft.lineMode === "exact" ? (
          <label>
            Exact lines
            <input
              min="1"
              type="number"
              value={draft.exactLines}
              onChange={(event) => onChange({ exactLines: event.target.value })}
            />
          </label>
        ) : (
          <>
            <label>
              Min lines
              <input
                min="1"
                type="number"
                value={draft.minLines}
                onChange={(event) => onChange({ minLines: event.target.value })}
              />
            </label>
            <label>
              Max lines
              <input
                min="1"
                type="number"
                value={draft.maxLines}
                onChange={(event) => onChange({ maxLines: event.target.value })}
              />
            </label>
          </>
        )}
      </div>
      <div className="form-grid two-column">
        <label>
          Line min chars
          <input
            min="1"
            type="number"
            value={draft.lineMinChars}
            onChange={(event) => onChange({ lineMinChars: event.target.value })}
          />
        </label>
        <label>
          Line max chars
          <input
            min="1"
            type="number"
            value={draft.lineMaxChars}
            onChange={(event) => onChange({ lineMaxChars: event.target.value })}
          />
        </label>
      </div>
    </>
  );
}
