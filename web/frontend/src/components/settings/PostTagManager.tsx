import { FormEvent, useEffect, useState } from "react";

import type { CreateGroupPostTagRequest, GroupPostTag, PatchGroupPostTagRequest } from "../../types";

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
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setFormError("Tag name is required");
      return;
    }
    setFormError("");
    onCreateTag({ name: trimmedName });
    setName("");
  }

  return (
    <section className="post-tag-manager" aria-label="Post tags">
      <div className="section-title">Post tags</div>
      {error !== "" ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <form className="post-tag-create-form" onSubmit={handleCreate}>
        <label>
          Tag name
          <input
            maxLength={48}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setFormError("");
            }}
          />
        </label>
        <button type="submit" disabled={loading || saving || name.trim() === ""}>
          Add tag
        </button>
      </form>
      {formError !== "" ? (
        <div className="form-error" role="alert">
          {formError}
        </div>
      ) : null}
      <div className="post-tag-manager-list">
        {loading ? <div className="meta">Loading tags...</div> : null}
        {!loading && tags.length === 0 ? <div className="meta">No tags</div> : null}
        {tags.map((tag) => (
          <PostTagManagerRow
            deleting={deletingTagId === tag.id}
            key={tag.id}
            tag={tag}
            updating={updatingTagId === tag.id}
            onDeleteTag={onDeleteTag}
            onUpdateTag={onUpdateTag}
          />
        ))}
      </div>
    </section>
  );
}

function PostTagManagerRow({
  tag,
  updating,
  deleting,
  onUpdateTag,
  onDeleteTag,
}: {
  tag: GroupPostTag;
  updating: boolean;
  deleting: boolean;
  onUpdateTag: (tagId: string, payload: PatchGroupPostTagRequest) => void;
  onDeleteTag: (tagId: string) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [formError, setFormError] = useState("");
  const archived = tag.archived_at !== undefined;
  const busy = updating || deleting;
  const trimmedName = name.trim();
  const changed = trimmedName !== tag.name;

  useEffect(() => {
    if (busy) {
      return;
    }
    setName(tag.name);
  }, [busy, tag.name]);

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmedName === "") {
      setFormError("Tag name is required");
      return;
    }
    const payload: PatchGroupPostTagRequest = {};
    if (trimmedName !== tag.name) {
      payload.name = trimmedName;
    }
    if (Object.keys(payload).length === 0) {
      return;
    }
    setFormError("");
    onUpdateTag(tag.id, payload);
  }

  return (
    <form className={`post-tag-manager-row ${archived ? "archived" : ""}`} onSubmit={handleSave}>
      <label>
        Name
        <input
          maxLength={48}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setFormError("");
          }}
        />
      </label>
      <div className="post-tag-manager-actions">
        <button type="submit" className="secondary" disabled={busy || !changed || trimmedName === ""}>
          Save
        </button>
        {archived ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onUpdateTag(tag.id, { archived: false })}
          >
            Unarchive
          </button>
        ) : (
          <button type="button" className="danger" disabled={busy} onClick={() => onDeleteTag(tag.id)}>
            Archive
          </button>
        )}
      </div>
      {archived ? <div className="meta">Archived</div> : null}
      {formError !== "" ? (
        <div className="form-error" role="alert">
          {formError}
        </div>
      ) : null}
    </form>
  );
}
