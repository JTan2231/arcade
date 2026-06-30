import { assign, fromPromise, sendParent, setup } from "xstate";
import type { DoneActorEvent, ErrorActorEvent, EventObject } from "xstate";

import {
  createFeedMetric,
  createFeedMetricJudgment,
  createGroup,
  createGroupFeedPost,
  createGroupPostTag,
  deleteFeedMetricJudgment,
  deleteFeedMetric,
  deleteGroup,
  deleteGroupDailyFeed,
  deleteGroupFeedPost,
  deleteGroupMember,
  deleteGroupPostTag,
  getFeedMetric,
  getGroupDailyFeedOutput,
  getGroupDailyFeedToday,
  getGroupPostTag,
  getMetricLeaderboard,
  isUnauthorized,
  listFeedMetrics,
  listGroupDailyFeeds,
  listGroupFeedPosts,
  listGroupMembers,
  listGroupPostTags,
  listGroups,
  updateFeedMetric,
  updateFeedMetricJudgment,
  updateGroupDailyFeed,
  updateGroupFeedPost,
  updateGroupPostTag,
} from "../api";
import { todayDateValue } from "../dates";
import { errorMessage } from "../errors";
import type { AddFeedOutputEvent } from "./addFeedMachine";
import { addFeedMachine } from "./addFeedMachine";
import type {
  CreateFeedMetricRequest,
  CreateGroupPostTagRequest,
  DailyFeed,
  DailyFeedOutput,
  FeedMetric,
  Group,
  GroupFeedPost,
  GroupMember,
  GroupPostTag,
  MetricLeaderboard,
  PatchFeedMetricRequest,
  PatchGroupPostTagRequest,
  User,
} from "../types";

type CreatePostPayload = {
  evidenceText: string;
  caption: string;
};

type UpdatePostPayload = {
  evidenceText?: string;
  caption?: string;
  tagIds?: string[];
};

type PostMutation =
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

type PostTagMutation =
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

type GroupMemberMutation = {
  userId: string;
};

type MetricMutation =
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

type JudgmentMutation = {
  metricId: string;
  postId: string;
  value: number;
  note: string;
};

export type DashboardContext = {
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
  groupMembers: GroupMember[];
  groupMembersError: string;
  groupSettingsOpen: boolean;
  posts: GroupFeedPost[];
  postsError: string;

  metrics: FeedMetric[];
  selectedMetricId: string | null;
  metricLeaderboard: MetricLeaderboard | null;
  metricsError: string;

  pendingGroupName: string;
  pendingToggleFeedId: string | null;
  pendingDeleteGroupId: string | null;
  pendingDeleteFeedId: string | null;
  postMutation: PostMutation | null;
  postTagMutation: PostTagMutation | null;
  groupMemberMutation: GroupMemberMutation | null;
  metricMutation: MetricMutation | null;
  judgmentMutation: JudgmentMutation | null;
};

type DashboardInput = {
  user: User | null;
};

type DashboardUserEvent =
  | { type: "GROUPS_REFRESH_REQUESTED"; preferredGroupId?: string | null }
  | { type: "GROUP_CREATE_SUBMITTED"; name: string }
  | { type: "GROUP_SELECTED"; groupId: string }
  | { type: "GROUP_SETTINGS_OPENED"; groupId: string }
  | { type: "GROUP_SETTINGS_CLOSED" }
  | { type: "GROUP_DELETE_SUBMITTED"; groupId: string }
  | { type: "FEED_SELECTED"; feedId: string }
  | { type: "FEED_DATE_CHANGED"; date: string }
  | { type: "FEED_ENABLED_TOGGLED"; feedId: string }
  | { type: "FEED_DELETE_SUBMITTED"; feedId: string }
  | { type: "POST_CREATE_SUBMITTED"; payload: CreatePostPayload }
  | { type: "POST_UPDATE_SUBMITTED"; postId: string; payload: UpdatePostPayload }
  | { type: "POST_DELETE_SUBMITTED"; postId: string }
  | { type: "POST_TAG_CREATE_SUBMITTED"; payload: CreateGroupPostTagRequest }
  | { type: "POST_TAG_UPDATE_SUBMITTED"; tagId: string; payload: PatchGroupPostTagRequest }
  | { type: "POST_TAG_DELETE_SUBMITTED"; tagId: string }
  | { type: "GROUP_MEMBER_REMOVE_SUBMITTED"; userId: string }
  | { type: "METRIC_SELECTED"; metricId: string }
  | { type: "METRIC_CREATE_SUBMITTED"; payload: CreateFeedMetricRequest }
  | { type: "METRIC_UPDATE_SUBMITTED"; metricId: string; payload: PatchFeedMetricRequest }
  | { type: "METRIC_DELETE_SUBMITTED"; metricId: string }
  | { type: "JUDGMENT_CREATE_SUBMITTED"; metricId: string; postId: string; value: number; note: string }
  | { type: "ADD_FEED_OPENED" }
  | { type: "ADD_FEED_CLOSED" };

export type DashboardOutputEvent = { type: "UNAUTHORIZED" } | { type: "TOAST_REQUESTED"; message: string };

type DashboardEvent = DashboardUserEvent | AddFeedOutputEvent;

type FeedInput = {
  groupId: string;
  feedId: string;
};

type GroupWorkspaceInput = {
  groupId: string;
  includeArchivedPostTags: boolean;
  includeGroupMembers: boolean;
};

type GroupWorkspaceOutput = {
  feeds: DailyFeed[];
  postTags: GroupPostTag[];
  postTagsError: string;
  groupMembers: GroupMember[];
  groupMembersError: string;
};

type DatedFeedInput = FeedInput & {
  date: string;
};

type MetricInput = FeedInput & {
  metricId: string;
};

type ToggleFeedInput = {
  groupId: string;
  feed: DailyFeed;
};

type DeleteGroupOutput = {
  groupId: string;
};

type DeleteGroupMemberOutput = {
  userId: string;
};

type DeleteFeedOutput = {
  feedId: string;
};

type CreatePostInput = DatedFeedInput & CreatePostPayload;

type UpdatePostInput = {
  groupId: string;
  postId: string;
  evidenceText?: string;
  caption?: string;
  tagIds?: string[];
};

type DeletePostOutput = {
  postId: string;
};

type CreatePostTagInput = {
  groupId: string;
  payload: CreateGroupPostTagRequest;
};

type UpdatePostTagInput = {
  groupId: string;
  tagId: string;
  payload: PatchGroupPostTagRequest;
};

