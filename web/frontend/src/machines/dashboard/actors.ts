import { fromPromise } from "xstate";

import {
  createFeedMetric,
  createFeedMetricJudgment,
  createGroup,
  createGroupEvidenceFormat,
  createGroupEvidenceFormatVersion,
  createGroupFeedPost,
  createGroupPostTag,
  deleteFeedMetric,
  deleteFeedMetricJudgment,
  deleteGroup,
  deleteGroupDailyFeed,
  deleteGroupEvidenceFormat,
  deleteGroupFeedPost,
  deleteGroupMember,
  deleteGroupPostTag,
  getFeedMetric,
  getGroupDailyFeedOutput,
  getGroupDailyFeedToday,
  getGroupEvidenceFormat,
  getGroupPostTag,
  getMetricLeaderboard,
  isUnauthorized,
  listFeedMetrics,
  listGroupDailyFeeds,
  listGroupEvidenceFormats,
  listGroupFeedPosts,
  listGroupMembers,
  listGroupPostTags,
  listGroups,
  refreshGroupDailyFeedToday,
  updateFeedMetric,
  updateFeedMetricJudgment,
  updateGroup,
  updateGroupDailyFeed,
  updateGroupEvidenceFormat,
  updateGroupFeedPost,
  updateGroupPostTag,
} from "../../api";
import { errorMessage } from "../../errors";
import type {
  DailyFeed,
  DailyFeedOutput,
  EvidenceFormat,
  FeedMetric,
  Group,
  GroupFeedPost,
  GroupMember,
  GroupPostTag,
  MetricLeaderboard,
} from "../../types";
import { addFeedMachine } from "../addFeedMachine";
import type {
  ChangeFeedFormatInput,
  ChangeFeedScheduleInput,
  CreateEvidenceFormatInput,
  CreateEvidenceFormatVersionInput,
  CreateJudgmentInput,
  CreateMetricInput,
  CreatePostInput,
  CreatePostTagInput,
  DatedFeedInput,
  DeletePostOutput,
  DeleteFeedOutput,
  DeleteGroupMemberOutput,
  DeleteGroupOutput,
  DeleteJudgmentInput,
  DeleteMetricOutput,
  FeedInput,
  GroupWorkspaceInput,
  GroupWorkspaceOutput,
  MetricInput,
  ToggleFeedInput,
  UpdateEvidenceFormatInput,
  UpdateGroupVisibilityInput,
  UpdateJudgmentInput,
  UpdateMetricInput,
  UpdatePostInput,
  UpdatePostTagInput,
} from "./events";

