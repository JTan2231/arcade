import { FormEvent, useEffect, useId, useState } from "react";

import type { CreateGroupPostTagRequest, GroupPostTag, PatchGroupPostTagRequest } from "../../types";
import { CreateWizardDialog, CreateWizardStep } from "../CreateWizardDialog";

type TagDialog = { mode: "create" } | { mode: "edit"; tag: GroupPostTag };

export function PostTagManager({
  tags,
  error,
  loading,
  saving,
  updatingTagId,
  deletingTagId,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: {
  tags: GroupPostTag[];
  error: string;
  loading: boolean;
  saving: boolean;
  updatingTagId: string | null;
  deletingTagId: string | null;
  onCreateTag: (payload: CreateGroupPostTagRequest) => void;
  onUpdateTag: (tagId: string, payload: PatchGroupPostTagRequest) => void;
  onDeleteTag: (tagId: string) => void;
}) {
  const [dialog, setDialog] = useState<TagDialog | null>(null);
  const [awaitingResult, setAwaitingResult] = useState(false);
  const [sawSaving, setSawSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const dialogBusy =
    dialog?.mode === "create" ? saving : dialog?.mode === "edit" ? updatingTagId === dialog.tag.id : false;

  useEffect(() => {
    if (dialog === null || !awaitingResult) {
      return;
    }
    if (dialogBusy) {
      setSawSaving(true);
      return;
    }
    if (!sawSaving) {
      return;
    }
    if (error === "") {
      setDialog(null);
      setDialogError("");
    } else {
      setDialogError(error);
    }
    setAwaitingResult(false);
    setSawSaving(false);
  }, [awaitingResult, dialog, dialogBusy, error, sawSaving]);

  function openDialog(nextDialog: TagDialog) {
    setDialogError("");
    setAwaitingResult(false);
    setSawSaving(false);
    setDialog(nextDialog);
  }

  function closeDialog() {
    if (dialogBusy) {
      return;
    }
    setDialog(null);
    setDialogError("");
    setAwaitingResult(false);
    setSawSaving(false);
  }

  return (
    <section className="post-tag-manager" aria-label="Post tags">
      <div className="section-header-row">
        <div>
          <div className="meta">Reusable labels for group posts.</div>
        </div>
        <button
          aria-haspopup="dialog"
          className="secondary"
          type="button"
          disabled={loading || saving}
          onClick={() => openDialog({ mode: "create" })}
        >
          Add tag
        </button>
      </div>
      {error !== "" && dialog === null ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="post-tag-manager-list">
        {loading ? <div className="meta">Loading tags...</div> : null}
        {!loading && tags.length === 0 ? <div className="meta">No tags</div> : null}
        {tags.map((tag) => {
          const archived = tag.archived_at !== undefined;
          const busy = updatingTagId === tag.id || deletingTagId === tag.id;
          return (
            <div className={`post-tag-manager-row ${archived ? "archived" : ""}`} key={tag.id}>
              <div>
                <div className="title">{tag.name}</div>
                <div className="meta">{archived ? "Archived" : "Active"}</div>
              </div>
              <div className="post-tag-manager-actions">
                <button
                  aria-haspopup="dialog"
                  aria-label={`Edit ${tag.name}`}
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => openDialog({ mode: "edit", tag })}
                >
                  Edit
                </button>
                {archived ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => onUpdateTag(tag.id, { archived: false })}
                  >
                    Unarchive
                  </button>
                ) : (
                  <button className="danger" type="button" disabled={busy} onClick={() => onDeleteTag(tag.id)}>
                    Archive
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {dialog !== null ? (
        <PostTagDialog
          key={dialog.mode === "create" ? "create" : dialog.tag.id}
          dialog={dialog}
          saving={dialogBusy || awaitingResult}
          submissionError={dialogError}
          onClose={closeDialog}
          onSubmit={(name) => {
            setDialogError("");
            setAwaitingResult(true);
            if (dialog.mode === "create") {
              onCreateTag({ name });
            } else {
              onUpdateTag(dialog.tag.id, { name });
            }
          }}
        />
      ) : null}
    </section>
  );
}

function PostTagDialog({
  dialog,
  saving,
  submissionError,
  onClose,
  onSubmit,
}: {
  dialog: TagDialog;
  saving: boolean;
  submissionError: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const stepLabelId = useId();
  const [name, setName] = useState(dialog.mode === "edit" ? dialog.tag.name : "");
  const [validationError, setValidationError] = useState("");
  const title = dialog.mode === "create" ? "Add tag" : "Edit tag";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setValidationError("Tag name is required");
      return;
    }
    setValidationError("");
    onSubmit(trimmedName);
  }

  return (
    <CreateWizardDialog
      actionLabel={dialog.mode === "create" ? "Add tag" : "Save tag"}
      busy={saving}
      busyLabel={dialog.mode === "create" ? "Adding..." : "Saving..."}
      context={dialog.mode === "create" ? "New post tag" : dialog.tag.name}
      currentStep="name"
      currentStepIndex={0}
      error={submissionError}
      stepCount={1}
      submitDisabled={dialog.mode === "edit" && name.trim() === dialog.tag.name}
      title={title}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <CreateWizardStep
        current
        labelId={`${stepLabelId}-name`}
        number={1}
        step="name"
        title="Tag name"
        onActivate={() => undefined}
      >
        <input
          aria-label="Tag name"
          disabled={saving}
          maxLength={48}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setValidationError("");
          }}
        />
        {validationError !== "" ? (
          <div className="form-error create-wizard-step-error" role="alert">
            {validationError}
          </div>
        ) : null}
      </CreateWizardStep>
    </CreateWizardDialog>
  );
}
