import type { AddFeedOutputEvent } from "../addFeedMachine";
import type { FeedCyclesOutputEvent } from "../feedCyclesMachine";
import type { FeedEventsOutputEvent } from "../feedEventsMachine";
import type {
  CreateEvidenceFormatRequest,
  CreateEvidenceFormatVersionRequest,
  CreateFeedMetricRequest,
  CreateGroupPostTagRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedSchedule,
  EvidenceFormat,
  FeedMetric,
  Group,
  GroupFeedPost,
  GroupMember,
  GroupPostTag,
  JoinPolicy,
  MetricLeaderboard,
  PatchEvidenceFormatRequest,
  PatchFeedMetricRequest,
  PatchGroupPostTagRequest,
  PatchGroupRequest,
  User,
  Visibility,
} from "../../types";

type CreatePostPayload = {
  evidenceText: string;
  caption: string;
};

export type UpdatePostPayload = {
  evidenceText?: string;
  caption?: string;
  tagIds?: string[];
};

export type PostMutation =
  | {
      kind: "create";
      evidenceText: string;
      caption: string;
    }
  | {
      kind: "update";
      postId: string;
      evidenceText?: string;
      caption?: string;
      tagIds?: string[];
    }
  | {
      kind: "delete";
      postId: string;
    };

export type PostTagMutation =
  | {
      kind: "create";
      payload: CreateGroupPostTagRequest;
    }
  | {
      kind: "update";
      tagId: string;
      payload: PatchGroupPostTagRequest;
    }
  | {
      kind: "delete";
      tagId: string;
    };

export type EvidenceFormatMutation =
  | {
      kind: "create";
      payload: CreateEvidenceFormatRequest;
    }
  | {
      kind: "update";
      formatId: string;
      payload: PatchEvidenceFormatRequest;
    }
  | {
      kind: "version";
      formatId: string;
      payload: CreateEvidenceFormatVersionRequest;
    }
  | {
      kind: "delete";
      formatId: string;
    };

export type FeedFormatMutation = {
  feedId: string;
  evidenceFormatId: string;
};

export type FeedCaptionsMutation = {
  feedId: string;
  captionsEnabled: boolean;
};

export type FeedScheduleMutation = {
  feedId: string;
  schedule: DailyFeedSchedule;
};

export type GroupMemberMutation = {
  userId: string;
};

export type GroupAccessMutation = {
  groupId: string;
  visibility: Visibility;
  joinPolicy: JoinPolicy;
};

export type MetricMutation =
  | {
      kind: "create";
      payload: CreateFeedMetricRequest;
    }
  | {
      kind: "update";
      metricId: string;
      payload: PatchFeedMetricRequest;
    }
  | {
      kind: "delete";
      metricId: string;
    };

export type JudgmentMutation = {
  metricId: string;
  postId: string;
  value: number;
  note: string;
};

export type DashboardContext = {
  currentUserId: string;
  groups: Group[];
  selectedGroupId: string | null;
  preferredGroupId: string | null;

  feeds: DailyFeed[];
  selectedFeedId: string | null;
  selectedFeedDate: string;
  feedsError: string;

  output: DailyFeedOutput | null;
  outputError: string;

  postTags: GroupPostTag[];
  postTagsError: string;
  evidenceFormats: EvidenceFormat[];
  evidenceFormatsError: string;
  groupMembers: GroupMember[];
  groupMembersError: string;
  groupSettingsOpen: boolean;
  groupAccessMutation: GroupAccessMutation | null;
  posts: GroupFeedPost[];
  postsError: string;

  metrics: FeedMetric[];
  selectedMetricId: string | null;
  metricLeaderboard: MetricLeaderboard | null;
  metricsLoaded: boolean;
  metricsError: string;

  pendingGroupName: string;
  pendingToggleFeedId: string | null;
  pendingRefreshFeedId: string | null;
  pendingDeleteGroupId: string | null;
  pendingDeleteFeedId: string | null;
  managedFeedCyclesFeedId: string | null;
  feedCyclesChanged: boolean;
  managedFeedEventsFeedId: string | null;
  feedEventsChanged: boolean;
  postMutation: PostMutation | null;
  postTagMutation: PostTagMutation | null;
  evidenceFormatMutation: EvidenceFormatMutation | null;
  feedCaptionsMutation: FeedCaptionsMutation | null;
  feedFormatMutation: FeedFormatMutation | null;
  feedScheduleMutation: FeedScheduleMutation | null;
  groupMemberMutation: GroupMemberMutation | null;
  metricMutation: MetricMutation | null;
  judgmentMutation: JudgmentMutation | null;
};