type CreateMetricInput = FeedInput & {
  payload: CreateFeedMetricRequest;
};

type UpdateMetricInput = MetricInput & {
  payload: PatchFeedMetricRequest;
};

type DeleteMetricOutput = {
  metricId: string;
};

type CreateJudgmentInput = MetricInput & {
  postId: string;
  value: number;
  note: string;
};

type UpdateJudgmentInput = {
  groupId: string;
  judgmentId: string;
  value?: number;
  note?: string | null;
};

type DeleteJudgmentInput = {
  groupId: string;
  judgmentId: string;
};

const dashboardSetup = setup({
  types: {
    context: {} as DashboardContext,
    events: {} as DashboardEvent,
    input: {} as DashboardInput,
  },
  guards: {
    isUnauthorizedError: ({ event }) => "error" in event && isUnauthorized(event.error),
    hasSelectedGroup: ({ context }) => context.selectedGroupId !== null,
    hasSelectedFeed: ({ context }) => context.selectedGroupId !== null && context.selectedFeedId !== null,
    hasLoadedOutput: ({ context }) =>
      context.selectedGroupId !== null && context.selectedFeedId !== null && context.output !== null,
    hasSelectedMetric: ({ context }) =>
      context.selectedGroupId !== null && context.selectedFeedId !== null && context.selectedMetricId !== null,
    hasRestorableFeed: ({ context }) => context.selectedGroupId !== null && context.selectedFeedId !== null,
    hasRestorableGroup: ({ context }) => context.selectedGroupId !== null,
  },
  actors: {
    addFeedMachine,
    listGroups: fromPromise<Group[], undefined>(({ signal }) => listGroups({ signal })),
    createGroup: fromPromise<Group, { name: string }>(({ input, signal }) =>
      createGroup({ name: input.name }, { signal }),
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
        postTags = await listGroupPostTags(
          input.groupId,
          { includeArchived: input.includeArchivedPostTags },
          { signal },
        );
      } catch (error) {
        if (isUnauthorized(error)) {
          throw error;
        }
        postTagsError = errorMessage(error);
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

      return { feeds, postTags, postTagsError, groupMembers, groupMembersError };
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
          evidence_kind: "text",
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
                evidence_kind: "text" as const,
                evidence_text: input.evidenceText,
              }
            : {}),
          ...(input.caption !== undefined ? { caption: input.caption !== "" ? input.caption : null } : {}),
          ...(input.tagIds !== undefined ? { tag_ids: input.tagIds } : {}),
        },
        { signal },
      ),
    ),
    deleteGroupFeedPost: fromPromise<DeletePostOutput, { groupId: string; postId: string }>(
      async ({ input, signal }) => {
        await deleteGroupFeedPost(input.groupId, input.postId, { signal });
        return { postId: input.postId };
      },
    ),
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
  },
});

