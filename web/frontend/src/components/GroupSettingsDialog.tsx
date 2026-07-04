import { FormEvent, useEffect, useState } from "react";

import type {
  CreateEvidenceFormatRequest,
  CreateEvidenceFormatVersionRequest,
  CreateFeedMetricRequest,
  CreateGroupPostTagRequest,
  DailyFeed,
  EvidenceFormat,
  FeedMetric,
  Group,
  GroupInviteCandidate,
  GroupMember,
  GroupPostTag,
  PatchFeedMetricRequest,
  PatchEvidenceFormatRequest,
  PatchGroupPostTagRequest,
  Visibility,
} from "../types";
import { MetricSettingsManager } from "./MetricSettingsManager";

export type GroupSettingsDialogProps = {
  group: Group;
  loading: boolean;
  currentUserId: string | null;
  feeds: DailyFeed[];
  selectedFeedId: string | null;
  metrics: FeedMetric[];
  metricsLoading: boolean;
  metricsError: string;
  metricSubmitting: boolean;
  updatingMetricId: string | null;
  deletingMetricId: string | null;
  tags: GroupPostTag[];
  tagError: string;
  tagSaving: boolean;
  updatingTagId: string | null;
  deletingTagId: string | null;
  formats: EvidenceFormat[];
  formatError: string;
  formatSaving: boolean;
  updatingFormatId: string | null;
  deletingFormatId: string | null;
  members: GroupMember[];
  membersError: string;
  removingMemberUserId: string | null;
  inviteCandidates: GroupInviteCandidate[];
  inviteCandidatesLoading: boolean;
  invitingUserId: string | null;
  visibilitySaving: boolean;
  onClose: () => void;
  onSelectFeed: (feedId: string) => void;
  onCreateMetric: (payload: CreateFeedMetricRequest) => void;
  onUpdateMetric: (metricId: string, payload: PatchFeedMetricRequest) => void;
  onDeleteMetric: (metricId: string) => void;
  onCreateTag: (payload: CreateGroupPostTagRequest) => void;
  onUpdateTag: (tagId: string, payload: PatchGroupPostTagRequest) => void;
  onDeleteTag: (tagId: string) => void;
  onCreateFormat: (payload: CreateEvidenceFormatRequest) => void;
  onUpdateFormat: (formatId: string, payload: PatchEvidenceFormatRequest) => void;
  onCreateFormatVersion: (formatId: string, payload: CreateEvidenceFormatVersionRequest) => void;
  onDeleteFormat: (formatId: string) => void;
  onRemoveMember: (userId: string) => void;
  onInviteFriend: (userId: string) => void;
  onCancelGroupInvite: (userId: string) => void;
  onUpdateVisibility: (visibility: Visibility) => void;
};