export type DashboardInput = {
  user: User | null;
};

type DashboardUserEvent =
  | { type: "GROUPS_REFRESH_REQUESTED"; preferredGroupId?: string | null }
  | { type: "GROUP_CREATE_SUBMITTED"; name: string }
  | { type: "GROUP_SELECTED"; groupId: string }
  | { type: "GROUP_SETTINGS_OPENED"; groupId: string }
  | { type: "GROUP_SETTINGS_CLOSED" }
  | { type: "GROUP_ACCESS_CHANGED"; groupId: string; visibility: Visibility; joinPolicy: JoinPolicy }
  | { type: "GROUP_DELETE_SUBMITTED"; groupId: string }
  | { type: "FEED_SELECTED"; feedId: string }
  | { type: "FEED_DATE_CHANGED"; date: string }
  | { type: "FEED_ENABLED_TOGGLED"; feedId: string }
  | { type: "FEED_CAPTIONS_TOGGLED"; feedId: string }
  | { type: "FEED_FORMAT_CHANGED"; feedId: string; evidenceFormatId: string }
  | { type: "FEED_SCHEDULE_CHANGED"; feedId: string; schedule: DailyFeedSchedule }
  | { type: "FEED_GENERATION_REFRESHED"; feedId: string }
  | { type: "FEED_DELETE_SUBMITTED"; feedId: string }
  | { type: "POST_CREATE_SUBMITTED"; payload: CreatePostPayload }
  | { type: "POST_UPDATE_SUBMITTED"; postId: string; payload: UpdatePostPayload }
  | { type: "POST_DELETE_SUBMITTED"; postId: string }
  | { type: "POST_TAG_CREATE_SUBMITTED"; payload: CreateGroupPostTagRequest }
  | { type: "POST_TAG_UPDATE_SUBMITTED"; tagId: string; payload: PatchGroupPostTagRequest }
  | { type: "POST_TAG_DELETE_SUBMITTED"; tagId: string }
  | { type: "EVIDENCE_FORMAT_CREATE_SUBMITTED"; payload: CreateEvidenceFormatRequest }
  | { type: "EVIDENCE_FORMAT_ERROR_CLEARED" }
  | { type: "EVIDENCE_FORMAT_UPDATE_SUBMITTED"; formatId: string; payload: PatchEvidenceFormatRequest }
  | { type: "EVIDENCE_FORMAT_VERSION_CREATE_SUBMITTED"; formatId: string; payload: CreateEvidenceFormatVersionRequest }
  | { type: "EVIDENCE_FORMAT_DELETE_SUBMITTED"; formatId: string }
  | { type: "GROUP_MEMBER_REMOVE_SUBMITTED"; userId: string }
  | { type: "METRIC_SELECTED"; metricId: string }
  | { type: "METRIC_CREATE_SUBMITTED"; payload: CreateFeedMetricRequest }
  | { type: "METRIC_UPDATE_SUBMITTED"; metricId: string; payload: PatchFeedMetricRequest }
  | { type: "METRIC_DELETE_SUBMITTED"; metricId: string }
  | { type: "JUDGMENT_CREATE_SUBMITTED"; metricId: string; postId: string; value: number; note: string }
  | { type: "ADD_FEED_OPENED" }
  | { type: "ADD_FEED_CLOSED" }
  | { type: "FEED_CYCLES_OPENED"; feedId: string }
  | { type: "FEED_CYCLES_CLOSED" }
  | { type: "FEED_EVENTS_OPENED"; feedId: string }
  | { type: "FEED_EVENTS_CLOSED" };

