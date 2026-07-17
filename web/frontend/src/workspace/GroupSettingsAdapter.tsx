import { GroupSettingsDialog } from "../components/settings/GroupSettingsDialog";
import type { InviteLinkAdapterProps } from "../invites/useInviteLinks";
import { matchesChildState, matchesGrandchildState } from "../machines/stateMatches";
import type { DashboardContext } from "../machines/dashboardMachine";
import { feedPath } from "../routes";
import type { DailyFeed, Group } from "../types";
import { EMPTY_EVIDENCE_FORMATS, EMPTY_GROUP_MEMBERS, EMPTY_METRICS, EMPTY_POST_TAGS } from "./empty";
import type { DashboardActorRef, Navigate } from "./types";

export function GroupSettingsAdapter({
  dashboardRef,
  dashboardContext,
  dashboardStateValue,
  selectedGroup,
  feeds,
  selectedFeedId,
  currentUserId,
  inviteLinkProps,
  onNavigate,
}: {
  dashboardRef: DashboardActorRef | undefined;
  dashboardContext: DashboardContext | null;
  dashboardStateValue: unknown;
  selectedGroup: Group | null;
  feeds: DailyFeed[];
  selectedFeedId: string | null;
  currentUserId: string | null;
  inviteLinkProps: InviteLinkAdapterProps;
  onNavigate: Navigate;
}) {
  if (dashboardContext?.groupSettingsOpen !== true || selectedGroup === null) {
    return null;
  }

  const loadingFeeds = matchesChildState(dashboardStateValue, "groupSelected", "loadingFeeds");
  const creatingPostTag = matchesChildState(dashboardStateValue, "groupSelected", "creatingPostTag");
  const creatingEvidenceFormat = matchesChildState(dashboardStateValue, "groupSelected", "creatingEvidenceFormat");
  const loadingMetrics = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "loadingMetrics");
  const creatingMetric = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "creatingMetric");
  const postTagMutation = dashboardContext.postTagMutation;
  const updatingPostTagId = postTagMutation?.kind === "update" ? postTagMutation.tagId : null;
  const deletingPostTagId = postTagMutation?.kind === "delete" ? postTagMutation.tagId : null;
  const evidenceFormatMutation = dashboardContext.evidenceFormatMutation;
  const updatingEvidenceFormatId =
    evidenceFormatMutation?.kind === "update" || evidenceFormatMutation?.kind === "version"
      ? evidenceFormatMutation.formatId
      : null;
  const deletingEvidenceFormatId = evidenceFormatMutation?.kind === "delete" ? evidenceFormatMutation.formatId : null;
  const groupMemberMutation = dashboardContext.groupMemberMutation;
  const removingMemberUserId = groupMemberMutation?.userId ?? null;
  const updatingGroupVisibility = dashboardContext.groupVisibilityMutation !== null;
  const metricMutation = dashboardContext.metricMutation;
  const updatingMetricId = metricMutation?.kind === "update" ? metricMutation.metricId : null;
  const deletingMetricId = metricMutation?.kind === "delete" ? metricMutation.metricId : null;

  return (
    <GroupSettingsDialog
      currentUserId={currentUserId}
      deletingTagId={deletingPostTagId}
      deletingFormatId={deletingEvidenceFormatId}
      deletingMetricId={deletingMetricId}
      formatError={dashboardContext.evidenceFormatsError}
      formatSaving={creatingEvidenceFormat}
      formats={dashboardContext.evidenceFormats ?? EMPTY_EVIDENCE_FORMATS}
      feeds={feeds}
      group={selectedGroup}
      inviteLinks={inviteLinkProps.inviteLinks}
      inviteLinksLoading={inviteLinkProps.inviteLinksLoading}
      inviteLinksError={inviteLinkProps.inviteLinksError}
      creatingInviteLink={inviteLinkProps.creatingInviteLink}
      revokingInviteLinkId={inviteLinkProps.revokingInviteLinkId}
      createdInviteURL={inviteLinkProps.createdInviteURL}
      loading={loadingFeeds}
      members={dashboardContext.groupMembers ?? EMPTY_GROUP_MEMBERS}
      membersError={dashboardContext.groupMembersError}
      metricSubmitting={creatingMetric}
      metrics={dashboardContext.metrics ?? EMPTY_METRICS}
      metricsError={dashboardContext.metricsError}
      metricsLoading={loadingMetrics}
      removingMemberUserId={removingMemberUserId}
      selectedFeedId={selectedFeedId}
      tagError={dashboardContext.postTagsError}
      tagSaving={creatingPostTag}
      tags={dashboardContext.postTags ?? EMPTY_POST_TAGS}
      updatingFormatId={updatingEvidenceFormatId}
      updatingMetricId={updatingMetricId}
      updatingTagId={updatingPostTagId}
      visibilitySaving={updatingGroupVisibility}
      onClearCreatedInviteURL={inviteLinkProps.onClearCreatedInviteURL}
      onClose={() => dashboardRef?.send({ type: "GROUP_SETTINGS_CLOSED" })}
      onClearFormatError={() => dashboardRef?.send({ type: "EVIDENCE_FORMAT_ERROR_CLEARED" })}
      onCreateMetric={(payload) => dashboardRef?.send({ type: "METRIC_CREATE_SUBMITTED", payload })}
      onCreateFormat={(payload) => dashboardRef?.send({ type: "EVIDENCE_FORMAT_CREATE_SUBMITTED", payload })}
      onCreateFormatVersion={(formatId, payload) =>
        dashboardRef?.send({ type: "EVIDENCE_FORMAT_VERSION_CREATE_SUBMITTED", formatId, payload })
      }
      onCreateTag={(payload) => dashboardRef?.send({ type: "POST_TAG_CREATE_SUBMITTED", payload })}
      onDeleteFormat={(formatId) => dashboardRef?.send({ type: "EVIDENCE_FORMAT_DELETE_SUBMITTED", formatId })}
      onDeleteMetric={(metricId) => dashboardRef?.send({ type: "METRIC_DELETE_SUBMITTED", metricId })}
      onDeleteTag={(tagId) => dashboardRef?.send({ type: "POST_TAG_DELETE_SUBMITTED", tagId })}
      onCreateInviteLink={inviteLinkProps.onCreateInviteLink}
      onRemoveMember={(userId) => dashboardRef?.send({ type: "GROUP_MEMBER_REMOVE_SUBMITTED", userId })}
      onRevokeInviteLink={inviteLinkProps.onRevokeInviteLink}
      onSelectFeed={(feedId) => {
        onNavigate(feedPath(feedId));
        dashboardRef?.send({ type: "FEED_SELECTED", feedId });
      }}
      onUpdateVisibility={(visibility) =>
        dashboardRef?.send({ type: "GROUP_VISIBILITY_CHANGED", groupId: selectedGroup.id, visibility })
      }
      onUpdateMetric={(metricId, payload) => dashboardRef?.send({ type: "METRIC_UPDATE_SUBMITTED", metricId, payload })}
      onUpdateFormat={(formatId, payload) =>
        dashboardRef?.send({ type: "EVIDENCE_FORMAT_UPDATE_SUBMITTED", formatId, payload })
      }
      onUpdateTag={(tagId, payload) => dashboardRef?.send({ type: "POST_TAG_UPDATE_SUBMITTED", tagId, payload })}
    />
  );
}