export const dashboardMachine = dashboardSetup.createMachine({
  id: "dashboard",
  context: initialDashboardContext,
  initial: "loadingGroups",
  on: {
    GROUPS_REFRESH_REQUESTED: {
      target: ".loadingGroups",
      reenter: true,
      actions: assign(({ event }) => ({
        preferredGroupId: event.preferredGroupId ?? null,
      })),
    },
    GROUP_CREATE_SUBMITTED: {
      target: ".creatingGroup",
      actions: assign(({ event }) => ({
        pendingGroupName: event.name,
      })),
    },
    GROUP_DELETE_SUBMITTED: {
      guard: ({ context, event }) => context.groups.some((group) => group.id === event.groupId),
      target: ".deletingGroup",
      actions: assign(({ event }) => ({
        pendingDeleteGroupId: event.groupId,
      })),
    },
    GROUP_SELECTED: {
      guard: ({ context, event }) => event.groupId !== context.selectedGroupId,
      target: ".groupSelected.loadingFeeds",
      reenter: true,
      actions: assign(({ event }) => ({
        ...resetSelectedGroupContext(),
        selectedGroupId: event.groupId,
      })),
    },
    GROUP_SETTINGS_OPENED: [
      {
        guard: ({ context, event }) => event.groupId === context.selectedGroupId,
        actions: assign({
          groupSettingsOpen: true,
        }),
      },
      {
        guard: ({ context, event }) => context.groups.some((group) => group.id === event.groupId),
        target: ".groupSelected.loadingFeeds",
        reenter: true,
        actions: assign(({ event }) => ({
          ...resetSelectedGroupContext(),
          selectedGroupId: event.groupId,
          groupSettingsOpen: true,
        })),
      },
    ],
    GROUP_SETTINGS_CLOSED: {
      actions: assign({
        groupSettingsOpen: false,
      }),
    },
    FEED_SELECTED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null && (event.feedId !== context.selectedFeedId || context.output === null),
      target: ".groupSelected.feedSelected.loadingTodayOutput",
      reenter: true,
      actions: assign(({ event }) => ({
        selectedFeedId: event.feedId,
        selectedFeedDate: todayDateValue(),
        output: null,
        outputError: "",
        posts: [],
        postsError: "",
        postMutation: null,
        ...resetMetricContext(),
      })),
    },
    FEED_DATE_CHANGED: {
      guard: { type: "hasSelectedFeed" },
      target: ".groupSelected.feedSelected.loadingDatedOutput",
      reenter: true,
      actions: assign(({ event }) => ({
        selectedFeedDate: event.date,
        output: null,
        outputError: "",
        posts: [],
        postsError: "",
        postMutation: null,
        metricLeaderboard: null,
        metricsError: "",
      })),
    },
    FEED_ENABLED_TOGGLED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null && context.feeds.some((feed) => feed.id === event.feedId),
      target: ".groupSelected.togglingFeed",
      actions: assign(({ event }) => ({
        pendingToggleFeedId: event.feedId,
      })),
    },
    FEED_DELETE_SUBMITTED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null && context.feeds.some((feed) => feed.id === event.feedId),
      target: ".groupSelected.deletingFeed",
      actions: assign(({ event }) => ({
        pendingDeleteFeedId: event.feedId,
      })),
    },
    ADD_FEED_OPENED: {
      guard: { type: "hasSelectedGroup" },
      target: ".groupSelected.addFeed",
    },
    ADD_FEED_CLOSED: closeAddFeedTransitions(),
    FEED_CREATED: {
      guard: { type: "hasSelectedGroup" },
      target: ".groupSelected.feedSelected.loadingTodayOutput",
      actions: [
        assign(({ context, event }) => ({
          feeds: [...context.feeds.filter((feed) => feed.id !== event.feed.id), event.feed],
          selectedFeedId: event.feed.id,
          selectedFeedDate: todayDateValue(),
          output: null,
          outputError: "",
          posts: [],
          postsError: "",
          postMutation: null,
          ...resetMetricContext(),
          pendingToggleFeedId: null,
          pendingDeleteFeedId: null,
        })),
        sendToastToParent("Feed created"),
      ],
    },
    UNAUTHORIZED: {
      actions: sendUnauthorizedDashboardEventToParent(),
    },
    POST_CREATE_SUBMITTED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null &&
        context.selectedFeedId !== null &&
        context.output !== null &&
        event.payload.evidenceText.trim() !== "",
      target: ".groupSelected.feedSelected.creatingPost",
      actions: assign(({ event }) => ({
        postMutation: {
          kind: "create",
          evidenceText: event.payload.evidenceText.trim(),
          caption: event.payload.caption.trim(),
        },
      })),
    },
    POST_UPDATE_SUBMITTED: {
      guard: ({ context, event }) => context.selectedGroupId !== null && validPostUpdatePayload(event.payload),
      target: ".groupSelected.feedSelected.updatingPost",
      actions: assign(({ event }) => ({
        postMutation: {
          kind: "update",
          postId: event.postId,
          ...(event.payload.evidenceText !== undefined
            ? {
                evidenceText: event.payload.evidenceText.trim(),
              }
            : {}),
          ...(event.payload.caption !== undefined ? { caption: event.payload.caption.trim() } : {}),
          ...(event.payload.tagIds !== undefined ? { tagIds: event.payload.tagIds } : {}),
        },
      })),
    },
    POST_DELETE_SUBMITTED: {
      guard: { type: "hasSelectedGroup" },
      target: ".groupSelected.feedSelected.deletingPost",
      actions: assign(({ event }) => ({
        postMutation: {
          kind: "delete",
          postId: event.postId,
        },
      })),
    },
    POST_TAG_CREATE_SUBMITTED: {
      guard: ({ context, event }) => context.selectedGroupId !== null && event.payload.name.trim() !== "",
      target: ".groupSelected.creatingPostTag",
      actions: assign(({ event }) => ({
        postTagMutation: {
          kind: "create",
          payload: {
            ...event.payload,
            name: event.payload.name.trim(),
          },
        },
      })),
    },
    POST_TAG_UPDATE_SUBMITTED: {
      guard: ({ context, event }) => context.postTags.some((tag) => tag.id === event.tagId),
      target: ".groupSelected.updatingPostTag",
      actions: assign(({ event }) => ({
        postTagMutation: {
          kind: "update",
          tagId: event.tagId,
          payload: event.payload,
        },
      })),
    },
    POST_TAG_DELETE_SUBMITTED: {
      guard: ({ context, event }) => context.postTags.some((tag) => tag.id === event.tagId),
      target: ".groupSelected.deletingPostTag",
      actions: assign(({ event }) => ({
        postTagMutation: {
          kind: "delete",
          tagId: event.tagId,
        },
      })),
    },
    GROUP_MEMBER_REMOVE_SUBMITTED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null && context.groupMembers.some((member) => member.user_id === event.userId),
      target: ".groupSelected.removingGroupMember",
      actions: assign(({ event }) => ({
        groupMemberMutation: {
          userId: event.userId,
        },
      })),
    },
    METRIC_SELECTED: {
      guard: ({ context, event }) => context.metrics.some((metric) => metric.id === event.metricId),
      target: ".groupSelected.feedSelected.loadingLeaderboard",
      reenter: true,
      actions: assign(({ event }) => ({
        selectedMetricId: event.metricId,
        metricLeaderboard: null,
        metricsError: "",
      })),
    },
    METRIC_CREATE_SUBMITTED: {
      guard: { type: "hasSelectedFeed" },
      target: ".groupSelected.feedSelected.creatingMetric",
      actions: assign(({ event }) => ({
        metricMutation: {
          kind: "create",
          payload: event.payload,
        },
      })),
    },
    METRIC_UPDATE_SUBMITTED: {
      guard: ({ context, event }) => context.metrics.some((metric) => metric.id === event.metricId),
      target: ".groupSelected.feedSelected.updatingMetric",
      actions: assign(({ event }) => ({
        metricMutation: {
          kind: "update",
          metricId: event.metricId,
          payload: event.payload,
        },
      })),
    },
    METRIC_DELETE_SUBMITTED: {
      guard: ({ context, event }) => context.metrics.some((metric) => metric.id === event.metricId),
      target: ".groupSelected.feedSelected.deletingMetric",
      actions: assign(({ event }) => ({
        metricMutation: {
          kind: "delete",
          metricId: event.metricId,
        },
      })),
    },
    JUDGMENT_CREATE_SUBMITTED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null &&
        context.selectedFeedId !== null &&
        context.metrics.some((metric) => metric.id === event.metricId) &&
        Number.isFinite(event.value) &&
        event.value >= 0,
      target: ".groupSelected.feedSelected.creatingJudgment",
      actions: assign(({ event }) => ({
        selectedMetricId: event.metricId,
        metricLeaderboard: null,
        judgmentMutation: {
          metricId: event.metricId,
          postId: event.postId,
          value: event.value,
          note: event.note.trim(),
        },
      })),
    },
  },
  states: {
    loadingGroups: {
      invoke: {
        src: "listGroups",
        input: () => undefined,
        onDone: [
          {
            target: "groupSelected.loadingFeeds",
            guard: ({ context, event }) =>
              chooseGroupId(event.output, context.preferredGroupId, context.selectedGroupId) !== null,
            actions: assign(({ context, event }) => ({
              ...resetSelectedGroupContext(),
              groups: event.output,
              selectedGroupId: chooseGroupId(event.output, context.preferredGroupId, context.selectedGroupId),
              preferredGroupId: null,
              pendingDeleteGroupId: null,
            })),
          },
          {
            target: "noGroup",
            actions: assign(({ context, event }) => ({
              ...resetSelectedGroupContext(),
              groups: event.output,
              selectedGroupId: chooseGroupId(event.output, context.preferredGroupId, context.selectedGroupId),
              preferredGroupId: null,
              pendingDeleteGroupId: null,
            })),
          },
        ],
        onError: groupLoadErrorTransitions(),
      },
    },
    creatingGroup: {
      invoke: {
        src: "createGroup",
        input: ({ context }) => ({ name: context.pendingGroupName }),
        onDone: {
          target: "loadingGroups",
          actions: [
            assign(({ event }) => ({
              preferredGroupId: event.output.id,
              pendingGroupName: "",
            })),
            sendToastToParent("Group created"),
          ],
        },
        onError: restoreAfterGroupCreateErrorTransitions(),
      },
    },
    deletingGroup: {
      invoke: {
        src: "deleteGroup",
        input: ({ context }) => ({ groupId: requirePendingDeleteGroupId(context) }),
        onDone: {
          target: "loadingGroups",
          actions: [
            assign(({ context, event }) => ({
              preferredGroupId: context.selectedGroupId === event.output.groupId ? null : context.selectedGroupId,
              pendingDeleteGroupId: null,
            })),
            sendToastToParent("Group deleted"),
          ],
        },
        onError: restoreAfterGroupDeleteErrorTransitions(),
      },
    },
    noGroup: {},
    groupSelected: {
      initial: "loadingFeeds",
      states: {
        loadingFeeds: {
          invoke: {
            src: "loadGroupWorkspace",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
              includeArchivedPostTags: selectedGroupCanManage(context),
              includeGroupMembers: selectedGroupCanManage(context),
            }),
            onDone: [
              {
                target: "feedSelected.loadingTodayOutput",
                guard: ({ event }) => event.output.feeds.length > 0,
                actions: assign(({ event }) => {
                  const firstFeed = event.output.feeds[0];
                  return {
                    feeds: event.output.feeds,
                    postTags: event.output.postTags,
                    postTagsError: event.output.postTagsError,
                    groupMembers: event.output.groupMembers,
                    groupMembersError: event.output.groupMembersError,
                    selectedFeedId: firstFeed?.id ?? null,
                    selectedFeedDate: todayDateValue(),
                    feedsError: "",
                    output: null,
                    outputError: "",
                    posts: [],
                    postsError: "",
                    postMutation: null,
                    postTagMutation: null,
                    groupMemberMutation: null,
                    ...resetMetricContext(),
                    pendingToggleFeedId: null,
                    pendingDeleteFeedId: null,
                  };
                }),
              },
              {
                target: "noFeed",
                actions: assign(({ event }) => ({
                  feeds: event.output.feeds,
                  postTags: event.output.postTags,
                  postTagsError: event.output.postTagsError,
                  groupMembers: event.output.groupMembers,
                  groupMembersError: event.output.groupMembersError,
                  selectedFeedId: null,
                  selectedFeedDate: todayDateValue(),
                  feedsError: "",
                  output: null,
                  outputError: "",
                  posts: [],
                  postsError: "",
                  postMutation: null,
                  postTagMutation: null,
                  groupMemberMutation: null,
                  ...resetMetricContext(),
                  pendingToggleFeedId: null,
                  pendingDeleteFeedId: null,
                })),
              },
            ],
            onError: [
              unauthorizedToParentTransition(),
              {
                target: "noFeed",
                actions: assign(({ event }) => ({
                  feeds: [],
                  postTags: [],
                  postTagsError: "",
                  groupMembers: [],
                  groupMembersError: "",
                  selectedFeedId: null,
                  selectedFeedDate: todayDateValue(),
                  feedsError: errorMessage(event.error),
                  output: null,
                  outputError: "",
                  posts: [],
                  postsError: "",
                  postMutation: null,
                  postTagMutation: null,
                  groupMemberMutation: null,
                  ...resetMetricContext(),
                  pendingToggleFeedId: null,
                  pendingDeleteFeedId: null,
                })),
              },
            ],
          },
        },
        noFeed: {},
        feedSelected: {
          initial: "loadingTodayOutput",
          states: {
            loadingTodayOutput: {
              invoke: {
                src: "getGroupDailyFeedToday",
                input: ({ context }) => ({
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                }),
                onDone: {
                  target: "loadingPosts",
                  actions: assign(({ event }) => ({
                    output: event.output,
                    selectedFeedDate: event.output.date,
                    outputError: "",
                    posts: [],
                    postsError: "",
                  })),
                },
                onError: [
                  unauthorizedToParentTransition(),
                  {
                    target: "ready",
                    actions: assign(({ event }) => ({
                      output: null,
                      outputError: errorMessage(event.error),
                      posts: [],
                      postsError: "",
                    })),
                  },
                ],
              },
            },
            loadingDatedOutput: {
              invoke: {
                src: "getGroupDailyFeedOutput",
                input: ({ context }) => ({
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                  date: context.selectedFeedDate,
                }),
                onDone: {
                  target: "loadingPosts",
                  actions: assign(({ event }) => ({
                    output: event.output,
                    selectedFeedDate: event.output.date,
                    outputError: "",
                    posts: [],
                    postsError: "",
                  })),
                },
                onError: [
                  unauthorizedToParentTransition(),
                  {
                    target: "ready",
                    actions: assign(({ event }) => ({
                      output: null,
                      outputError: errorMessage(event.error),
                      posts: [],
                      postsError: "",
                    })),
                  },
                ],
              },
            },
            loadingPosts: {
              invoke: {
                src: "listGroupFeedPosts",
                input: ({ context }) => ({
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                  date: requireOutputDate(context),
                }),
                onDone: {
                  target: "loadingMetrics",
                  actions: assign(({ event }) => ({
                    posts: event.output,
                    postsError: "",
                    postMutation: null,
                  })),
                },
                onError: [
                  unauthorizedToParentTransition(),
                  {
                    target: "loadingMetrics",
                    actions: assign(({ event }) => ({
                      posts: [],
                      postsError: errorMessage(event.error),
                      postMutation: null,
                    })),
                  },
                ],
              },
            },
            loadingMetrics: {
              invoke: {
                src: "listFeedMetrics",
                input: ({ context }) => ({
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                }),
                onDone: [
                  {
                    target: "loadingLeaderboard",
                    guard: ({ event }) => event.output.length > 0,
                    actions: assign(({ context, event }) => {
                      const selectedMetricId = chooseMetricId(event.output, context.selectedMetricId);
                      return {
                        metrics: event.output,
                        selectedMetricId,
                        metricLeaderboard: null,
                        metricsError: "",
                        metricMutation: null,
                        judgmentMutation: null,
                      };
                    }),
                  },
                  {
                    target: "ready",
                    actions: assign(({ event }) => ({
                      metrics: event.output,
                      selectedMetricId: null,
                      metricLeaderboard: null,
                      metricsError: "",
                      metricMutation: null,
                      judgmentMutation: null,
                    })),
                  },
                ],
                onError: [
                  unauthorizedToParentTransition(),
                  {
                    target: "ready",
                    actions: assign(({ event }) => ({
                      metrics: [],
                      selectedMetricId: null,
                      metricLeaderboard: null,
                      metricsError: errorMessage(event.error),
                      metricMutation: null,
                      judgmentMutation: null,
                    })),
                  },
                ],
              },
            },
            loadingLeaderboard: {
              invoke: {
                src: "getMetricLeaderboard",
                input: ({ context }) => ({
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                  metricId: requireSelectedMetricId(context),
                }),
                onDone: {
                  target: "ready",
                  actions: assign(({ event }) => ({
                    metricLeaderboard: event.output,
                    metricsError: "",
                    metricMutation: null,
                    judgmentMutation: null,
                  })),
                },
                onError: [
                  unauthorizedToParentTransition(),
                  {
                    target: "ready",
                    actions: assign(({ event }) => ({
                      metricLeaderboard: null,
                      metricsError: errorMessage(event.error),
                      metricMutation: null,
                      judgmentMutation: null,
                    })),
                  },
                ],
              },
            },
            creatingPost: {
              invoke: {
                src: "createGroupFeedPost",
                input: ({ context }) => {
                  const mutation = requirePostMutation(context, "create");
                  return {
                    groupId: requireSelectedGroupId(context),
                    feedId: requireSelectedFeedId(context),
                    date: requireOutputDate(context),
                    evidenceText: mutation.evidenceText,
                    caption: mutation.caption,
                  };
                },
                onDone: [
                  {
                    target: "loadingLeaderboard",
                    guard: { type: "hasSelectedMetric" },
                    actions: [
                      assign(({ context, event }) => ({
                        posts: upsertPost(context.posts, event.output),
                        postsError: "",
                        postMutation: null,
                        metricLeaderboard: null,
                      })),
                      sendToastToParent("Post submitted"),
                    ],
                  },
                  {
                    target: "ready",
                    actions: [
                      assign(({ context, event }) => ({
                        posts: upsertPost(context.posts, event.output),
                        postsError: "",
                        postMutation: null,
                      })),
                      sendToastToParent("Post submitted"),
                    ],
                  },
                ],
                onError: mutationErrorTransitions(),
              },
            },
            updatingPost: {
              invoke: {
                src: "updateGroupFeedPost",
                input: ({ context }) => {
                  const mutation = requirePostMutation(context, "update");
                  const input: UpdatePostInput = {
                    groupId: requireSelectedGroupId(context),
                    postId: mutation.postId,
                  };
                  if (mutation.evidenceText !== undefined) {
                    input.evidenceText = mutation.evidenceText;
                  }
                  if (mutation.caption !== undefined) {
                    input.caption = mutation.caption;
                  }
                  if (mutation.tagIds !== undefined) {
                    input.tagIds = mutation.tagIds;
                  }
                  return input;
                },
                onDone: [
                  {
                    target: "loadingLeaderboard",
                    guard: { type: "hasSelectedMetric" },
                    actions: [
                      assign(({ context, event }) => ({
                        posts: context.posts.map((post) => (post.id === event.output.id ? event.output : post)),
                        postsError: "",
                        postMutation: null,
                        metricLeaderboard: null,
                      })),
                      sendToastToParent("Post updated"),
                    ],
                  },
                  {
                    target: "ready",
                    actions: [
                      assign(({ context, event }) => ({
                        posts: context.posts.map((post) => (post.id === event.output.id ? event.output : post)),
                        postsError: "",
                        postMutation: null,
                      })),
                      sendToastToParent("Post updated"),
                    ],
                  },
                ],
                onError: mutationErrorTransitions(),
              },
            },
            deletingPost: {
              invoke: {
                src: "deleteGroupFeedPost",
                input: ({ context }) => {
                  const mutation = requirePostMutation(context, "delete");
                  return {
                    groupId: requireSelectedGroupId(context),
                    postId: mutation.postId,
                  };
                },
                onDone: [
                  {
                    target: "loadingLeaderboard",
                    guard: { type: "hasSelectedMetric" },
                    actions: [
                      assign(({ context, event }) => ({
                        posts: context.posts.filter((post) => post.id !== event.output.postId),
                        postsError: "",
                        postMutation: null,
                        metricLeaderboard: null,
                      })),
                      sendToastToParent("Post deleted"),
                    ],
                  },
                  {
                    target: "ready",
                    actions: [
                      assign(({ context, event }) => ({
                        posts: context.posts.filter((post) => post.id !== event.output.postId),
                        postsError: "",
                        postMutation: null,
                      })),
                      sendToastToParent("Post deleted"),
                    ],
                  },
                ],
                onError: mutationErrorTransitions(),
              },
            },
            creatingMetric: {
              invoke: {
                src: "createFeedMetric",
                input: ({ context }) => ({
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                  payload: requireMetricMutation(context, "create").payload,
                }),
                onDone: {
                  target: "loadingLeaderboard",
                  actions: [
                    assign(({ context, event }) => ({
                      metrics: upsertMetric(context.metrics, event.output),
                      selectedMetricId: event.output.id,
                      metricLeaderboard: null,
                      metricsError: "",
                      metricMutation: null,
                    })),
                    sendToastToParent("Metric added"),
                  ],
                },
                onError: metricMutationErrorTransitions(),
              },
            },
            updatingMetric: {
              invoke: {
                src: "updateFeedMetric",
                input: ({ context }) => {
                  const mutation = requireMetricMutation(context, "update");
                  return {
                    groupId: requireSelectedGroupId(context),
                    feedId: requireSelectedFeedId(context),
                    metricId: mutation.metricId,
                    payload: mutation.payload,
                  };
                },
                onDone: {
                  target: "loadingLeaderboard",
                  actions: [
                    assign(({ context, event }) => ({
                      metrics: replaceMetric(context.metrics, event.output),
                      selectedMetricId: event.output.id,
                      metricLeaderboard: null,
                      metricsError: "",
                      metricMutation: null,
                    })),
                    sendToastToParent("Metric updated"),
                  ],
                },
                onError: metricMutationErrorTransitions(),
              },
            },
            deletingMetric: {
              invoke: {
                src: "deleteFeedMetric",
                input: ({ context }) => {
                  const mutation = requireMetricMutation(context, "delete");
                  return {
                    groupId: requireSelectedGroupId(context),
                    feedId: requireSelectedFeedId(context),
                    metricId: mutation.metricId,
                  };
                },
                onDone: [
                  {
                    target: "loadingLeaderboard",
                    guard: ({ context, event }) => removeMetric(context.metrics, event.output.metricId).length > 0,
                    actions: [
                      assign(({ context, event }) => {
                        const metrics = removeMetric(context.metrics, event.output.metricId);
                        return {
                          metrics,
                          selectedMetricId: selectedMetricAfterDelete(
                            metrics,
                            context.selectedMetricId,
                            event.output.metricId,
                          ),
                          metricLeaderboard: null,
                          metricsError: "",
                          metricMutation: null,
                        };
                      }),
                      sendToastToParent("Metric deleted"),
                    ],
                  },
                  {
                    target: "ready",
                    actions: [
                      assign(({ context, event }) => ({
                        metrics: removeMetric(context.metrics, event.output.metricId),
                        selectedMetricId: null,
                        metricLeaderboard: null,
                        metricsError: "",
                        metricMutation: null,
                      })),
                      sendToastToParent("Metric deleted"),
                    ],
                  },
                ],
                onError: metricMutationErrorTransitions(),
              },
            },
            creatingJudgment: {
              invoke: {
                src: "createFeedMetricJudgment",
                input: ({ context }) => {
                  const mutation = requireJudgmentMutation(context);
                  return {
                    groupId: requireSelectedGroupId(context),
                    feedId: requireSelectedFeedId(context),
                    metricId: mutation.metricId,
                    postId: mutation.postId,
                    value: mutation.value,
                    note: mutation.note,
                  };
                },
                onDone: {
                  target: "loadingLeaderboard",
                  actions: [
                    assign({
                      metricLeaderboard: null,
                      metricsError: "",
                      judgmentMutation: null,
                    }),
                    sendToastToParent("Score saved"),
                  ],
                },
                onError: judgmentMutationErrorTransitions(),
              },
            },
            ready: {},
          },
        },
        creatingPostTag: {
          invoke: {
            src: "createGroupPostTag",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
              payload: requirePostTagMutation(context, "create").payload,
            }),
            onDone: [
              {
                target: "feedSelected.ready",
                guard: { type: "hasRestorableFeed" },
                actions: [
                  assign(({ context, event }) => ({
                    postTags: upsertPostTag(context.postTags, event.output),
                    postTagsError: "",
                    postTagMutation: null,
                  })),
                  sendToastToParent("Tag added"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => ({
                    postTags: upsertPostTag(context.postTags, event.output),
                    postTagsError: "",
                    postTagMutation: null,
                  })),
                  sendToastToParent("Tag added"),
                ],
              },
            ],
            onError: postTagMutationErrorTransitions(),
          },
        },
        updatingPostTag: {
          invoke: {
            src: "updateGroupPostTag",
            input: ({ context }) => {
              const mutation = requirePostTagMutation(context, "update");
              return {
                groupId: requireSelectedGroupId(context),
                tagId: mutation.tagId,
                payload: mutation.payload,
              };
            },
            onDone: [
              {
                target: "feedSelected.ready",
                guard: { type: "hasRestorableFeed" },
                actions: [
                  assign(({ context, event }) => ({
                    postTags: upsertPostTag(context.postTags, event.output),
                    postTagsError: "",
                    postTagMutation: null,
                  })),
                  sendToastToParent("Tag updated"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => ({
                    postTags: upsertPostTag(context.postTags, event.output),
                    postTagsError: "",
                    postTagMutation: null,
                  })),
                  sendToastToParent("Tag updated"),
                ],
              },
            ],
            onError: postTagMutationErrorTransitions(),
          },
        },
        deletingPostTag: {
          invoke: {
            src: "deleteGroupPostTag",
            input: ({ context }) => {
              const mutation = requirePostTagMutation(context, "delete");
              return {
                groupId: requireSelectedGroupId(context),
                tagId: mutation.tagId,
              };
            },
            onDone: [
              {
                target: "feedSelected.ready",
                guard: { type: "hasRestorableFeed" },
                actions: [
                  assign(({ context, event }) => ({
                    postTags: upsertPostTag(context.postTags, event.output),
                    postTagsError: "",
                    postTagMutation: null,
                  })),
                  sendToastToParent("Tag archived"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => ({
                    postTags: upsertPostTag(context.postTags, event.output),
                    postTagsError: "",
                    postTagMutation: null,
                  })),
                  sendToastToParent("Tag archived"),
                ],
              },
            ],
            onError: postTagMutationErrorTransitions(),
          },
        },
        removingGroupMember: {
          invoke: {
            src: "deleteGroupMember",
            input: ({ context }) => {
              const mutation = requireGroupMemberMutation(context);
              return {
                groupId: requireSelectedGroupId(context),
                userId: mutation.userId,
              };
            },
            onDone: [
              {
                target: "feedSelected.ready",
                guard: { type: "hasRestorableFeed" },
                actions: [
                  assign(({ context, event }) => ({
                    groupMembers: context.groupMembers.filter((member) => member.user_id !== event.output.userId),
                    groupMembersError: "",
                    groupMemberMutation: null,
                  })),
                  sendToastToParent("Member removed"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => ({
                    groupMembers: context.groupMembers.filter((member) => member.user_id !== event.output.userId),
                    groupMembersError: "",
                    groupMemberMutation: null,
                  })),
                  sendToastToParent("Member removed"),
                ],
              },
            ],
            onError: groupMemberMutationErrorTransitions(),
          },
        },
        togglingFeed: {
          invoke: {
            src: "toggleFeed",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
              feed: requirePendingToggleFeed(context),
            }),
            onDone: {
              target: "feedSelected.ready",
              actions: [
                assign(({ context, event }) => ({
                  feeds: replaceFeed(context.feeds, event.output),
                  pendingToggleFeedId: null,
                })),
                sendToggleToastToParent(),
              ],
            },
            onError: [
              unauthorizedToParentTransition(),
              {
                target: "feedSelected.ready",
                actions: [
                  assign({
                    pendingToggleFeedId: null,
                  }),
                  sendErrorToastToParent(),
                ],
              },
            ],
          },
        },
        deletingFeed: {
          invoke: {
            src: "deleteFeed",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
              feedId: requirePendingDeleteFeedId(context),
            }),
            onDone: [
              {
                target: "feedSelected.ready",
                guard: ({ context, event }) =>
                  context.selectedFeedId !== null && context.selectedFeedId !== event.output.feedId,
                actions: [
                  assign(({ context, event }) => ({
                    feeds: removeFeed(context.feeds, event.output.feedId),
                    pendingDeleteFeedId: null,
                  })),
                  sendToastToParent("Feed deleted"),
                ],
              },
              {
                target: "feedSelected.loadingTodayOutput",
                guard: ({ context, event }) => removeFeed(context.feeds, event.output.feedId).length > 0,
                actions: [
                  assign(({ context, event }) => {
                    const remainingFeeds = removeFeed(context.feeds, event.output.feedId);
                    const nextFeed = remainingFeeds[0];
                    return {
                      feeds: remainingFeeds,
                      selectedFeedId: nextFeed?.id ?? null,
                      selectedFeedDate: todayDateValue(),
                      output: null,
                      outputError: "",
                      posts: [],
                      postsError: "",
                      postMutation: null,
                      ...resetMetricContext(),
                      pendingToggleFeedId: null,
                      pendingDeleteFeedId: null,
                    };
                  }),
                  sendToastToParent("Feed deleted"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => ({
                    feeds: removeFeed(context.feeds, event.output.feedId),
                    selectedFeedId: null,
                    selectedFeedDate: todayDateValue(),
                    output: null,
                    outputError: "",
                    posts: [],
                    postsError: "",
                    postMutation: null,
                    ...resetMetricContext(),
                    pendingToggleFeedId: null,
                    pendingDeleteFeedId: null,
                  })),
                  sendToastToParent("Feed deleted"),
                ],
              },
            ],
            onError: restoreAfterFeedDeleteErrorTransitions(),
          },
        },
        addFeed: {
          invoke: {
            id: "addFeed",
            src: "addFeedMachine",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
            }),
          },
        },
      },
    },
  },
});