export function GroupSettingsDialog({
  group,
  loading,
  currentUserId,
  feeds,
  selectedFeedId,
  metrics,
  metricsLoading,
  metricsError,
  metricSubmitting,
  updatingMetricId,
  deletingMetricId,
  tags,
  tagError,
  tagSaving,
  updatingTagId,
  deletingTagId,
  formats,
  formatError,
  formatSaving,
  updatingFormatId,
  deletingFormatId,
  members,
  membersError,
  removingMemberUserId,
  inviteCandidates,
  inviteCandidatesLoading,
  invitingUserId,
  visibilitySaving,
  onClose,
  onSelectFeed,
  onCreateMetric,
  onUpdateMetric,
  onDeleteMetric,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onCreateFormat,
  onUpdateFormat,
  onCreateFormatVersion,
  onDeleteFormat,
  onRemoveMember,
  onInviteFriend,
  onCancelGroupInvite,
  onUpdateVisibility,
}: GroupSettingsDialogProps) {
  if (!canManageGroup(group)) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel group-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="group-settings-title">Settings</h2>
            <div className="meta">{group.name}</div>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {loading ? <div className="meta">Loading settings...</div> : null}
        <div className="group-settings-grid">
          <GroupVisibilityControl group={group} saving={visibilitySaving} onUpdateVisibility={onUpdateVisibility} />
          <MetricSettingsManager
            deletingMetricId={deletingMetricId}
            error={metricsError}
            feeds={feeds}
            metricSubmitting={metricSubmitting}
            metrics={metrics}
            metricsLoading={metricsLoading}
            selectedFeedId={selectedFeedId}
            updatingMetricId={updatingMetricId}
            onCreateMetric={onCreateMetric}
            onDeleteMetric={onDeleteMetric}
            onSelectFeed={onSelectFeed}
            onUpdateMetric={onUpdateMetric}
          />
          <PostTagManager
            deletingTagId={deletingTagId}
            error={tagError}
            loading={loading}
            saving={tagSaving}
            tags={tags}
            updatingTagId={updatingTagId}
            onCreateTag={onCreateTag}
            onDeleteTag={onDeleteTag}
            onUpdateTag={onUpdateTag}
          />
          <EvidenceFormatManager
            deletingFormatId={deletingFormatId}
            error={formatError}
            formats={formats}
            loading={loading}
            saving={formatSaving}
            updatingFormatId={updatingFormatId}
            onCreateFormat={onCreateFormat}
            onCreateFormatVersion={onCreateFormatVersion}
            onDeleteFormat={onDeleteFormat}
            onUpdateFormat={onUpdateFormat}
          />
          <GroupMembersManager
            currentUserId={currentUserId}
            error={membersError}
            group={group}
            loading={loading}
            members={members}
            removingUserId={removingMemberUserId}
            onRemoveMember={onRemoveMember}
          />
          <InviteFriends
            candidates={inviteCandidates}
            loading={inviteCandidatesLoading}
            invitingUserId={invitingUserId}
            onCancelGroupInvite={onCancelGroupInvite}
            onInviteFriend={onInviteFriend}
          />
        </div>
      </section>
    </div>
  );
}

function GroupVisibilityControl({
  group,
  saving,
  onUpdateVisibility,
}: {
  group: Group;
  saving: boolean;
  onUpdateVisibility: (visibility: Visibility) => void;
}) {
  return (
    <section className="group-visibility-section" aria-label="Group visibility">
      <div className="section-title">Visibility</div>
      <label htmlFor="group-visibility-select">Visibility</label>
      <select
        id="group-visibility-select"
        disabled={saving}
        value={group.visibility}
        onChange={(event) => onUpdateVisibility(event.target.value as Visibility)}
      >
        <option value="public">Public</option>
        <option value="private">Private</option>
      </select>
      <div className="meta">
        {group.visibility === "public" ? "Visible on public group pages and discovery." : "Visible only to members."}
      </div>
    </section>
  );
}

