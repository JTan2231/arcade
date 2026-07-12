import { assign, sendParent, setup } from "xstate";
import type { DoneActorEvent, ErrorActorEvent, EventObject } from "xstate";

import { todayDateValue } from "../dates";
import { errorMessage } from "../errors";
import type { DailyFeed, EvidenceFormat } from "../types";
import { dashboardActors } from "./dashboard/actors";
import {
  normalizeEvidenceFormatCreatePayload,
  removeFeed,
  removeMetric,
  replaceFeed,
  replaceMetric,
  selectedMetricAfterDelete,
  updateEvidenceFormatAssignedFeedCount,
  updateEvidenceFormatFeedCountsForFeedChange,
  upsertEvidenceFormat,
  upsertMetric,
  upsertPost,
  upsertPostTag,
} from "./dashboard/collections";
import {
  chooseGroupId,
  chooseMetricId,
  initialDashboardContext,
  resetMetricContext,
  resetSelectedGroupContext,
  selectedGroupCanManage,
  validPostUpdatePayload,
} from "./dashboard/context";
import type {
  DashboardContext,
  DashboardEvent,
  DashboardInput,
  DashboardOutputEvent,
  EvidenceFormatMutation,
  FeedFormatMutation,
  FeedScheduleMutation,
  GroupMemberMutation,
  GroupVisibilityMutation,
  JudgmentMutation,
  MetricMutation,
  PostMutation,
  PostTagMutation,
  UpdatePostInput,
} from "./dashboard/events";
import { dashboardGuards } from "./dashboard/guards";

export type { DashboardContext, DashboardOutputEvent } from "./dashboard/events";

const dashboardSetup = setup({
  types: {
    context: {} as DashboardContext,
    events: {} as DashboardEvent,
    input: {} as DashboardInput,
  },
  guards: dashboardGuards,
  actors: dashboardActors,
});

