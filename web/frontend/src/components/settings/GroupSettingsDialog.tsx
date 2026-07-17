import { useState, type ReactNode } from "react";

import type {
  CreateEvidenceFormatRequest,
  CreateEvidenceFormatVersionRequest,
  CreateFeedMetricRequest,
  CreateGroupInviteLinkRequest,
  CreateGroupPostTagRequest,
  DailyFeed,
  EvidenceFormat,
  FeedMetric,
  Group,
  GroupInviteLink,
  GroupMember,
  GroupPostTag,
  JoinPolicy,
  PatchEvidenceFormatRequest,
  PatchFeedMetricRequest,
  PatchGroupPostTagRequest,
  Visibility,
} from "../../types";
import { MetricSettingsManager } from "../MetricSettingsManager";
import { EvidenceFormatManager } from "./EvidenceFormatManager";
import { GroupMembersManager } from "./GroupMembersManager";
import { GroupVisibilityControl } from "./GroupVisibilityControl";
import { InviteLinksManager } from "./InviteLinksManager";
import { PostTagManager } from "./PostTagManager";

type GroupSettingsSectionID = "access" | "metrics" | "tags" | "formats" | "members" | "invites";

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
  inviteLinks: GroupInviteLink[];
  inviteLinksLoading: boolean;
  inviteLinksError: string;
  creatingInviteLink: boolean;
  revokingInviteLinkId: string | null;
  createdInviteURL: string;
  accessSaving: boolean;
  onClose: () => void;
  onSelectFeed: (feedId: string) => void;
  onCreateMetric: (payload: CreateFeedMetricRequest) => void;
  onUpdateMetric: (metricId: string, payload: PatchFeedMetricRequest) => void;
  onDeleteMetric: (metricId: string) => void;
  onCreateTag: (payload: CreateGroupPostTagRequest) => void;
  onUpdateTag: (tagId: string, payload: PatchGroupPostTagRequest) => void;
  onDeleteTag: (tagId: string) => void;
  onCreateFormat: (payload: CreateEvidenceFormatRequest) => void;
  onClearFormatError: () => void;
  onUpdateFormat: (formatId: string, payload: PatchEvidenceFormatRequest) => void;
  onCreateFormatVersion: (formatId: string, payload: CreateEvidenceFormatVersionRequest) => void;
  onDeleteFormat: (formatId: string) => void;
  onRemoveMember: (userId: string) => void;
  onCreateInviteLink: (payload: CreateGroupInviteLinkRequest) => void;
  onRevokeInviteLink: (linkId: string) => void;
  onClearCreatedInviteURL: () => void;
  onUpdateAccess: (visibility: Visibility, joinPolicy: JoinPolicy) => void;
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
  inviteLinks,
  inviteLinksLoading,
  inviteLinksError,
  creatingInviteLink,
  revokingInviteLinkId,
  createdInviteURL,
  accessSaving,
  onClose,
  onSelectFeed,
  onCreateMetric,
  onUpdateMetric,
  onDeleteMetric,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onCreateFormat,
  onClearFormatError,
  onUpdateFormat,
  onCreateFormatVersion,
  onDeleteFormat,
  onRemoveMember,
  onCreateInviteLink,
  onRevokeInviteLink,
  onClearCreatedInviteURL,
  onUpdateAccess,
}: GroupSettingsDialogProps) {
  const [openSection, setOpenSection] = useState<GroupSettingsSectionID | null>(null);

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
          <GroupSettingsDisclosure
            id="access"
            open={openSection === "access"}
            summary={group.visibility === "private" ? "Private" : group.join_policy === "open" ? "Open" : "Public"}
            title="Access"
            onToggle={setOpenSection}
          >
            <GroupVisibilityControl group={group} saving={accessSaving} onUpdateAccess={onUpdateAccess} />
          </GroupSettingsDisclosure>
          <GroupSettingsDisclosure
            id="metrics"
            open={openSection === "metrics"}
            summary={resourceCountSummary(metrics.length, "metric")}
            title="Metrics"
            onToggle={setOpenSection}
          >
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
          </GroupSettingsDisclosure>
          <GroupSettingsDisclosure
            id="tags"
            open={openSection === "tags"}
            summary={resourceCountSummary(tags.length, "tag")}
            title="Post tags"
            onToggle={setOpenSection}
          >
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
          </GroupSettingsDisclosure>
          <GroupSettingsDisclosure
            id="formats"
            open={openSection === "formats"}
            summary={resourceCountSummary(formats.length, "format")}
            title="Post formats"
            onToggle={setOpenSection}
          >
            <EvidenceFormatManager
              deletingFormatId={deletingFormatId}
              error={formatError}
              formats={formats}
              groupName={group.name}
              loading={loading}
              saving={formatSaving}
              updatingFormatId={updatingFormatId}
              onClearError={onClearFormatError}
              onCreateFormat={onCreateFormat}
              onCreateFormatVersion={onCreateFormatVersion}
              onDeleteFormat={onDeleteFormat}
              onUpdateFormat={onUpdateFormat}
            />
          </GroupSettingsDisclosure>
          <GroupSettingsDisclosure
            id="members"
            open={openSection === "members"}
            summary={resourceCountSummary(members.length, "member")}
            title="Members"
            onToggle={setOpenSection}
          >
            <GroupMembersManager
              currentUserId={currentUserId}
              error={membersError}
              group={group}
              loading={loading}
              members={members}
              removingUserId={removingMemberUserId}
              onRemoveMember={onRemoveMember}
            />
          </GroupSettingsDisclosure>
          <GroupSettingsDisclosure
            id="invites"
            open={openSection === "invites"}
            summary={resourceCountSummary(inviteLinks.length, "link")}
            title="Invite links"
            onToggle={setOpenSection}
          >
            <InviteLinksManager
              createdInviteURL={createdInviteURL}
              creating={creatingInviteLink}
              error={inviteLinksError}
              groupName={group.name}
              links={inviteLinks}
              loading={inviteLinksLoading}
              revokingLinkId={revokingInviteLinkId}
              onClearCreatedInviteURL={onClearCreatedInviteURL}
              onCreateInviteLink={onCreateInviteLink}
              onRevokeInviteLink={onRevokeInviteLink}
            />
          </GroupSettingsDisclosure>
        </div>
      </section>
    </div>
  );
}

function GroupSettingsDisclosure({
  id,
  title,
  summary,
  open,
  children,
  onToggle,
}: {
  id: GroupSettingsSectionID;
  title: string;
  summary: string;
  open: boolean;
  children: ReactNode;
  onToggle: (section: GroupSettingsSectionID | null) => void;
}) {
  const contentId = `group-settings-${id}`;
  return (
    <section className={`group-settings-disclosure ${open ? "group-settings-disclosure-open" : ""}`}>
      <button
        aria-controls={contentId}
        aria-expanded={open}
        aria-label={title}
        className="group-settings-disclosure-toggle"
        type="button"
        onClick={() => onToggle(open ? null : id)}
      >
        <span className="group-settings-disclosure-copy">
          <span className="section-title">{title}</span>
          <span className="meta">{summary}</span>
        </span>
        <span aria-hidden="true" className="group-settings-disclosure-icon">
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div className="group-settings-disclosure-content" id={contentId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function resourceCountSummary(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function canManageGroup(group: Group): boolean {
  return group.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}
