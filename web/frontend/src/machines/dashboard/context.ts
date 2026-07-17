import { todayDateValue } from "../../dates";
import type { FeedMetric, Group } from "../../types";
import type { DashboardContext, DashboardInput, UpdatePostPayload } from "./events";

export function initialDashboardContext(input: DashboardInput): DashboardContext {
  return {
    currentUserId: input.user?.id ?? "",
    groups: [],
    selectedGroupId: null,
    preferredGroupId: null,
    ...resetSelectedGroupContext(),
    pendingGroupName: "",
    pendingDeleteGroupId: null,
  };
}

export function resetSelectedGroupContext(): Omit<
  DashboardContext,
  "currentUserId" | "groups" | "selectedGroupId" | "preferredGroupId" | "pendingGroupName" | "pendingDeleteGroupId"
> {
  return {
    feeds: [],
    selectedFeedId: null,
    selectedFeedDate: todayDateValue(),
    feedsError: "",
    output: null,
    outputError: "",
    postTags: [],
    postTagsError: "",
    evidenceFormats: [],
    evidenceFormatsError: "",
    groupMembers: [],
    groupMembersError: "",
    groupSettingsOpen: false,
    groupAccessMutation: null,
    posts: [],
    postsError: "",
    ...resetMetricContext(),
    pendingToggleFeedId: null,
    pendingRefreshFeedId: null,
    pendingDeleteFeedId: null,
    managedFeedEventsFeedId: null,
    feedEventsChanged: false,
    postMutation: null,
    postTagMutation: null,
    evidenceFormatMutation: null,
    feedCaptionsMutation: null,
    feedFormatMutation: null,
    feedScheduleMutation: null,
    groupMemberMutation: null,
  };
}

export function resetMetricContext(): Pick<
  DashboardContext,
  | "metrics"
  | "selectedMetricId"
  | "metricLeaderboard"
  | "metricsLoaded"
  | "metricsError"
  | "metricMutation"
  | "judgmentMutation"
> {
  return {
    metrics: [],
    selectedMetricId: null,
    metricLeaderboard: null,
    metricsLoaded: false,
    metricsError: "",
    metricMutation: null,
    judgmentMutation: null,
  };
}

export function chooseGroupId(
  groups: Group[],
  preferredGroupId: string | null,
  currentGroupId: string | null,
): string | null {
  const preferredSelectedId =
    preferredGroupId !== null ? groups.find((group) => group.id === preferredGroupId)?.id : undefined;
  const currentSelectedId =
    currentGroupId !== null ? groups.find((group) => group.id === currentGroupId)?.id : undefined;
  return (
    preferredSelectedId ??
    currentSelectedId ??
    groups.find((group) => group.my_status === "active")?.id ??
    groups[0]?.id ??
    null
  );
}

export function chooseMetricId(metrics: FeedMetric[], currentMetricId: string | null): string | null {
  if (currentMetricId !== null && metrics.some((metric) => metric.id === currentMetricId)) {
    return currentMetricId;
  }
  return metrics[0]?.id ?? null;
}

export function selectedGroupCanManage(context: DashboardContext): boolean {
  const group = context.groups.find((candidate) => candidate.id === context.selectedGroupId);
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

export function validPostUpdatePayload(payload: UpdatePostPayload): boolean {
  if (payload.evidenceText !== undefined && payload.evidenceText.trim() === "") {
    return false;
  }
  return payload.evidenceText !== undefined || payload.caption !== undefined || payload.tagIds !== undefined;
}