export const dashboardMachine = dashboardSetup.createMachine({
  id: "dashboard",
  context: ({ input }) => initialDashboardContext(input),
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
    GROUP_VISIBILITY_CHANGED: {
      guard: ({ context, event }) =>
        context.groups.some((group) => group.id === event.groupId && group.visibility !== event.visibility),
      target: ".groupSelected.updatingGroupVisibility",
      actions: assign(({ event }) => ({
        groupVisibilityMutation: {
          groupId: event.groupId,
          visibility: event.visibility,
        },
      })),
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
      guard: ({ context, event }) =>
        context.selectedGroupId !== null && context.selectedFeedId !== null && event.date !== context.selectedFeedDate,
      target: ".groupSelected.feedSelected.loadingDatedOutput",
      reenter: true,
      actions: assign(({ event }) => ({
        selectedFeedDate: event.date,
        output: null,
        outputError: "",
        posts: [],
        postsError: "",
        postMutation: null,
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
    FEED_FORMAT_CHANGED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null &&
        context.feeds.some((feed) => feed.id === event.feedId && feed.evidence_format.id !== event.evidenceFormatId) &&
        context.evidenceFormats.some(
          (format) => format.id === event.evidenceFormatId && format.archived_at === undefined,
        ),
      target: ".groupSelected.changingFeedFormat",
      actions: assign(({ event }) => ({
        feedFormatMutation: {
          feedId: event.feedId,
          evidenceFormatId: event.evidenceFormatId,
        },
      })),
    },
    FEED_SCHEDULE_CHANGED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null &&
        context.feeds.some(
          (feed) =>
            feed.id === event.feedId &&
            (feed.schedule.interval_seconds !== event.schedule.interval_seconds ||
              feed.schedule.timezone !== event.schedule.timezone ||
              feed.schedule.starts_at !== event.schedule.starts_at),
        ),
      target: ".groupSelected.changingFeedSchedule",
      actions: assign(({ event }) => ({
        feedScheduleMutation: {
          feedId: event.feedId,
          schedule: event.schedule,
        },
      })),
    },
    FEED_GENERATION_REFRESHED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null &&
        context.feeds.some((feed) => feed.id === event.feedId && feed.kind === "catalog_daily"),
      target: ".groupSelected.refreshingFeedGeneration",
      actions: assign(({ event }) => ({
        pendingRefreshFeedId: event.feedId,
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
          evidenceFormats: updateEvidenceFormatAssignedFeedCount(
            context.evidenceFormats,
            event.feed.evidence_format.id,
            1,
          ),
          selectedFeedId: event.feed.id,
          selectedFeedDate: todayDateValue(),
          output: null,
          outputError: "",
          posts: [],
          postsError: "",
          postMutation: null,
          ...resetMetricContext(),
          pendingToggleFeedId: null,
          pendingRefreshFeedId: null,
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
    EVIDENCE_FORMAT_CREATE_SUBMITTED: {
      guard: ({ context, event }) =>
        context.selectedGroupId !== null && event.payload.slug.trim() !== "" && event.payload.name.trim() !== "",
      target: ".groupSelected.creatingEvidenceFormat",
      actions: assign(({ event }) => ({
        evidenceFormatMutation: {
          kind: "create",
          payload: normalizeEvidenceFormatCreatePayload(event.payload),
        },
      })),
    },
    EVIDENCE_FORMAT_UPDATE_SUBMITTED: {
      guard: ({ context, event }) => context.evidenceFormats.some((format) => format.id === event.formatId),
      target: ".groupSelected.updatingEvidenceFormat",
      actions: assign(({ event }) => ({
        evidenceFormatMutation: {
          kind: "update",
          formatId: event.formatId,
          payload: event.payload,
        },
      })),
    },
    EVIDENCE_FORMAT_VERSION_CREATE_SUBMITTED: {
      guard: ({ context, event }) => context.evidenceFormats.some((format) => format.id === event.formatId),
      target: ".groupSelected.creatingEvidenceFormatVersion",
      actions: assign(({ event }) => ({
        evidenceFormatMutation: {
          kind: "version",
          formatId: event.formatId,
          payload: event.payload,
        },
      })),
    },
    EVIDENCE_FORMAT_DELETE_SUBMITTED: {
      guard: ({ context, event }) => context.evidenceFormats.some((format) => format.id === event.formatId),
      target: ".groupSelected.deletingEvidenceFormat",
      actions: assign(({ event }) => ({
        evidenceFormatMutation: {
          kind: "delete",
          formatId: event.formatId,
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
        metricsError: "",
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
        input: ({ context }) => ({ currentUserId: context.currentUserId }),
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
        input: ({ context }) => ({ currentUserId: context.currentUserId, name: context.pendingGroupName }),
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
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: requirePendingDeleteGroupId(context),
        }),
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
              currentUserId: context.currentUserId,
              groupId: requireSelectedGroupId(context),
              includeArchivedPostTags: selectedGroupCanManage(context),
              includeArchivedEvidenceFormats: selectedGroupCanManage(context),
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
                    evidenceFormats: event.output.evidenceFormats,
                    evidenceFormatsError: event.output.evidenceFormatsError,
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
                    evidenceFormatMutation: null,
                    feedFormatMutation: null,
                    feedScheduleMutation: null,
                    groupMemberMutation: null,
                    ...resetMetricContext(),
                    pendingToggleFeedId: null,
                    pendingRefreshFeedId: null,
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
                  evidenceFormats: event.output.evidenceFormats,
                  evidenceFormatsError: event.output.evidenceFormatsError,
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
                  evidenceFormatMutation: null,
                  feedFormatMutation: null,
                  feedScheduleMutation: null,
                  groupMemberMutation: null,
                  ...resetMetricContext(),
                  pendingToggleFeedId: null,
                  pendingRefreshFeedId: null,
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
                  evidenceFormats: [],
                  evidenceFormatsError: "",
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
                  evidenceFormatMutation: null,
                  feedFormatMutation: null,
                  feedScheduleMutation: null,
                  groupMemberMutation: null,
                  ...resetMetricContext(),
                  pendingToggleFeedId: null,
                  pendingRefreshFeedId: null,
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
                  currentUserId: context.currentUserId,
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
                  currentUserId: context.currentUserId,
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                  date: context.selectedFeedDate,
                }),
                onDone: {
                  target: "loadingDatedPosts",
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
            loadingDatedPosts: {
              invoke: {
                src: "listGroupFeedPosts",
                input: ({ context }) => ({
                  currentUserId: context.currentUserId,
                  groupId: requireSelectedGroupId(context),
                  feedId: requireSelectedFeedId(context),
                  date: requireOutputDate(context),
                }),
                onDone: [
                  {
                    target: "ready",
                    guard: ({ context }) => context.metricsLoaded,
                    actions: assign(({ event }) => ({
                      posts: event.output,
                      postsError: "",
                      postMutation: null,
                    })),
                  },
                  {
                    target: "loadingMetrics",
                    actions: assign(({ event }) => ({
                      posts: event.output,
                      postsError: "",
                      postMutation: null,
                    })),
                  },
                ],
                onError: [
                  unauthorizedToParentTransition(),
                  {
                    target: "ready",
                    guard: ({ context }) => context.metricsLoaded,
                    actions: assign(({ event }) => ({
                      posts: [],
                      postsError: errorMessage(event.error),
                      postMutation: null,
                    })),
                  },
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
            loadingPosts: {
              invoke: {
                src: "listGroupFeedPosts",
                input: ({ context }) => ({
                  currentUserId: context.currentUserId,
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
                  currentUserId: context.currentUserId,
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
                        metricsLoaded: true,
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
                      metricsLoaded: true,
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
                      metricsLoaded: true,
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
                  currentUserId: context.currentUserId,
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
                    currentUserId: context.currentUserId,
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
                    currentUserId: context.currentUserId,
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
                    currentUserId: context.currentUserId,
                    groupId: requireSelectedGroupId(context),
                    feedId: requireSelectedFeedId(context),
                    date: requireOutputDate(context),
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
                  currentUserId: context.currentUserId,
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
                    currentUserId: context.currentUserId,
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
                    currentUserId: context.currentUserId,
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
                    currentUserId: context.currentUserId,
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
              currentUserId: context.currentUserId,
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
                currentUserId: context.currentUserId,
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
                currentUserId: context.currentUserId,
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
        creatingEvidenceFormat: {
          invoke: {
            src: "createGroupEvidenceFormat",
            input: ({ context }) => ({
              currentUserId: context.currentUserId,
              groupId: requireSelectedGroupId(context),
              payload: requireEvidenceFormatMutation(context, "create").payload,
            }),
            onDone: evidenceFormatMutationDoneTransitions("Format added"),
            onError: evidenceFormatMutationErrorTransitions(),
          },
        },
        updatingEvidenceFormat: {
          invoke: {
            src: "updateGroupEvidenceFormat",
            input: ({ context }) => {
              const mutation = requireEvidenceFormatMutation(context, "update");
              return {
                currentUserId: context.currentUserId,
                groupId: requireSelectedGroupId(context),
                formatId: mutation.formatId,
                payload: mutation.payload,
              };
            },
            onDone: evidenceFormatMutationDoneTransitions("Format updated"),
            onError: evidenceFormatMutationErrorTransitions(),
          },
        },
        creatingEvidenceFormatVersion: {
          invoke: {
            src: "createGroupEvidenceFormatVersion",
            input: ({ context }) => {
              const mutation = requireEvidenceFormatMutation(context, "version");
              return {
                currentUserId: context.currentUserId,
                groupId: requireSelectedGroupId(context),
                formatId: mutation.formatId,
                payload: mutation.payload,
              };
            },
            onDone: evidenceFormatMutationDoneTransitions("Format rules updated"),
            onError: evidenceFormatMutationErrorTransitions(),
          },
        },
        deletingEvidenceFormat: {
          invoke: {
            src: "deleteGroupEvidenceFormat",
            input: ({ context }) => {
              const mutation = requireEvidenceFormatMutation(context, "delete");
              return {
                currentUserId: context.currentUserId,
                groupId: requireSelectedGroupId(context),
                formatId: mutation.formatId,
              };
            },
            onDone: evidenceFormatMutationDoneTransitions("Format archived"),
            onError: evidenceFormatMutationErrorTransitions(),
          },
        },
        removingGroupMember: {
          invoke: {
            src: "deleteGroupMember",
            input: ({ context }) => {
              const mutation = requireGroupMemberMutation(context);
              return {
                currentUserId: context.currentUserId,
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
        updatingGroupVisibility: {
          invoke: {
            src: "updateGroupVisibility",
            input: ({ context }) => {
              const mutation = requireGroupVisibilityMutation(context);
              return {
                currentUserId: context.currentUserId,
                groupId: mutation.groupId,
                payload: {
                  visibility: mutation.visibility,
                },
              };
            },
            onDone: [
              {
                target: "feedSelected.ready",
                guard: { type: "hasRestorableFeed" },
                actions: [
                  assign(({ context, event }) => ({
                    groups: context.groups.map((group) => (group.id === event.output.id ? event.output : group)),
                    groupVisibilityMutation: null,
                  })),
                  sendToastToParent("Group visibility updated"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => ({
                    groups: context.groups.map((group) => (group.id === event.output.id ? event.output : group)),
                    groupVisibilityMutation: null,
                  })),
                  sendToastToParent("Group visibility updated"),
                ],
              },
            ],
            onError: groupVisibilityMutationErrorTransitions(),
          },
        },
        togglingFeed: {
          invoke: {
            src: "toggleFeed",
            input: ({ context }) => ({
              currentUserId: context.currentUserId,
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
        changingFeedFormat: {
          invoke: {
            src: "changeFeedFormat",
            input: ({ context }) => {
              const mutation = requireFeedFormatMutation(context);
              return {
                currentUserId: context.currentUserId,
                groupId: requireSelectedGroupId(context),
                feedId: mutation.feedId,
                evidenceFormatId: mutation.evidenceFormatId,
              };
            },
            onDone: {
              target: "feedSelected.ready",
              actions: [
                assign(({ context, event }) => ({
                  feeds: replaceFeed(context.feeds, event.output),
                  evidenceFormats: updateEvidenceFormatFeedCountsForFeedChange(
                    context.evidenceFormats,
                    context.feeds.find((feed) => feed.id === event.output.id)?.evidence_format.id ?? null,
                    event.output.evidence_format.id,
                  ),
                  feedFormatMutation: null,
                })),
                sendToastToParent("Feed format updated"),
              ],
            },
            onError: [
              unauthorizedToParentTransition(),
              {
                target: "feedSelected.ready",
                actions: [clearFeedFormatMutationOnError(), sendErrorToastToParent()],
              },
            ],
          },
        },
        changingFeedSchedule: {
          invoke: {
            src: "changeFeedSchedule",
            input: ({ context }) => {
              const mutation = requireFeedScheduleMutation(context);
              return {
                currentUserId: context.currentUserId,
                groupId: requireSelectedGroupId(context),
                feedId: mutation.feedId,
                schedule: mutation.schedule,
              };
            },
            onDone: [
              {
                target: "feedSelected.loadingTodayOutput",
                guard: ({ context, event }) => context.selectedFeedId === event.output.id,
                actions: [
                  assign(({ context, event }) => ({
                    feeds: replaceFeed(context.feeds, event.output),
                    selectedFeedDate: todayDateValue(),
                    output: null,
                    outputError: "",
                    posts: [],
                    postsError: "",
                    postMutation: null,
                    feedScheduleMutation: null,
                    ...resetMetricContext(),
                  })),
                  sendToastToParent("Feed cadence updated"),
                ],
              },
              {
                target: "feedSelected.ready",
                guard: { type: "hasRestorableFeed" },
                actions: [
                  assign(({ context, event }) => ({
                    feeds: replaceFeed(context.feeds, event.output),
                    feedScheduleMutation: null,
                  })),
                  sendToastToParent("Feed cadence updated"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => ({
                    feeds: replaceFeed(context.feeds, event.output),
                    feedScheduleMutation: null,
                  })),
                  sendToastToParent("Feed cadence updated"),
                ],
              },
            ],
            onError: [
              unauthorizedToParentTransition(),
              {
                target: "feedSelected.ready",
                actions: [clearFeedScheduleMutationOnError(), sendErrorToastToParent()],
              },
            ],
          },
        },
        refreshingFeedGeneration: {
          invoke: {
            src: "refreshFeedGeneration",
            input: ({ context }) => ({
              currentUserId: context.currentUserId,
              groupId: requireSelectedGroupId(context),
              feedId: requirePendingRefreshFeedId(context),
            }),
            onDone: [
              {
                target: "feedSelected.loadingPosts",
                guard: ({ context, event }) => context.selectedFeedId === event.output.feed_id,
                actions: [
                  assign(({ event }) => ({
                    output: event.output,
                    selectedFeedDate: event.output.date,
                    outputError: "",
                    posts: [],
                    postsError: "",
                    postMutation: null,
                    metricLeaderboard: null,
                    metricsError: "",
                    pendingRefreshFeedId: null,
                  })),
                  sendToastToParent("Feed refreshed"),
                ],
              },
              {
                target: "feedSelected.ready",
                guard: { type: "hasRestorableFeed" },
                actions: [
                  assign({
                    pendingRefreshFeedId: null,
                  }),
                  sendToastToParent("Feed refreshed"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign({
                    pendingRefreshFeedId: null,
                  }),
                  sendToastToParent("Feed refreshed"),
                ],
              },
            ],
            onError: restoreAfterFeedRefreshErrorTransitions(),
          },
        },
        deletingFeed: {
          invoke: {
            src: "deleteFeed",
            input: ({ context }) => ({
              currentUserId: context.currentUserId,
              groupId: requireSelectedGroupId(context),
              feedId: requirePendingDeleteFeedId(context),
            }),
            onDone: [
              {
                target: "feedSelected.ready",
                guard: ({ context, event }) =>
                  context.selectedFeedId !== null && context.selectedFeedId !== event.output.feedId,
                actions: [
                  assign(({ context, event }) => {
                    const deletedFormatId = context.feeds.find((feed) => feed.id === event.output.feedId)
                      ?.evidence_format.id;
                    return {
                      feeds: removeFeed(context.feeds, event.output.feedId),
                      evidenceFormats:
                        deletedFormatId === undefined
                          ? context.evidenceFormats
                          : updateEvidenceFormatAssignedFeedCount(context.evidenceFormats, deletedFormatId, -1),
                      pendingDeleteFeedId: null,
                    };
                  }),
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
                    const deletedFormatId = context.feeds.find((feed) => feed.id === event.output.feedId)
                      ?.evidence_format.id;
                    return {
                      feeds: remainingFeeds,
                      evidenceFormats:
                        deletedFormatId === undefined
                          ? context.evidenceFormats
                          : updateEvidenceFormatAssignedFeedCount(context.evidenceFormats, deletedFormatId, -1),
                      selectedFeedId: nextFeed?.id ?? null,
                      selectedFeedDate: todayDateValue(),
                      output: null,
                      outputError: "",
                      posts: [],
                      postsError: "",
                      postMutation: null,
                      ...resetMetricContext(),
                      pendingToggleFeedId: null,
                      pendingRefreshFeedId: null,
                      pendingDeleteFeedId: null,
                    };
                  }),
                  sendToastToParent("Feed deleted"),
                ],
              },
              {
                target: "noFeed",
                actions: [
                  assign(({ context, event }) => {
                    const deletedFormatId = context.feeds.find((feed) => feed.id === event.output.feedId)
                      ?.evidence_format.id;
                    return {
                      feeds: removeFeed(context.feeds, event.output.feedId),
                      evidenceFormats:
                        deletedFormatId === undefined
                          ? context.evidenceFormats
                          : updateEvidenceFormatAssignedFeedCount(context.evidenceFormats, deletedFormatId, -1),
                      selectedFeedId: null,
                      selectedFeedDate: todayDateValue(),
                      output: null,
                      outputError: "",
                      posts: [],
                      postsError: "",
                      postMutation: null,
                      ...resetMetricContext(),
                      pendingToggleFeedId: null,
                      pendingRefreshFeedId: null,
                      pendingDeleteFeedId: null,
                    };
                  }),
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
              currentUserId: context.currentUserId,
              groupId: requireSelectedGroupId(context),
            }),
          },
        },
      },
    },
  },
});

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

function restoreAfterFeedRefreshErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearPendingRefreshFeedIdOnError(), sendErrorToastToParent()],
    },
    {
      target: "noFeed",
      actions: [clearPendingRefreshFeedIdOnError(), sendErrorToastToParent()],
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

function evidenceFormatMutationDoneTransitions(message: string) {
  return [
    {
      target: "feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [upsertEvidenceFormatOnDone(), sendToastToParent<DoneActorEvent<EvidenceFormat>>(message)],
    },
    {
      target: "noFeed",
      actions: [upsertEvidenceFormatOnDone(), sendToastToParent<DoneActorEvent<EvidenceFormat>>(message)],
    },
  ] as const;
}

function evidenceFormatMutationErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearEvidenceFormatMutationOnError(), sendErrorToastToParent()],
    },
    {
      target: "noFeed",
      actions: [clearEvidenceFormatMutationOnError(), sendErrorToastToParent()],
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

function groupVisibilityMutationErrorTransitions() {
  return [
    unauthorizedToParentTransition(),
    {
      target: "feedSelected.ready",
      guard: { type: "hasRestorableFeed" },
      actions: [clearGroupVisibilityMutationOnError(), sendErrorToastToParent()],
    },
    {
      target: "noFeed",
      actions: [clearGroupVisibilityMutationOnError(), sendErrorToastToParent()],
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

function sendToastToParent<TEvent extends EventObject = EventObject>(message: string) {
  return sendParent<DashboardContext, TEvent, undefined, DashboardOutputEvent, DashboardEvent>(toastRequested(message));
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

function upsertEvidenceFormatOnDone() {
  return assign<DashboardContext, DoneActorEvent<EvidenceFormat>, undefined, DashboardEvent, never>(
    ({ context, event }) => ({
      evidenceFormats: upsertEvidenceFormat(context.evidenceFormats, event.output),
      evidenceFormatsError: "",
      evidenceFormatMutation: null,
    }),
  );
}

function clearEvidenceFormatMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    evidenceFormatMutation: null,
  });
}

function clearFeedFormatMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    feedFormatMutation: null,
  });
}

function clearFeedScheduleMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    feedScheduleMutation: null,
  });
}

function clearGroupMemberMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    groupMemberMutation: null,
  });
}

function clearGroupVisibilityMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    groupVisibilityMutation: null,
  });
}

function clearMetricMutationOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>(({ event }) => ({
    metricMutation: null,
    metricsError: errorMessage(event.error),
  }));
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

function clearPendingRefreshFeedIdOnError() {
  return assign<DashboardContext, ErrorActorEvent, undefined, DashboardEvent, never>({
    pendingRefreshFeedId: null,
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

function requirePendingRefreshFeedId(context: DashboardContext): string {
  if (context.pendingRefreshFeedId === null) {
    throw new Error("No feed refresh is pending");
  }
  return context.pendingRefreshFeedId;
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

function requireEvidenceFormatMutation<TKind extends EvidenceFormatMutation["kind"]>(
  context: DashboardContext,
  kind: TKind,
): Extract<EvidenceFormatMutation, { kind: TKind }> {
  const mutation = context.evidenceFormatMutation;
  if (mutation === null || mutation.kind !== kind) {
    throw new Error("Evidence format mutation is missing");
  }
  return mutation as Extract<EvidenceFormatMutation, { kind: TKind }>;
}

function requireFeedFormatMutation(context: DashboardContext): FeedFormatMutation {
  if (context.feedFormatMutation === null) {
    throw new Error("Feed format mutation is missing");
  }
  return context.feedFormatMutation;
}

function requireFeedScheduleMutation(context: DashboardContext): FeedScheduleMutation {
  if (context.feedScheduleMutation === null) {
    throw new Error("Feed schedule mutation is missing");
  }
  return context.feedScheduleMutation;
}

function requireGroupMemberMutation(context: DashboardContext): GroupMemberMutation {
  if (context.groupMemberMutation === null) {
    throw new Error("Group member mutation is missing");
  }
  return context.groupMemberMutation;
}

function requireGroupVisibilityMutation(context: DashboardContext): GroupVisibilityMutation {
  if (context.groupVisibilityMutation === null) {
    throw new Error("Group visibility mutation is missing");
  }
  return context.groupVisibilityMutation;
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
