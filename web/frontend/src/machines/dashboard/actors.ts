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
  getGroupEvidenceFormat,
  getGroupPostTag,
  isUnauthorized,
  refreshGroupDailyFeedToday,
  updateFeedMetric,
  updateFeedMetricJudgment,
  updateGroup,
  updateGroupDailyFeed,
  updateGroupEvidenceFormat,
  updateGroupFeedPost,
  updateGroupPostTag,
} from "../../api";
import { archiveMode, queries } from "../../cache/queries";
import { queryCache } from "../../cache/queryCache";
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
import { feedCyclesMachine } from "../feedCyclesMachine";
import { feedEventsMachine } from "../feedEventsMachine";
import type {
  ChangeFeedCaptionsInput,
  ChangeFeedFormatInput,
  ChangeFeedScheduleInput,
  CreateEvidenceFormatInput,
  CreateEvidenceFormatVersionInput,
  CreateJudgmentInput,
  CreateMetricInput,
  CreatePostInput,
  CreatePostTagInput,
  DatedFeedInput,
  DeletePostInput,
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
  UpdateGroupAccessInput,
  UpdateJudgmentInput,
  UpdateMetricInput,
  UpdatePostInput,
  UpdatePostTagInput,
  UserScopedInput,
} from "./events";

export const dashboardActors = {
  addFeedMachine,
  feedCyclesMachine,
  feedEventsMachine,
  listGroups: fromPromise<Group[], UserScopedInput>(({ input, signal }) =>
    queryCache.read(queries.groups, input.currentUserId, { signal }),
  ),
  createGroup: fromPromise<Group, UserScopedInput & { name: string }>(async ({ input, signal }) => {
    const group = await createGroup({ name: input.name }, { signal });
    queryCache.touched(["user", input.currentUserId, "groups"]);
    return group;
  }),
  updateGroupAccess: fromPromise<Group, UpdateGroupAccessInput>(async ({ input, signal }) => {
    const group = await updateGroup(input.groupId, input.payload, { signal });
    queryCache.touched(["user", input.currentUserId, "groups"]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId]);
    queryCache.touched(["anon", "public"]);
    return group;
  }),
  deleteGroup: fromPromise<DeleteGroupOutput, UserScopedInput & { groupId: string }>(async ({ input, signal }) => {
    await deleteGroup(input.groupId, { signal });
    queryCache.touched(["user", input.currentUserId, "groups"]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId]);
    queryCache.touched(["anon", "public"]);
    return { groupId: input.groupId };
  }),
  deleteGroupMember: fromPromise<DeleteGroupMemberOutput, UserScopedInput & { groupId: string; userId: string }>(
    async ({ input, signal }) => {
      await deleteGroupMember(input.groupId, input.userId, { signal });
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "members"]);
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "invite-links"]);
      return { userId: input.userId };
    },
  ),
  loadGroupWorkspace: fromPromise<GroupWorkspaceOutput, GroupWorkspaceInput>(async ({ input, signal }) => {
    const feeds = await queryCache.read(queries.groupFeeds, input.currentUserId, input.groupId, { signal });
    let postTags: GroupPostTag[] = [];
    let postTagsError = "";
    try {
      postTags = await queryCache.read(
        queries.groupPostTags,
        input.currentUserId,
        input.groupId,
        archiveMode(input.includeArchivedPostTags),
        { signal },
      );
    } catch (error) {
      if (isUnauthorized(error)) {
        throw error;
      }
      postTagsError = errorMessage(error);
    }

    let evidenceFormats: EvidenceFormat[] = [];
    let evidenceFormatsError = "";
    try {
      evidenceFormats = await queryCache.read(
        queries.groupEvidenceFormats,
        input.currentUserId,
        input.groupId,
        archiveMode(input.includeArchivedEvidenceFormats),
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
        groupMembers = await queryCache.read(queries.groupMembers, input.currentUserId, input.groupId, { signal });
      } catch (error) {
        if (isUnauthorized(error)) {
          throw error;
        }
        groupMembersError = errorMessage(error);
      }
    }

    return { feeds, postTags, postTagsError, evidenceFormats, evidenceFormatsError, groupMembers, groupMembersError };
  }),
  getGroupDailyFeedToday: fromPromise<DailyFeedOutput, FeedInput>(async ({ input, signal }) => {
    const output = await queryCache.read(queries.feedToday, input.currentUserId, input.groupId, input.feedId, {
      signal,
    });
    queryCache.write(queries.feedOutput, output, input.currentUserId, input.groupId, input.feedId, output.date);
    return output;
  }),
  getGroupDailyFeedOutput: fromPromise<DailyFeedOutput, DatedFeedInput>(({ input, signal }) =>
    queryCache.read(queries.feedOutput, input.currentUserId, input.groupId, input.feedId, input.date, { signal }),
  ),
  listGroupFeedPosts: fromPromise<GroupFeedPost[], DatedFeedInput>(({ input, signal }) =>
    queryCache.read(queries.feedPosts, input.currentUserId, input.groupId, input.feedId, input.date, { signal }),
  ),
  listFeedMetrics: fromPromise<FeedMetric[], FeedInput>(({ input, signal }) =>
    queryCache.read(queries.feedMetrics, input.currentUserId, input.groupId, input.feedId, { signal }),
  ),
  getFeedMetric: fromPromise<FeedMetric, MetricInput>(({ input, signal }) =>
    queryCache.read(queries.feedMetric, input.currentUserId, input.groupId, input.feedId, input.metricId, { signal }),
  ),
  getMetricLeaderboard: fromPromise<MetricLeaderboard, MetricInput>(({ input, signal }) =>
    queryCache.read(queries.metricLeaderboard, input.currentUserId, input.groupId, input.feedId, input.metricId, {
      signal,
    }),
  ),
  toggleFeed: fromPromise<DailyFeed, ToggleFeedInput>(async ({ input, signal }) => {
    const feed = await updateGroupDailyFeed(input.groupId, input.feed.id, { enabled: !input.feed.enabled }, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feeds"]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feed.id]);
    queryCache.touched(["user", input.currentUserId, "me", "daily-feeds"]);
    queryCache.touched(["anon", "public", "feed", input.feed.id]);
    return feed;
  }),
  changeFeedCaptions: fromPromise<DailyFeed, ChangeFeedCaptionsInput>(async ({ input, signal }) => {
    const feed = await updateGroupDailyFeed(
      input.groupId,
      input.feedId,
      { captions_enabled: input.captionsEnabled },
      { signal },
    );
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feeds"]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId]);
    queryCache.touched(["user", input.currentUserId, "me", "daily-feeds"]);
    queryCache.touched(["anon", "public", "feed", input.feedId]);
    return feed;
  }),
  changeFeedFormat: fromPromise<DailyFeed, ChangeFeedFormatInput>(async ({ input, signal }) => {
    const feed = await updateGroupDailyFeed(
      input.groupId,
      input.feedId,
      { evidence_format_id: input.evidenceFormatId },
      { signal },
    );
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feeds"]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "evidence-formats"]);
    queryCache.touched(["user", input.currentUserId, "me", "daily-feeds"]);
    queryCache.touched(["anon", "public", "feed", input.feedId]);
    return feed;
  }),
  changeFeedSchedule: fromPromise<DailyFeed, ChangeFeedScheduleInput>(async ({ input, signal }) => {
    const feed = await updateGroupDailyFeed(input.groupId, input.feedId, { schedule: input.schedule }, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feeds"]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId]);
    queryCache.touched(["user", input.currentUserId, "me", "daily-feeds"]);
    queryCache.touched(["anon", "public", "feed", input.feedId]);
    return feed;
  }),
  refreshFeedGeneration: fromPromise<DailyFeedOutput, FeedInput>(async ({ input, signal }) => {
    const output = await refreshGroupDailyFeedToday(input.groupId, input.feedId, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId, "today"]);
    queryCache.touched([
      "user",
      input.currentUserId,
      "group",
      input.groupId,
      "feed",
      input.feedId,
      "output",
      output.date,
    ]);
    queryCache.touched(["anon", "public", "feed", input.feedId]);
    queryCache.write(queries.feedToday, output, input.currentUserId, input.groupId, input.feedId);
    queryCache.write(queries.feedOutput, output, input.currentUserId, input.groupId, input.feedId, output.date);
    return output;
  }),
  deleteFeed: fromPromise<DeleteFeedOutput, FeedInput>(async ({ input, signal }) => {
    await deleteGroupDailyFeed(input.groupId, input.feedId, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feeds"]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId]);
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "evidence-formats"]);
    queryCache.touched(["user", input.currentUserId, "me", "daily-feeds"]);
    queryCache.touched(["anon", "public", "feed", input.feedId]);
    return { feedId: input.feedId };
  }),
  createGroupFeedPost: fromPromise<GroupFeedPost, CreatePostInput>(async ({ input, signal }) => {
    const post = await createGroupFeedPost(
      input.groupId,
      input.feedId,
      input.date,
      {
        evidence_text: input.evidenceText,
        ...(input.caption !== "" ? { caption: input.caption } : {}),
      },
      { signal },
    );
    queryCache.touched([
      "user",
      input.currentUserId,
      "group",
      input.groupId,
      "feed",
      input.feedId,
      "posts",
      input.date,
    ]);
    queryCache.touched(["anon", "public", "post", post.id]);
    queryCache.touched(["anon", "public", "feed", input.feedId, input.date]);
    return post;
  }),
  updateGroupFeedPost: fromPromise<GroupFeedPost, UpdatePostInput>(async ({ input, signal }) => {
    const post = await updateGroupFeedPost(
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
    );
    queryCache.touched([
      "user",
      input.currentUserId,
      "group",
      input.groupId,
      "feed",
      post.feed_id,
      "posts",
      post.feed_date,
    ]);
    queryCache.touched(["anon", "public", "post", post.id]);
    queryCache.touched(["anon", "public", "feed", post.feed_id, post.feed_date]);
    return post;
  }),
  deleteGroupFeedPost: fromPromise<DeletePostOutput, DeletePostInput>(async ({ input, signal }) => {
    await deleteGroupFeedPost(input.groupId, input.postId, { signal });
    queryCache.touched([
      "user",
      input.currentUserId,
      "group",
      input.groupId,
      "feed",
      input.feedId,
      "posts",
      input.date,
    ]);
    queryCache.touched(["user", input.currentUserId, "me", "feed-post-route", input.postId]);
    queryCache.touched(["anon", "public", "post", input.postId]);
    queryCache.touched(["anon", "public", "feed", input.feedId, input.date]);
    return { postId: input.postId };
  }),
  createGroupPostTag: fromPromise<GroupPostTag, CreatePostTagInput>(async ({ input, signal }) => {
    const tag = await createGroupPostTag(input.groupId, input.payload, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "post-tags"]);
    queryCache.touched(["anon", "public"]);
    return tag;
  }),
  updateGroupPostTag: fromPromise<GroupPostTag, UpdatePostTagInput>(async ({ input, signal }) => {
    const tag = await updateGroupPostTag(input.groupId, input.tagId, input.payload, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "post-tags"]);
    queryCache.touched(["anon", "public"]);
    return tag;
  }),
  deleteGroupPostTag: fromPromise<GroupPostTag, UserScopedInput & { groupId: string; tagId: string }>(
    async ({ input, signal }) => {
      await deleteGroupPostTag(input.groupId, input.tagId, { signal });
      const tag = await getGroupPostTag(input.groupId, input.tagId, { signal });
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "post-tags"]);
      queryCache.touched(["anon", "public"]);
      return tag;
    },
  ),
  createGroupEvidenceFormat: fromPromise<EvidenceFormat, CreateEvidenceFormatInput>(async ({ input, signal }) => {
    const format = await createGroupEvidenceFormat(input.groupId, input.payload, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "evidence-formats"]);
    queryCache.touched(["anon", "public"]);
    return format;
  }),
  updateGroupEvidenceFormat: fromPromise<EvidenceFormat, UpdateEvidenceFormatInput>(async ({ input, signal }) => {
    const format = await updateGroupEvidenceFormat(input.groupId, input.formatId, input.payload, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "evidence-formats"]);
    queryCache.touched(["anon", "public"]);
    return format;
  }),
  createGroupEvidenceFormatVersion: fromPromise<EvidenceFormat, CreateEvidenceFormatVersionInput>(
    async ({ input, signal }) => {
      const format = await createGroupEvidenceFormatVersion(input.groupId, input.formatId, input.payload, { signal });
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "evidence-formats"]);
      queryCache.touched(["anon", "public"]);
      return format;
    },
  ),
  deleteGroupEvidenceFormat: fromPromise<EvidenceFormat, UserScopedInput & { groupId: string; formatId: string }>(
    async ({ input, signal }) => {
      await deleteGroupEvidenceFormat(input.groupId, input.formatId, { signal });
      const format = await getGroupEvidenceFormat(input.groupId, input.formatId, { signal });
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "evidence-formats"]);
      queryCache.touched(["anon", "public"]);
      return format;
    },
  ),
  createFeedMetric: fromPromise<FeedMetric, CreateMetricInput>(async ({ input, signal }) => {
    const metric = await createFeedMetric(input.groupId, input.feedId, input.payload, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId, "metrics"]);
    return metric;
  }),
  updateFeedMetric: fromPromise<FeedMetric, UpdateMetricInput>(async ({ input, signal }) => {
    const metric = await updateFeedMetric(input.groupId, input.feedId, input.metricId, input.payload, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId, "metrics"]);
    return metric;
  }),
  deleteFeedMetric: fromPromise<DeleteMetricOutput, MetricInput>(async ({ input, signal }) => {
    await deleteFeedMetric(input.groupId, input.feedId, input.metricId, { signal });
    queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId, "metrics"]);
    return { metricId: input.metricId };
  }),
  createFeedMetricJudgment: fromPromise<unknown, CreateJudgmentInput>(async ({ input, signal }) => {
    const judgment = await createFeedMetricJudgment(
      input.groupId,
      input.feedId,
      input.metricId,
      {
        post_id: input.postId,
        value: input.value,
        ...(input.note.trim() !== "" ? { note: input.note.trim() } : {}),
      },
      { signal },
    );
    queryCache.touched([
      "user",
      input.currentUserId,
      "group",
      input.groupId,
      "feed",
      input.feedId,
      "metric",
      input.metricId,
      "judgments",
    ]);
    return judgment;
  }),
  updateFeedMetricJudgment: fromPromise<unknown, UpdateJudgmentInput>(async ({ input, signal }) => {
    const judgment = await updateFeedMetricJudgment(
      input.groupId,
      input.judgmentId,
      {
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      { signal },
    );
    queryCache.touched([
      "user",
      input.currentUserId,
      "group",
      input.groupId,
      "feed",
      input.feedId,
      "metric",
      input.metricId,
      "judgments",
    ]);
    return judgment;
  }),
  deleteFeedMetricJudgment: fromPromise<unknown, DeleteJudgmentInput>(async ({ input, signal }) => {
    await deleteFeedMetricJudgment(input.groupId, input.judgmentId, { signal });
    queryCache.touched([
      "user",
      input.currentUserId,
      "group",
      input.groupId,
      "feed",
      input.feedId,
      "metric",
      input.metricId,
      "judgments",
    ]);
  }),
};