export type DashboardOutputEvent = { type: "UNAUTHORIZED" } | { type: "TOAST_REQUESTED"; message: string };

export type DashboardEvent = DashboardUserEvent | AddFeedOutputEvent | FeedCyclesOutputEvent | FeedEventsOutputEvent;

export type UserScopedInput = {
  currentUserId: string;
};

export type FeedInput = UserScopedInput & {
  groupId: string;
  feedId: string;
};

export type GroupWorkspaceInput = UserScopedInput & {
  groupId: string;
  includeArchivedPostTags: boolean;
  includeArchivedEvidenceFormats: boolean;
  includeGroupMembers: boolean;
};

export type GroupWorkspaceOutput = {
  feeds: DailyFeed[];
  postTags: GroupPostTag[];
  postTagsError: string;
  evidenceFormats: EvidenceFormat[];
  evidenceFormatsError: string;
  groupMembers: GroupMember[];
  groupMembersError: string;
};

export type DatedFeedInput = FeedInput & {
  date: string;
};

export type MetricInput = FeedInput & {
  metricId: string;
};

export type ToggleFeedInput = UserScopedInput & {
  groupId: string;
  feed: DailyFeed;
};

export type ChangeFeedFormatInput = FeedInput & {
  evidenceFormatId: string;
};

export type ChangeFeedCaptionsInput = FeedInput & {
  captionsEnabled: boolean;
};

export type ChangeFeedScheduleInput = FeedInput & {
  schedule: DailyFeedSchedule;
};

export type UpdateGroupAccessInput = UserScopedInput & {
  groupId: string;
  payload: PatchGroupRequest;
};

export type DeleteGroupOutput = {
  groupId: string;
};

export type DeleteGroupMemberOutput = {
  userId: string;
};

export type DeleteFeedOutput = {
  feedId: string;
};

export type CreatePostInput = DatedFeedInput & CreatePostPayload;

export type UpdatePostInput = UserScopedInput & {
  groupId: string;
  postId: string;
  evidenceText?: string;
  caption?: string;
  tagIds?: string[];
};

export type DeletePostOutput = {
  postId: string;
};

export type DeletePostInput = UserScopedInput & {
  groupId: string;
  feedId: string;
  date: string;
  postId: string;
};

export type CreatePostTagInput = UserScopedInput & {
  groupId: string;
  payload: CreateGroupPostTagRequest;
};

export type UpdatePostTagInput = UserScopedInput & {
  groupId: string;
  tagId: string;
  payload: PatchGroupPostTagRequest;
};

export type CreateEvidenceFormatInput = UserScopedInput & {
  groupId: string;
  payload: CreateEvidenceFormatRequest;
};

export type UpdateEvidenceFormatInput = UserScopedInput & {
  groupId: string;
  formatId: string;
  payload: PatchEvidenceFormatRequest;
};

export type CreateEvidenceFormatVersionInput = UserScopedInput & {
  groupId: string;
  formatId: string;
  payload: CreateEvidenceFormatVersionRequest;
};

export type CreateMetricInput = FeedInput & {
  payload: CreateFeedMetricRequest;
};

export type UpdateMetricInput = MetricInput & {
  payload: PatchFeedMetricRequest;
};

export type DeleteMetricOutput = {
  metricId: string;
};

export type CreateJudgmentInput = MetricInput & {
  postId: string;
  value: number;
  note: string;
};

export type UpdateJudgmentInput = UserScopedInput & {
  groupId: string;
  feedId: string;
  metricId: string;
  judgmentId: string;
  value?: number;
  note?: string | null;
};

export type DeleteJudgmentInput = UserScopedInput & {
  groupId: string;
  feedId: string;
  metricId: string;
  judgmentId: string;
};
