import { FormEvent, useEffect, useState } from "react";

import type {
  CreateFeedMetricRequest,
  CreateGroupPostTagRequest,
  DailyFeed,
  FeedMetric,
  Group,
  GroupInviteCandidate,
  GroupMember,
  GroupPostTag,
  PatchFeedMetricRequest,
  PatchGroupPostTagRequest,
  Visibility,
} from "../types";
import { MetricSettingsManager } from "./MetricSettingsManager";

type GroupSettingsDialogProps = {
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