export const dashboardActors = {
  addFeedMachine,
  listGroups: fromPromise<Group[], undefined>(({ signal }) => listGroups({ signal })),
  createGroup: fromPromise<Group, { name: string }>(({ input, signal }) =>
    createGroup({ name: input.name }, { signal }),
  ),
  updateGroupVisibility: fromPromise<Group, UpdateGroupVisibilityInput>(({ input, signal }) =>
    updateGroup(input.groupId, input.payload, { signal }),
  ),
  deleteGroup: fromPromise<DeleteGroupOutput, { groupId: string }>(async ({ input, signal }) => {
    await deleteGroup(input.groupId, { signal });
    return { groupId: input.groupId };
  }),
  deleteGroupMember: fromPromise<DeleteGroupMemberOutput, { groupId: string; userId: string }>(
    async ({ input, signal }) => {
      await deleteGroupMember(input.groupId, input.userId, { signal });
      return { userId: input.userId };
    },
  ),
  loadGroupWorkspace: fromPromise<GroupWorkspaceOutput, GroupWorkspaceInput>(async ({ input, signal }) => {
    const feeds = await listGroupDailyFeeds(input.groupId, { signal });
    let postTags: GroupPostTag[] = [];
    let postTagsError = "";
    try {
      postTags = await listGroupPostTags(input.groupId, { includeArchived: input.includeArchivedPostTags }, { signal });
    } catch (error) {
      if (isUnauthorized(error)) {
        throw error;
      }
      postTagsError = errorMessage(error);
    }

    let evidenceFormats: EvidenceFormat[] = [];
    let evidenceFormatsError = "";
    try {
      evidenceFormats = await listGroupEvidenceFormats(
        input.groupId,
        { includeArchived: input.includeArchivedEvidenceFormats },
        { signal },
      );
    } catch (error) {
      if (isUnauthorized(error)) {
        throw error;
      }
      evidenceFormatsError = errorMessage(error);
    }

    let groupMembers: GroupMember[] = [];
    let groupMembersError = "";
    if (input.includeGroupMembers) {
      try {
        groupMembers = await listGroupMembers(input.groupId, { signal });
      } catch (error) {
        if (isUnauthorized(error)) {
          throw error;
        }
        groupMembersError = errorMessage(error);
      }
    }

    return { feeds, postTags, postTagsError, evidenceFormats, evidenceFormatsError, groupMembers, groupMembersError };
  }),
  getGroupDailyFeedToday: fromPromise<DailyFeedOutput, FeedInput>(({ input, signal }) =>
    getGroupDailyFeedToday(input.groupId, input.feedId, { signal }),
  ),
  getGroupDailyFeedOutput: fromPromise<DailyFeedOutput, DatedFeedInput>(({ input, signal }) =>
    getGroupDailyFeedOutput(input.groupId, input.feedId, input.date, { signal }),
  ),
  listGroupFeedPosts: fromPromise<GroupFeedPost[], DatedFeedInput>(({ input, signal }) =>
    listGroupFeedPosts(input.groupId, input.feedId, input.date, { signal }),
  ),
  listFeedMetrics: fromPromise<FeedMetric[], FeedInput>(({ input, signal }) =>
    listFeedMetrics(input.groupId, input.feedId, { signal }),
  ),
  getFeedMetric: fromPromise<FeedMetric, MetricInput>(({ input, signal }) =>
    getFeedMetric(input.groupId, input.feedId, input.metricId, { signal }),
  ),
  getMetricLeaderboard: fromPromise<MetricLeaderboard, MetricInput>(({ input, signal }) =>
    getMetricLeaderboard(input.groupId, input.feedId, input.metricId, { signal }),
  ),
  toggleFeed: fromPromise<DailyFeed, ToggleFeedInput>(({ input, signal }) =>
    updateGroupDailyFeed(input.groupId, input.feed.id, { enabled: !input.feed.enabled }, { signal }),
  ),
  changeFeedFormat: fromPromise<DailyFeed, ChangeFeedFormatInput>(({ input, signal }) =>
    updateGroupDailyFeed(input.groupId, input.feedId, { evidence_format_id: input.evidenceFormatId }, { signal }),
  ),
  changeFeedSchedule: fromPromise<DailyFeed, ChangeFeedScheduleInput>(({ input, signal }) =>
    updateGroupDailyFeed(input.groupId, input.feedId, { schedule: input.schedule }, { signal }),
  ),
  refreshFeedGeneration: fromPromise<DailyFeedOutput, FeedInput>(({ input, signal }) =>
    refreshGroupDailyFeedToday(input.groupId, input.feedId, { signal }),
  ),
  deleteFeed: fromPromise<DeleteFeedOutput, FeedInput>(async ({ input, signal }) => {
    await deleteGroupDailyFeed(input.groupId, input.feedId, { signal });
    return { feedId: input.feedId };
  }),
  createGroupFeedPost: fromPromise<GroupFeedPost, CreatePostInput>(({ input, signal }) =>
    createGroupFeedPost(
      input.groupId,
      input.feedId,
      input.date,
      {
        evidence_text: input.evidenceText,
        ...(input.caption !== "" ? { caption: input.caption } : {}),
      },
      { signal },
    ),
  ),
  updateGroupFeedPost: fromPromise<GroupFeedPost, UpdatePostInput>(({ input, signal }) =>
    updateGroupFeedPost(
      input.groupId,
      input.postId,
      {
        ...(input.evidenceText !== undefined
          ? {
              evidence_text: input.evidenceText,
            }
          : {}),
        ...(input.caption !== undefined ? { caption: input.caption !== "" ? input.caption : null } : {}),
        ...(input.tagIds !== undefined ? { tag_ids: input.tagIds } : {}),
      },
      { signal },
    ),
  ),
  deleteGroupFeedPost: fromPromise<DeletePostOutput, { groupId: string; postId: string }>(async ({ input, signal }) => {
    await deleteGroupFeedPost(input.groupId, input.postId, { signal });
    return { postId: input.postId };
  }),
  createGroupPostTag: fromPromise<GroupPostTag, CreatePostTagInput>(({ input, signal }) =>
    createGroupPostTag(input.groupId, input.payload, { signal }),
  ),
  updateGroupPostTag: fromPromise<GroupPostTag, UpdatePostTagInput>(({ input, signal }) =>
    updateGroupPostTag(input.groupId, input.tagId, input.payload, { signal }),
  ),
  deleteGroupPostTag: fromPromise<GroupPostTag, { groupId: string; tagId: string }>(async ({ input, signal }) => {
    await deleteGroupPostTag(input.groupId, input.tagId, { signal });
    return getGroupPostTag(input.groupId, input.tagId, { signal });
  }),
  createGroupEvidenceFormat: fromPromise<EvidenceFormat, CreateEvidenceFormatInput>(({ input, signal }) =>
    createGroupEvidenceFormat(input.groupId, input.payload, { signal }),
  ),
  updateGroupEvidenceFormat: fromPromise<EvidenceFormat, UpdateEvidenceFormatInput>(({ input, signal }) =>
    updateGroupEvidenceFormat(input.groupId, input.formatId, input.payload, { signal }),
  ),
  createGroupEvidenceFormatVersion: fromPromise<EvidenceFormat, CreateEvidenceFormatVersionInput>(({ input, signal }) =>
    createGroupEvidenceFormatVersion(input.groupId, input.formatId, input.payload, { signal }),
  ),
  deleteGroupEvidenceFormat: fromPromise<EvidenceFormat, { groupId: string; formatId: string }>(
    async ({ input, signal }) => {
      await deleteGroupEvidenceFormat(input.groupId, input.formatId, { signal });
      return getGroupEvidenceFormat(input.groupId, input.formatId, { signal });
    },
  ),
  createFeedMetric: fromPromise<FeedMetric, CreateMetricInput>(({ input, signal }) =>
    createFeedMetric(input.groupId, input.feedId, input.payload, { signal }),
  ),
  updateFeedMetric: fromPromise<FeedMetric, UpdateMetricInput>(({ input, signal }) =>
    updateFeedMetric(input.groupId, input.feedId, input.metricId, input.payload, { signal }),
  ),
  deleteFeedMetric: fromPromise<DeleteMetricOutput, MetricInput>(async ({ input, signal }) => {
    await deleteFeedMetric(input.groupId, input.feedId, input.metricId, { signal });
    return { metricId: input.metricId };
  }),
  createFeedMetricJudgment: fromPromise<unknown, CreateJudgmentInput>(({ input, signal }) =>
    createFeedMetricJudgment(
      input.groupId,
      input.feedId,
      input.metricId,
      {
        post_id: input.postId,
        value: input.value,
        ...(input.note.trim() !== "" ? { note: input.note.trim() } : {}),
      },
      { signal },
    ),
  ),
  updateFeedMetricJudgment: fromPromise<unknown, UpdateJudgmentInput>(({ input, signal }) =>
    updateFeedMetricJudgment(
      input.groupId,
      input.judgmentId,
      {
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      { signal },
    ),
  ),
  deleteFeedMetricJudgment: fromPromise<unknown, DeleteJudgmentInput>(async ({ input, signal }) => {
    await deleteFeedMetricJudgment(input.groupId, input.judgmentId, { signal });
  }),
};