function initialDashboardContext(): DashboardContext {
  return {
    groups: [],
    selectedGroupId: null,
    preferredGroupId: null,
    ...resetSelectedGroupContext(),
    pendingGroupName: "",
    pendingDeleteGroupId: null,
  };
}

function resetSelectedGroupContext(): Omit<
  DashboardContext,
  "groups" | "selectedGroupId" | "preferredGroupId" | "pendingGroupName" | "pendingDeleteGroupId"
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
    groupMembers: [],
    groupMembersError: "",
    groupSettingsOpen: false,
    posts: [],
    postsError: "",
    ...resetMetricContext(),
    pendingToggleFeedId: null,
    pendingDeleteFeedId: null,
    postMutation: null,
    postTagMutation: null,
    groupMemberMutation: null,
  };
}

function resetMetricContext(): Pick<
  DashboardContext,
  "metrics" | "selectedMetricId" | "metricLeaderboard" | "metricsError" | "metricMutation" | "judgmentMutation"
> {
  return {
    metrics: [],
    selectedMetricId: null,
    metricLeaderboard: null,
    metricsError: "",
    metricMutation: null,
    judgmentMutation: null,
  };
}

function chooseGroupId(groups: Group[], preferredGroupId: string | null, currentGroupId: string | null): string | null {
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

function chooseMetricId(metrics: FeedMetric[], currentMetricId: string | null): string | null {
  if (currentMetricId !== null && metrics.some((metric) => metric.id === currentMetricId)) {
    return currentMetricId;
  }
  return metrics[0]?.id ?? null;
}

function selectedGroupCanManage(context: DashboardContext): boolean {
  const group = context.groups.find((candidate) => candidate.id === context.selectedGroupId);
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

function validPostUpdatePayload(payload: UpdatePostPayload): boolean {
  if (payload.evidenceText !== undefined && payload.evidenceText.trim() === "") {
    return false;
  }
  return payload.evidenceText !== undefined || payload.caption !== undefined || payload.tagIds !== undefined;
}

function closeAddFeedTransitions() {
  return [
    {
      target: ".groupSelected.feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
    },
    {
      target: ".groupSelected.noFeed",
      guard: { type: "hasRestorableGroup" },
    },
  ] as const;
}

function groupLoadErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "groupSelected.feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: sendErrorToastToParent(),
    },
    {
      target: "groupSelected.noFeed",
      guard: { type: "hasRestorableGroup" },
      actions: sendErrorToastToParent(),
    },
    {
      target: "noGroup",
      actions: sendErrorToastToParent(),
    },
  ] as const;
}

function restoreAfterGroupCreateErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "groupSelected.feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearPendingGroupNameOnError(), sendErrorToastToParent()],
    },
    {
      target: "groupSelected.noFeed",
      guard: { type: "hasRestorableGroup" },
      actions: [clearPendingGroupNameOnError(), sendErrorToastToParent()],
    },
    {
      target: "noGroup",
      actions: [clearPendingGroupNameOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function restoreAfterGroupDeleteErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "groupSelected.feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearPendingDeleteGroupIdOnError(), sendErrorToastToParent()],
    },
    {
      target: "groupSelected.noFeed",
      guard: { type: "hasRestorableGroup" },
      actions: [clearPendingDeleteGroupIdOnError(), sendErrorToastToParent()],
    },
    {
      target: "noGroup",
      actions: [clearPendingDeleteGroupIdOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function restoreAfterFeedDeleteErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearPendingDeleteFeedIdOnError(), sendErrorToastToParent()],
    },
    {
      target: "noFeed",
      actions: [clearPendingDeleteFeedIdOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function mutationErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "ready",
      actions: [clearPostMutationOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function postTagMutationErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearPostTagMutationOnError(), sendErrorToastToParent()],
    },
    {
      target: "noFeed",
      actions: [clearPostTagMutationOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function groupMemberMutationErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearGroupMemberMutationOnError(), sendErrorToastToParent()],
    },
    {
      target: "noFeed",
      actions: [clearGroupMemberMutationOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function metricMutationErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "ready",
      actions: [clearMetricMutationOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function judgmentMutationErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "ready",
      actions: [clearJudgmentMutationOnError(), sendErrorToastToParent()],
    },
  ] as const;
}

function unauthorizedToParentTransition() {
  return {
    guard: { type: "isUnauthorizedError" },
    actions: sendUnauthorizedErrorToParent(),
  } as const;
}

function toastRequested(message: string): DashboardOutputEvent {
  return { type: "TOAST_REQUESTED", message };
}

function sendToastToParent(message: string) {
  return sendParent<DashboardContext, EventObject, undefined, DashboardOutputEvent, DashboardEvent>(
    toastRequested(message),
  );
}

function sendErrorToastToParent() {
  return sendParent<DashboardContext, ErrorActorEvent, undefined, DashboardOutputEvent, DashboardEvent>(({ event }) =>
    toastRequested(errorMessage(event.error)),
  );
}

function sendToggleToastToParent() {
  return sendParent<DashboardContext, DoneActorEvent<DailyFeed>, undefined, DashboardOutputEvent, DashboardEvent>(
    ({ event }) => toastRequested(event.output.enabled ? "Feed enabled" : "Feed disabled"),
  );
}

function sendUnauthorizedDashboardEventToParent() {
  return sendParent<DashboardContext, DashboardEvent, undefined, DashboardOutputEvent, DashboardEvent>({
    type: "UNAUTHORIZED",
  });
}

function sendUnauthorizedErrorToParent() {
  return sendParent<DashboardContext, ErrorActorEvent, undefined, DashboardOutputEvent, DashboardEvent>({
    type: "UNAUTHORIZED",
  });
}

function clearPendingGroupNameOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    pendingGroupName: "",
  });
}

function clearPostMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    postMutation: null,
  });
}

function clearPostTagMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    postTagMutation: null,
  });
}

function clearGroupMemberMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    groupMemberMutation: null,
  });
}

function clearMetricMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    metricMutation: null,
  });
}

function clearJudgmentMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    judgmentMutation: null,
  });
}

function clearPendingDeleteGroupIdOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    pendingDeleteGroupId: null,
  });
}

function clearPendingDeleteFeedIdOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    pendingDeleteFeedId: null,
  });
}

function requireSelectedGroupId(context: DashboardContext): string {
  if (context.selectedGroupId === null) {
    throw new Error("No group selected");
  }
  return context.selectedGroupId;
}

function requireSelectedFeedId(context: DashboardContext): string {
  if (context.selectedFeedId === null) {
    throw new Error("No feed selected");
  }
  return context.selectedFeedId;
}

function requireSelectedMetricId(context: DashboardContext): string {
  if (context.selectedMetricId === null) {
    throw new Error("No metric selected");
  }
  return context.selectedMetricId;
}

function requireOutputDate(context: DashboardContext): string {
  if (context.output === null) {
    throw new Error("No feed output loaded");
  }
  return context.output.date || context.selectedFeedDate;
}

function requirePendingToggleFeed(context: DashboardContext): DailyFeed {
  const feed = context.feeds.find((candidate) => candidate.id === context.pendingToggleFeedId);
  if (feed === undefined) {
    throw new Error("Feed not found");
  }
  return feed;
}

