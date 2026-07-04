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
  PatchEvidenceFormatRequest,
  PatchFeedMetricRequest,
  PatchGroupPostTagRequest,
  Visibility,
} from "../../types";
import { MetricSettingsManager } from "../MetricSettingsManager";
import { EvidenceFormatManager } from "./EvidenceFormatManager";
import { GroupMembersManager } from "./GroupMembersManager";
import { GroupVisibilityControl } from "./GroupVisibilityControl";
import { InviteFriends } from "./InviteFriends";
import { PostTagManager } from "./PostTagManager";

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

function canManageGroup(group: Group): boolean {
  return group.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}