function PostTagManager({
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

type EvidenceFormatDraft = {
  slug: string;
  name: string;
  description: string;
  minChars: string;
  maxChars: string;
  lineMode: "range" | "exact";
  minLines: string;
  maxLines: string;
  exactLines: string;
  lineMinChars: string;
  lineMaxChars: string;
  allowBlankLines: boolean;
};

const emptyFormatDraft: EvidenceFormatDraft = {
  slug: "",
  name: "",
  description: "",
  minChars: "1",
  maxChars: "",
  lineMode: "range",
  minLines: "",
  maxLines: "",
  exactLines: "",
  lineMinChars: "",
  lineMaxChars: "",
  allowBlankLines: true,
};

function EvidenceFormatManager({
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

function buildFormatPayload(draft: EvidenceFormatDraft): CreateEvidenceFormatRequest | string {
  const version = buildVersionPayload(draft);
  if (typeof version === "string") {
    return version;
  }
  const slug = draft.slug.trim();
  const name = draft.name.trim();
  if (slug === "") {
    return "Slug is required";
  }
  if (name === "") {
    return "Name is required";
  }
  return {
    slug,
    name,
    ...(draft.description.trim() !== "" ? { description: draft.description.trim() } : {}),
    ...version,
  };
}

function buildVersionPayload(draft: EvidenceFormatDraft): CreateEvidenceFormatVersionRequest | string {
  const parsedMinChars = parsePositiveInteger(draft.minChars);
  const maxChars = parseOptionalPositiveInteger(draft.maxChars);
  const minLines = draft.lineMode === "range" ? parseOptionalPositiveInteger(draft.minLines) : undefined;
  const maxLines = draft.lineMode === "range" ? parseOptionalPositiveInteger(draft.maxLines) : undefined;
  const exactLines = draft.lineMode === "exact" ? parsePositiveInteger(draft.exactLines) : undefined;
  const lineMinChars = parseOptionalPositiveInteger(draft.lineMinChars);
  const lineMaxChars = parseOptionalPositiveInteger(draft.lineMaxChars);
  if (
    parsedMinChars === "invalid" ||
    maxChars === "invalid" ||
    minLines === "invalid" ||
    maxLines === "invalid" ||
    exactLines === "invalid" ||
    lineMinChars === "invalid" ||
    lineMaxChars === "invalid"
  ) {
    return "Constraint values must be positive integers";
  }
  const minChars = parsedMinChars ?? 1;
  if (draft.lineMode === "exact" && exactLines === undefined) {
    return "Exact lines is required";
  }
  if (maxChars !== undefined && maxChars < minChars) {
    return "Max chars must be at least min chars";
  }
  if (minLines !== undefined && maxLines !== undefined && maxLines < minLines) {
    return "Max lines must be at least min lines";
  }
  if (lineMinChars !== undefined && lineMaxChars !== undefined && lineMaxChars < lineMinChars) {
    return "Line max chars must be at least line min chars";
  }
  return {
    min_chars: minChars,
    ...(maxChars !== undefined ? { max_chars: maxChars } : {}),
    ...(minLines !== undefined ? { min_lines: minLines } : {}),
    ...(maxLines !== undefined ? { max_lines: maxLines } : {}),
    ...(exactLines !== undefined ? { exact_lines: exactLines } : {}),
    ...(lineMinChars !== undefined ? { line_min_chars: lineMinChars } : {}),
    ...(lineMaxChars !== undefined ? { line_max_chars: lineMaxChars } : {}),
    allow_blank_lines: draft.allowBlankLines,
  };
}

function parsePositiveInteger(value: string): number | "invalid" | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

function parseOptionalPositiveInteger(value: string): number | "invalid" | undefined {
  return parsePositiveInteger(value);
}

function formatVersionToDraft(version: EvidenceFormat["active_version"]): EvidenceFormatDraft {
  return {
    slug: "",
    name: "",
    description: "",
    minChars: String(version.min_chars),
    maxChars: version.max_chars?.toString() ?? "",
    lineMode: version.exact_lines !== undefined ? "exact" : "range",
    minLines: version.min_lines?.toString() ?? "",
    maxLines: version.max_lines?.toString() ?? "",
    exactLines: version.exact_lines?.toString() ?? "",
    lineMinChars: version.line_min_chars?.toString() ?? "",
    lineMaxChars: version.line_max_chars?.toString() ?? "",
    allowBlankLines: version.allow_blank_lines,
  };
}

function versionPayload(version: EvidenceFormat["active_version"]): CreateEvidenceFormatVersionRequest {
  return {
    min_chars: version.min_chars,
    ...(version.max_chars !== undefined ? { max_chars: version.max_chars } : {}),
    ...(version.min_lines !== undefined ? { min_lines: version.min_lines } : {}),
    ...(version.max_lines !== undefined ? { max_lines: version.max_lines } : {}),
    ...(version.exact_lines !== undefined ? { exact_lines: version.exact_lines } : {}),
    ...(version.line_min_chars !== undefined ? { line_min_chars: version.line_min_chars } : {}),
    ...(version.line_max_chars !== undefined ? { line_max_chars: version.line_max_chars } : {}),
    allow_blank_lines: version.allow_blank_lines,
  };
}

function formatConstraintSummary(version: EvidenceFormat["active_version"]): string {
  const parts: string[] = [];
  if (version.max_chars !== undefined) {
    parts.push(`${version.min_chars}-${version.max_chars} chars`);
  } else {
    parts.push(`${version.min_chars}+ chars`);
  }
  if (version.exact_lines !== undefined) {
    parts.push(`${version.exact_lines} lines`);
  } else if (version.min_lines !== undefined || version.max_lines !== undefined) {
    parts.push(`${version.min_lines ?? 1}-${version.max_lines ?? "any"} lines`);
  }
  if (!version.allow_blank_lines) {
    parts.push("no blanks");
  }
  return parts.join(" · ");
}

function GroupMembersManager({
  group,
  members,
  currentUserId,
  loading,
  error,
  removingUserId,
  onRemoveMember,
}: {
  group: Group;
  members: GroupMember[];
  currentUserId: string | null;
  loading: boolean;
  error: string;
  removingUserId: string | null;
  onRemoveMember: (userId: string) => void;
}) {
  return (
    <section className="group-members-manager" aria-label="Group members">
      <div className="section-title">Group members</div>
      {error !== "" ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="group-member-list">
        {loading ? <div className="meta">Loading members...</div> : null}
        {!loading && members.length === 0 ? <div className="meta">No members</div> : null}
        {members.map((member) => {
          const displayName = member.display_name || member.username;
          const removing = removingUserId === member.user_id;
          const removable = canRemoveMember(group, member, members);
          return (
            <div className="row group-member-row" key={member.user_id}>
              <div className="group-member-summary">
                <div className="title">{displayName}</div>
                <div className="meta">
                  @{member.username} · {roleLabel(member.role)} · {statusLabel(member.status)}
                  {member.user_id === currentUserId ? " · You" : ""}
                </div>
              </div>
              <button
                aria-label={`Remove ${displayName}`}
                className="danger"
                disabled={removing || !removable}
                type="button"
                onClick={() => onRemoveMember(member.user_id)}
              >
                {removing ? "Removing..." : "Remove"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InviteFriends({
  candidates,
  loading,
  invitingUserId,
  onInviteFriend,
  onCancelGroupInvite,
}: {
  candidates: GroupInviteCandidate[];
  loading: boolean;
  invitingUserId: string | null;
  onInviteFriend: (userId: string) => void;
  onCancelGroupInvite: (userId: string) => void;
}) {
  return (
    <section className="invite-friends-section group-settings-invite-section" aria-label="Invite friends">
      <div className="section-title">Invite friends</div>
      <div className="stack">
        {loading ? <div className="meta">Loading friends...</div> : null}
        {!loading && !candidates.length ? <div className="meta">No eligible friends</div> : null}
        {candidates.map((candidate) => {
          const pending = candidate.membership_status === "invited";
          return (
            <div className="row social-row" key={candidate.user.id}>
              <div>
                <div className="title">{candidate.user.display_name || candidate.user.username}</div>
                <div className="meta">@{candidate.user.username}</div>
              </div>
              <button
                className={pending ? "secondary" : undefined}
                type="button"
                disabled={invitingUserId === candidate.user.id}
                onClick={() => {
                  if (pending) {
                    onCancelGroupInvite(candidate.user.id);
                    return;
                  }
                  onInviteFriend(candidate.user.id);
                }}
              >
                {pending ? "Cancel" : "Invite"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function canManageGroup(group: Group): boolean {
  return group.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

function canRemoveMember(group: Group, member: GroupMember, members: GroupMember[]): boolean {
  if (!canManageGroup(group)) {
    return false;
  }
  if (group.my_role === "admin") {
    return member.role === "member";
  }
  if (group.my_role !== "owner") {
    return false;
  }
  if (member.role !== "owner" || member.status !== "active") {
    return true;
  }
  const activeOwners = members.filter((candidate) => candidate.role === "owner" && candidate.status === "active");
  return activeOwners.length > 1;
}

function roleLabel(role: GroupMember["role"]): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
  }
}

function statusLabel(status: GroupMember["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "invited":
      return "Invited";
    case "left":
      return "Left";
    case "removed":
      return "Removed";
  }
}