function requirePendingDeleteGroupId(context: DashboardContext): string {
  if (context.pendingDeleteGroupId === null) {
    throw new Error("No group delete is pending");
  }
  return context.pendingDeleteGroupId;
}

function requirePendingDeleteFeedId(context: DashboardContext): string {
  if (context.pendingDeleteFeedId === null) {
    throw new Error("No feed delete is pending");
  }
  return context.pendingDeleteFeedId;
}

function requirePostMutation<TKind extends PostMutation["kind"]>(
  context: DashboardContext,
  kind: TKind,
): Extract<PostMutation, { kind: TKind }> {
  const mutation = context.postMutation;
  if (mutation === null || mutation.kind !== kind) {
    throw new Error("Post mutation is missing");
  }
  return mutation as Extract<PostMutation, { kind: TKind }>;
}

function requirePostTagMutation<TKind extends PostTagMutation["kind"]>(
  context: DashboardContext,
  kind: TKind,
): Extract<PostTagMutation, { kind: TKind }> {
  const mutation = context.postTagMutation;
  if (mutation === null || mutation.kind !== kind) {
    throw new Error("Post tag mutation is missing");
  }
  return mutation as Extract<PostTagMutation, { kind: TKind }>;
}

function requireGroupMemberMutation(context: DashboardContext): GroupMemberMutation {
  if (context.groupMemberMutation === null) {
    throw new Error("Group member mutation is missing");
  }
  return context.groupMemberMutation;
}

