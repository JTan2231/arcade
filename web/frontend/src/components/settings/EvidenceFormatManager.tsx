import { useCallback, useEffect, useState } from "react";

import type {
  CreateEvidenceFormatRequest,
  CreateEvidenceFormatVersionRequest,
  EvidenceFormat,
  PatchEvidenceFormatRequest,
} from "../../types";
import { CreateEvidenceFormatDialog, EditEvidenceFormatDialog } from "./CreateEvidenceFormatDialog";
import { type EvidenceFormatEditPayloads, formatConstraintSummary } from "./evidenceFormatDraft";

type EditSubmission = EvidenceFormatEditPayloads & {
  formatId: string;
  phase: "metadata" | "version";
  sawUpdating: boolean;
};

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
  const [editFormatId, setEditFormatId] = useState<string | null>(null);
  const [editSubmission, setEditSubmission] = useState<EditSubmission | null>(null);
  const [editError, setEditError] = useState("");
  const editFormat = formats.find((format) => format.id === editFormatId);
  const formatMutationActive =
    saving || updatingFormatId !== null || deletingFormatId !== null || editSubmission !== null;
  const canAddFormat = !loading && !formatMutationActive;

  const closeCreateDialog = useCallback(() => {
    setCreateOpen(false);
    setCreateAwaitingResult(false);
    setCreateSawSaving(false);
    setCreateError("");
    onClearError();
  }, [onClearError]);

  const closeEditDialog = useCallback(() => {
    setEditFormatId(null);
    setEditSubmission(null);
    setEditError("");
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

  useEffect(() => {
    if (editFormatId === null || editSubmission === null) {
      return;
    }
    if (updatingFormatId === editFormatId) {
      if (!editSubmission.sawUpdating) {
        setEditSubmission((current) => (current === null ? null : { ...current, sawUpdating: true }));
      }
      return;
    }
    if (!editSubmission.sawUpdating) {
      return;
    }
    if (error !== "") {
      setEditError(error);
      setEditSubmission(null);
      return;
    }
    if (editSubmission.phase === "metadata" && editSubmission.version !== undefined) {
      const version = editSubmission.version;
      setEditSubmission({ ...editSubmission, phase: "version", sawUpdating: false });
      onCreateFormatVersion(editFormatId, version);
      return;
    }
    closeEditDialog();
  }, [closeEditDialog, editFormatId, editSubmission, error, onCreateFormatVersion, updatingFormatId]);

  useEffect(() => {
    if (editFormatId !== null && editFormat === undefined) {
      closeEditDialog();
    }
  }, [closeEditDialog, editFormat, editFormatId]);

  function beginEditSubmission(payloads: EvidenceFormatEditPayloads) {
    if (editFormatId === null) {
      return;
    }
    setEditError("");
    onClearError();
    if (payloads.metadata !== undefined) {
      setEditSubmission({ ...payloads, formatId: editFormatId, phase: "metadata", sawUpdating: false });
      onUpdateFormat(editFormatId, payloads.metadata);
      return;
    }
    if (payloads.version !== undefined) {
      setEditSubmission({ ...payloads, formatId: editFormatId, phase: "version", sawUpdating: false });
      onCreateFormatVersion(editFormatId, payloads.version);
    }
  }

  return (
    <section className="evidence-format-manager" aria-label="Evidence formats">
      <div className="section-header-row">
        <div>
          <div className="meta">Reusable rules for member posts</div>
        </div>
        <button
          aria-haspopup="dialog"
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
      {error !== "" && !createOpen && editFormatId === null ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="evidence-format-list">
        {loading ? <div className="meta">Loading formats...</div> : null}
        {!loading && formats.length === 0 ? <div className="meta">No formats</div> : null}
        {formats.map((format) => (
          <EvidenceFormatManagerRow
            disabled={formatMutationActive}
            deleting={deletingFormatId === format.id}
            format={format}
            key={format.id}
            updating={updatingFormatId === format.id}
            onDeleteFormat={onDeleteFormat}
            onEdit={() => {
              setCreateOpen(false);
              setEditError("");
              onClearError();
              setEditFormatId(format.id);
            }}
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
      {editFormat !== undefined ? (
        <EditEvidenceFormatDialog
          format={editFormat}
          groupName={groupName}
          saving={editSubmission !== null || updatingFormatId === editFormat.id}
          submissionError={editError}
          onClose={closeEditDialog}
          onDraftChanged={() => {
            setEditError("");
            onClearError();
          }}
          onSave={beginEditSubmission}
        />
      ) : null}
    </section>
  );
}

function EvidenceFormatManagerRow({
  format,
  disabled,
  updating,
  deleting,
  onUpdateFormat,
  onDeleteFormat,
  onEdit,
}: {
  format: EvidenceFormat;
  disabled: boolean;
  updating: boolean;
  deleting: boolean;
  onUpdateFormat: (formatId: string, payload: PatchEvidenceFormatRequest) => void;
  onDeleteFormat: (formatId: string) => void;
  onEdit: () => void;
}) {
  const archived = format.archived_at !== undefined;
  const busy = updating || deleting;
  const archiveBlocked = !archived && format.assigned_feed_count > 0;

  return (
    <div className={`evidence-format-row ${archived ? "archived" : ""}`}>
      <div className="row-top">
        <div>
          <div className="title">{format.name}</div>
          <div className="meta">
            {format.slug} · v{format.active_version.version_number} · {formatConstraintSummary(format.active_version)}
          </div>
        </div>
        <div className="compact-actions">
          {!archived ? (
            <button
              aria-haspopup="dialog"
              aria-label={`Edit ${format.name}`}
              className="secondary"
              disabled={disabled || busy}
              type="button"
              onClick={onEdit}
            >
              Edit
            </button>
          ) : null}
          {archived ? (
            <button
              type="button"
              className="secondary"
              disabled={disabled || busy}
              onClick={() => onUpdateFormat(format.id, { archived: false })}
            >
              Unarchive
            </button>
          ) : (
            <button
              type="button"
              className="danger"
              disabled={disabled || busy || archiveBlocked}
              title={archiveBlocked ? "Move feeds to another format before archiving." : undefined}
              onClick={() => onDeleteFormat(format.id)}
            >
              Archive
            </button>
          )}
        </div>
      </div>
      <div className="meta">
        {format.assigned_feed_count} {format.assigned_feed_count === 1 ? "feed" : "feeds"}
        {archived ? " · Archived" : ""}
      </div>
      {archiveBlocked ? <div className="meta">Assigned feeds block archiving.</div> : null}
    </div>
  );
}
