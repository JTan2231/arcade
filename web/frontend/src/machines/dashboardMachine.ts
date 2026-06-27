import { assign, fromPromise, sendParent, setup } from "xstate";
import type { DoneActorEvent, ErrorActorEvent, EventObject } from "xstate";

import {
  createGroup,
  createGroupFeedPost,
  deleteGroup,
  deleteGroupDailyFeed,
  deleteGroupFeedPost,
  getGroupDailyFeedOutput,
  getGroupDailyFeedToday,
  isUnauthorized,
  listGroupDailyFeeds,
  listGroupFeedPosts,
  listGroups,
  updateGroupDailyFeed,
  updateGroupFeedPost,
} from "../api";
import { todayDateValue } from "../dates";
import { errorMessage } from "../errors";
import type { AddFeedOutputEvent } from "./addFeedMachine";
import { addFeedMachine } from "./addFeedMachine";
import type { DailyFeed, DailyFeedOutput, Group, GroupFeedPost, User } from "../types";

type PostPayload = {
  evidenceText: string;
  caption: string;
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
      evidenceText: string;
      caption: string;
    }
  | {
      kind: "delete";
      postId: string;
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

  posts: GroupFeedPost[];
  postsError: string;

  pendingGroupName: string;
  pendingToggleFeedId: string | null;
  pendingDeleteGroupId: string | null;
  pendingDeleteFeedId: string | null;
  postMutation: PostMutation | null;
};

type DashboardInput = {
  user: User | null;
};

type DashboardUserEvent =
  | { type: "GROUPS_REFRESH_REQUESTED"; preferredGroupId?: string | null }
  | { type: "GROUP_CREATE_SUBMITTED"; name: string }
  | { type: "GROUP_SELECTED"; groupId: string }
  | { type: "GROUP_DELETE_SUBMITTED"; groupId: string }
  | { type: "FEED_SELECTED"; feedId: string }
  | { type: "FEED_DATE_CHANGED"; date: string }
  | { type: "FEED_ENABLED_TOGGLED"; feedId: string }
  | { type: "FEED_DELETE_SUBMITTED"; feedId: string }
  | { type: "POST_CREATE_SUBMITTED"; payload: PostPayload }
  | { type: "POST_UPDATE_SUBMITTED"; postId: string; payload: PostPayload }
  | { type: "POST_DELETE_SUBMITTED"; postId: string }
  | { type: "ADD_FEED_OPENED" }
  | { type: "ADD_FEED_CLOSED" };

export type DashboardOutputEvent = { type: "UNAUTHORIZED" } | { type: "TOAST_REQUESTED"; message: string };

type DashboardEvent = DashboardUserEvent | AddFeedOutputEvent;

type FeedInput = {
  groupId: string;
  feedId: string;
};

type DatedFeedInput = FeedInput & {
  date: string;
};

type ToggleFeedInput = {
  groupId: string;
  feed: DailyFeed;
};

type DeleteGroupOutput = {
  groupId: string;
};

type DeleteFeedOutput = {
  feedId: string;
};

type CreatePostInput = DatedFeedInput & PostPayload;

type UpdatePostInput = {
  groupId: string;
  postId: string;
  evidenceText: string;
  caption: string;
};

type DeletePostOutput = {
  postId: string;
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
    listGroupDailyFeeds: fromPromise<DailyFeed[], { groupId: string }>(({ input, signal }) =>
      listGroupDailyFeeds(input.groupId, { signal }),
    ),
    getGroupDailyFeedToday: fromPromise<DailyFeedOutput, FeedInput>(({ input, signal }) =>
      getGroupDailyFeedToday(input.groupId, input.feedId, { signal }),
    ),
    getGroupDailyFeedOutput: fromPromise<DailyFeedOutput, DatedFeedInput>(({ input, signal }) =>
      getGroupDailyFeedOutput(input.groupId, input.feedId, input.date, { signal }),
    ),
    listGroupFeedPosts: fromPromise<GroupFeedPost[], DatedFeedInput>(({ input, signal }) =>
      listGroupFeedPosts(input.groupId, input.feedId, input.date, { signal }),
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
          evidence_kind: "text",
          evidence_text: input.evidenceText,
          caption: input.caption !== "" ? input.caption : null,
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
      guard: ({ context, event }) => context.selectedGroupId !== null && event.payload.evidenceText.trim() !== "",
      target: ".groupSelected.feedSelected.updatingPost",
      actions: assign(({ event }) => ({
        postMutation: {
          kind: "update",
          postId: event.postId,
          evidenceText: event.payload.evidenceText.trim(),
          caption: event.payload.caption.trim(),
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
            src: "listGroupDailyFeeds",
            input: ({ context }) => ({ groupId: requireSelectedGroupId(context) }),
            onDone: [
              {
                target: "feedSelected.loadingTodayOutput",
                guard: ({ event }) => event.output.length > 0,
                actions: assign(({ event }) => {
                  const firstFeed = event.output[0];
                  return {
                    feeds: event.output,
                    selectedFeedId: firstFeed?.id ?? null,
                    selectedFeedDate: todayDateValue(),
                    feedsError: "",
                    output: null,
                    outputError: "",
                    posts: [],
                    postsError: "",
                    postMutation: null,
                    pendingToggleFeedId: null,
                    pendingDeleteFeedId: null,
                  };
                }),
              },
              {
                target: "noFeed",
                actions: assign(({ event }) => ({
                  feeds: event.output,
                  selectedFeedId: null,
                  selectedFeedDate: todayDateValue(),
                  feedsError: "",
                  output: null,
                  outputError: "",
                  posts: [],
                  postsError: "",
                  postMutation: null,
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
                  selectedFeedId: null,
                  selectedFeedDate: todayDateValue(),
                  feedsError: errorMessage(event.error),
                  output: null,
                  outputError: "",
                  posts: [],
                  postsError: "",
                  postMutation: null,
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
                  target: "ready",
                  actions: assign(({ event }) => ({
                    posts: event.output,
                    postsError: "",
                    postMutation: null,
                  })),
                },
                onError: [
                  unauthorizedToParentTransition(),
                  {
                    target: "ready",
                    actions: assign(({ event }) => ({
                      posts: [],
                      postsError: errorMessage(event.error),
                      postMutation: null,
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
                onDone: {
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
                onError: mutationErrorTransitions(),
              },
            },
            updatingPost: {
              invoke: {
                src: "updateGroupFeedPost",
                input: ({ context }) => {
                  const mutation = requirePostMutation(context, "update");
                  return {
                    groupId: requireSelectedGroupId(context),
                    postId: mutation.postId,
                    evidenceText: mutation.evidenceText,
                    caption: mutation.caption,
                  };
                },
                onDone: {
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
                onDone: {
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
                onError: mutationErrorTransitions(),
              },
            },
            ready: {},
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
    posts: [],
    postsError: "",
    pendingToggleFeedId: null,
    pendingDeleteFeedId: null,
    postMutation: null,
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

function replaceFeed(feeds: DailyFeed[], updated: DailyFeed): DailyFeed[] {
  return feeds.map((feed) => (feed.id === updated.id ? updated : feed));
}

function removeFeed(feeds: DailyFeed[], feedId: string): DailyFeed[] {
  return feeds.filter((feed) => feed.id !== feedId);
}

function upsertPost(posts: GroupFeedPost[], post: GroupFeedPost): GroupFeedPost[] {
  return [post, ...posts.filter((candidate) => candidate.id !== post.id)];
}