function requireMetricMutation<TKind extends MetricMutation["kind"]>(
  context: DashboardContext,
  kind: TKind,
): Extract<MetricMutation, { kind: TKind }> {
  const mutation = context.metricMutation;
  if (mutation === null || mutation.kind !== kind) {
    throw new Error("Metric mutation is missing");
  }
  return mutation as Extract<MetricMutation, { kind: TKind }>;
}

function requireJudgmentMutation(context: DashboardContext): JudgmentMutation {
  if (context.judgmentMutation === null) {
    throw new Error("Judgment mutation is missing");
  }
  return context.judgmentMutation;
}

function replaceFeed(feeds: DailyFeed[], updated: DailyFeed): DailyFeed[] {
  return feeds.map((feed) => (feed.id === updated.id ? updated : feed));
}

function removeFeed(feeds: DailyFeed[], feedId: string): DailyFeed[] {
  return feeds.filter((feed) => feed.id !== feedId);
}

function upsertPost(posts: GroupFeedPost[], post: GroupFeedPost): GroupFeedPost[] {
  return [post, ...posts.filter((candidate) => candidate.id !== post.id)];
}

function upsertPostTag(tags: GroupPostTag[], tag: GroupPostTag): GroupPostTag[] {
  return [...tags.filter((candidate) => candidate.id !== tag.id), tag].sort(postTagSort);
}

function upsertMetric(metrics: FeedMetric[], metric: FeedMetric): FeedMetric[] {
  return [...metrics.filter((candidate) => candidate.id !== metric.id), metric].sort(metricSort);
}

function replaceMetric(metrics: FeedMetric[], metric: FeedMetric): FeedMetric[] {
  return metrics.map((candidate) => (candidate.id === metric.id ? metric : candidate)).sort(metricSort);
}

function removeMetric(metrics: FeedMetric[], metricId: string): FeedMetric[] {
  return metrics.filter((metric) => metric.id !== metricId);
}

function selectedMetricAfterDelete(
  metrics: FeedMetric[],
  selectedMetricId: string | null,
  deletedMetricId: string,
): string | null {
  if (selectedMetricId !== deletedMetricId && metrics.some((metric) => metric.id === selectedMetricId)) {
    return selectedMetricId;
  }
  return metrics[0]?.id ?? null;
}

function metricSort(left: FeedMetric, right: FeedMetric): number {
  const byName = left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" });
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id);
}

function postTagSort(left: GroupPostTag, right: GroupPostTag): number {
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id);
}
