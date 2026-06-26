import { assign, fromPromise, setup } from "xstate";

import {
  createGroup,
  createGroupDailyFeed,
  createGroupFeedPost,
  deleteGroupFeedPost,
  getGroupDailyFeedOutput,
  getGroupDailyFeedToday,
  getSession,
  isUnauthorized,
  listGroupCatalogSources,
  listGroupDailyFeeds,
  listGroupFeedPosts,
  listGroups,
  login,
  logout,
  previewGroupDailyFeed,
  signup,
  updateGroupDailyFeed,
  updateGroupFeedPost,
} from "../api";
import { todayDateValue } from "../dates";
import { errorMessage } from "../errors";
import type {
  CatalogSource,
  CreateDailyFeedRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedPreview,
  Group,
  GroupFeedPost,
  LoginRequest,
  SignupRequest,
  User,
} from "../types";

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

type AppContext = {
  user: User | null;
  authError: string;

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

  addFeedOpen: boolean;
  addFeedSources: CatalogSource[];
  addFeedPreview: DailyFeedPreview | null;
  addFeedError: string;
  pendingAddFeedPayload: CreateDailyFeedRequest | null;

  pendingGroupName: string;
  pendingToggleFeedId: string | null;
  postMutation: PostMutation | null;

  toastMessage: string | null;
};

type AppEvent =
  | { type: "LOGIN_SUBMITTED"; payload: LoginRequest }
  | { type: "SIGNUP_SUBMITTED"; payload: SignupRequest }
  | { type: "LOGOUT_REQUESTED" }
  | { type: "GROUPS_REFRESH_REQUESTED"; preferredGroupId?: string | null }
  | { type: "GROUP_CREATE_SUBMITTED"; name: string }
  | { type: "GROUP_SELECTED"; groupId: string }
  | { type: "FEED_SELECTED"; feedId: string }
  | { type: "FEED_DATE_CHANGED"; date: string }
  | { type: "FEED_ENABLED_TOGGLED"; feedId: string }
  | { type: "ADD_FEED_OPENED" }
  | { type: "ADD_FEED_CLOSED" }
  | { type: "ADD_FEED_DRAFT_CHANGED" }
  | { type: "ADD_FEED_PREVIEW_SUBMITTED"; payload: CreateDailyFeedRequest }
  | { type: "ADD_FEED_CREATE_SUBMITTED"; payload: CreateDailyFeedRequest }
  | { type: "POST_CREATE_SUBMITTED"; payload: PostPayload }
  | { type: "POST_UPDATE_SUBMITTED"; postId: string; payload: PostPayload }
  | { type: "POST_DELETE_SUBMITTED"; postId: string }
  | { type: "TOAST_DISMISSED" }
  | { type: "AUTH_ERROR_CLEARED" };

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

type FeedPayloadInput = {
  groupId: string;
  payload: CreateDailyFeedRequest;
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

const appSetup = setup({
  types: {
    context: {} as AppContext,
    events: {} as AppEvent,
  },
  guards: {
    isUnauthorizedError: ({ event }) => "error" in event && isUnauthorized(event.error),
  },
  actions: {
    clearAuthenticatedData: assign(() => resetAuthenticatedContext()),
  },
  actors: {
    getSession: fromPromise<User, undefined>(({ signal }) => getSession({ signal })),
    login: fromPromise<User, LoginRequest>(({ input, signal }) => login(input, { signal })),
    signup: fromPromise<User, SignupRequest>(({ input, signal }) => signup(input, { signal })),
    logout: fromPromise<null, undefined>(({ signal }) => logout({ signal })),
    listGroups: fromPromise<Group[], undefined>(({ signal }) => listGroups({ signal })),
    createGroup: fromPromise<Group, { name: string }>(({ input, signal }) =>
      createGroup({ name: input.name }, { signal }),
    ),
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
    listGroupCatalogSources: fromPromise<CatalogSource[], { groupId: string }>(({ input, signal }) =>
      listGroupCatalogSources(input.groupId, { signal }),
    ),
    previewGroupDailyFeed: fromPromise<DailyFeedPreview, FeedPayloadInput>(({ input, signal }) =>
      previewGroupDailyFeed(input.groupId, input.payload, { signal }),
    ),
    createGroupDailyFeed: fromPromise<DailyFeed, FeedPayloadInput>(({ input, signal }) =>
      createGroupDailyFeed(input.groupId, input.payload, { signal }),
    ),
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

export const appMachine = appSetup.createMachine({
  id: "app",
  context: initialContext,
  initial: "checkingSession",
  on: {
    TOAST_DISMISSED: {
      actions: assign({
        toastMessage: null,
      }),
    },
  },
  states: {
    checkingSession: {
      invoke: {
        src: "getSession",
        input: () => undefined,
        onDone: {
          target: "signedIn.loadingGroups",
          actions: assign(({ event }) => ({
            ...resetWorkspaceContext(),
            user: event.output,
            authError: "",
          })),
        },
        onError: {
          target: "signedOut.idle",
          actions: assign(() => resetAuthenticatedContext()),
        },
      },
    },
    signedOut: {
      initial: "idle",
      on: {
        AUTH_ERROR_CLEARED: {
          actions: assign({
            authError: "",
          }),
        },
      },
      states: {
        idle: {
          on: {
            LOGIN_SUBMITTED: {
              target: "loggingIn",
            },
            SIGNUP_SUBMITTED: {
              target: "signingUp",
            },
          },
        },
        loggingIn: {
          invoke: {
            src: "login",
            input: ({ event }) => {
              if (event.type !== "LOGIN_SUBMITTED") {
                throw new Error("Login payload is missing");
              }
              return event.payload;
            },
            onDone: {
              target: "#app.signedIn.loadingGroups",
              actions: assign(({ event }) => ({
                ...resetWorkspaceContext(),
                user: event.output,
                authError: "",
                toastMessage: "Signed in",
              })),
            },
            onError: {
              target: "idle",
              actions: assign(({ event }) => ({
                authError: errorMessage(event.error),
              })),
            },
          },
        },
        signingUp: {
          invoke: {
            src: "signup",
            input: ({ event }) => {
              if (event.type !== "SIGNUP_SUBMITTED") {
                throw new Error("Signup payload is missing");
              }
              return event.payload;
            },
            onDone: {
              target: "#app.signedIn.loadingGroups",
              actions: assign(({ event }) => ({
                ...resetWorkspaceContext(),
                user: event.output,
                authError: "",
                toastMessage: "Account created",
              })),
            },
            onError: {
              target: "idle",
              actions: assign(({ event }) => ({
                authError: errorMessage(event.error),
              })),
            },
          },
        },
      },
    },
    signedIn: {
      initial: "loadingGroups",
      on: {
        LOGOUT_REQUESTED: {
          target: ".loggingOut",
        },
        GROUPS_REFRESH_REQUESTED: {
          target: ".loadingGroups",
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
        GROUP_SELECTED: {
          guard: ({ context, event }) => event.groupId !== context.selectedGroupId,
          target: ".loadingFeeds",
          actions: assign(({ event }) => ({
            ...resetDashboardContext(),
            selectedGroupId: event.groupId,
          })),
        },
        FEED_SELECTED: {
          guard: ({ context, event }) =>
            context.selectedGroupId !== null && (event.feedId !== context.selectedFeedId || context.output === null),
          target: ".loadingTodayOutput",
          actions: assign(({ event }) => ({
            selectedFeedId: event.feedId,
            selectedFeedDate: todayDateValue(),
            output: null,
            outputError: "",
            posts: [],
            postsError: "",
            postMutation: null,
            addFeedOpen: false,
            addFeedPreview: null,
            addFeedError: "",
          })),
        },
        FEED_DATE_CHANGED: {
          guard: ({ context }) => context.selectedGroupId !== null && context.selectedFeedId !== null,
          target: ".loadingDatedOutput",
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
          target: ".togglingFeed",
          actions: assign(({ event }) => ({
            pendingToggleFeedId: event.feedId,
          })),
        },
        ADD_FEED_OPENED: {
          guard: ({ context }) => context.selectedGroupId !== null,
          target: ".addFeedLoadingSources",
          actions: assign({
            addFeedOpen: true,
            addFeedSources: [],
            addFeedPreview: null,
            addFeedError: "",
            pendingAddFeedPayload: null,
          }),
        },
        ADD_FEED_CLOSED: {
          target: ".ready",
          actions: assign(() => resetAddFeedContext()),
        },
        ADD_FEED_DRAFT_CHANGED: {
          actions: assign({
            addFeedPreview: null,
            addFeedError: "",
          }),
        },
        POST_CREATE_SUBMITTED: {
          guard: ({ context, event }) =>
            context.selectedGroupId !== null &&
            context.selectedFeedId !== null &&
            context.output !== null &&
            event.payload.evidenceText.trim() !== "",
          target: ".creatingPost",
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
          target: ".updatingPost",
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
          guard: ({ context }) => context.selectedGroupId !== null,
          target: ".deletingPost",
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
                target: "loadingFeeds",
                guard: ({ context, event }) =>
                  chooseGroupId(event.output, context.preferredGroupId, context.selectedGroupId) !== null,
                actions: assign(({ context, event }) => ({
                  ...resetDashboardContext(),
                  groups: event.output,
                  selectedGroupId: chooseGroupId(event.output, context.preferredGroupId, context.selectedGroupId),
                  preferredGroupId: null,
                })),
              },
              {
                target: "ready",
                actions: assign(({ context, event }) => ({
                  ...resetDashboardContext(),
                  groups: event.output,
                  selectedGroupId: chooseGroupId(event.output, context.preferredGroupId, context.selectedGroupId),
                  preferredGroupId: null,
                })),
              },
            ],
            onError: [
              unauthorizedTransition(),
              {
                target: "ready",
                actions: assign(({ event }) => ({
                  toastMessage: errorMessage(event.error),
                })),
              },
            ],
          },
        },
        creatingGroup: {
          invoke: {
            src: "createGroup",
            input: ({ context }) => ({ name: context.pendingGroupName }),
            onDone: {
              target: "loadingGroups",
              actions: assign(({ event }) => ({
                preferredGroupId: event.output.id,
                pendingGroupName: "",
                toastMessage: "Group created",
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "ready",
                actions: assign(({ event }) => ({
                  pendingGroupName: "",
                  toastMessage: errorMessage(event.error),
                })),
              },
            ],
          },
        },
        loadingFeeds: {
          invoke: {
            src: "listGroupDailyFeeds",
            input: ({ context }) => ({ groupId: requireSelectedGroupId(context) }),
            onDone: [
              {
                target: "loadingTodayOutput",
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
                    ...resetAddFeedContext(),
                  };
                }),
              },
              {
                target: "ready",
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
                  ...resetAddFeedContext(),
                })),
              },
            ],
            onError: [
              unauthorizedTransition(),
              {
                target: "ready",
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
                })),
              },
            ],
          },
        },
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
              unauthorizedTransition(),
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
              unauthorizedTransition(),
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
              unauthorizedTransition(),
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
        togglingFeed: {
          invoke: {
            src: "toggleFeed",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
              feed: requirePendingToggleFeed(context),
            }),
            onDone: {
              target: "ready",
              actions: assign(({ context, event }) => ({
                feeds: replaceFeed(context.feeds, event.output),
                selectedFeedId: event.output.id,
                pendingToggleFeedId: null,
                toastMessage: event.output.enabled ? "Feed enabled" : "Feed disabled",
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "ready",
                actions: assign(({ event }) => ({
                  pendingToggleFeedId: null,
                  toastMessage: errorMessage(event.error),
                })),
              },
            ],
          },
        },
        addFeedLoadingSources: {
          invoke: {
            src: "listGroupCatalogSources",
            input: ({ context }) => ({ groupId: requireSelectedGroupId(context) }),
            onDone: {
              target: "addFeedEditing",
              actions: assign(({ event }) => ({
                addFeedSources: event.output,
                addFeedError: "",
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "addFeedEditing",
                actions: assign(({ event }) => ({
                  addFeedSources: [],
                  addFeedError: errorMessage(event.error),
                })),
              },
            ],
          },
        },
        addFeedEditing: {
          on: {
            ADD_FEED_PREVIEW_SUBMITTED: {
              target: "addFeedPreviewing",
              actions: assign(({ event }) => ({
                pendingAddFeedPayload: event.payload,
                addFeedPreview: null,
                addFeedError: "",
              })),
            },
            ADD_FEED_CREATE_SUBMITTED: {
              target: "addFeedCreating",
              actions: assign(({ event }) => ({
                pendingAddFeedPayload: event.payload,
                addFeedError: "",
              })),
            },
          },
        },
        addFeedPreviewing: {
          on: {
            ADD_FEED_DRAFT_CHANGED: {
              target: "addFeedEditing",
              actions: assign({
                pendingAddFeedPayload: null,
                addFeedPreview: null,
                addFeedError: "",
              }),
            },
          },
          invoke: {
            src: "previewGroupDailyFeed",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
              payload: requirePendingAddFeedPayload(context),
            }),
            onDone: {
              target: "addFeedEditing",
              actions: assign(({ event }) => ({
                addFeedPreview: event.output,
                addFeedError: "",
                pendingAddFeedPayload: null,
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "addFeedEditing",
                actions: assign(({ event }) => ({
                  addFeedPreview: null,
                  addFeedError: errorMessage(event.error),
                  pendingAddFeedPayload: null,
                })),
              },
            ],
          },
        },
        addFeedCreating: {
          invoke: {
            src: "createGroupDailyFeed",
            input: ({ context }) => ({
              groupId: requireSelectedGroupId(context),
              payload: requirePendingAddFeedPayload(context),
            }),
            onDone: {
              target: "loadingTodayOutput",
              actions: assign(({ context, event }) => ({
                feeds: [...context.feeds.filter((feed) => feed.id !== event.output.id), event.output],
                selectedFeedId: event.output.id,
                selectedFeedDate: todayDateValue(),
                output: null,
                outputError: "",
                posts: [],
                postsError: "",
                toastMessage: "Feed created",
                ...resetAddFeedContext(),
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "addFeedEditing",
                actions: assign(({ event }) => ({
                  addFeedError: errorMessage(event.error),
                  pendingAddFeedPayload: null,
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
              actions: assign(({ context, event }) => ({
                posts: upsertPost(context.posts, event.output),
                postsError: "",
                postMutation: null,
                toastMessage: "Post submitted",
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "ready",
                actions: assign(({ event }) => ({
                  postMutation: null,
                  toastMessage: errorMessage(event.error),
                })),
              },
            ],
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
              actions: assign(({ context, event }) => ({
                posts: context.posts.map((post) => (post.id === event.output.id ? event.output : post)),
                postsError: "",
                postMutation: null,
                toastMessage: "Post updated",
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "ready",
                actions: assign(({ event }) => ({
                  postMutation: null,
                  toastMessage: errorMessage(event.error),
                })),
              },
            ],
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
              actions: assign(({ context, event }) => ({
                posts: context.posts.filter((post) => post.id !== event.output.postId),
                postsError: "",
                postMutation: null,
                toastMessage: "Post deleted",
              })),
            },
            onError: [
              unauthorizedTransition(),
              {
                target: "ready",
                actions: assign(({ event }) => ({
                  postMutation: null,
                  toastMessage: errorMessage(event.error),
                })),
              },
            ],
          },
        },
        loggingOut: {
          invoke: {
            src: "logout",
            input: () => undefined,
            onDone: {
              target: "#app.signedOut.idle",
              actions: assign(() => ({
                ...resetAuthenticatedContext(),
                toastMessage: "Signed out",
              })),
            },
            onError: {
              target: "#app.signedOut.idle",
              actions: assign(() => ({
                ...resetAuthenticatedContext(),
                toastMessage: "Signed out",
              })),
            },
          },
        },
        ready: {},
      },
    },
  },
});

function unauthorizedTransition(): {
  readonly target: "#app.signedOut.idle";
  readonly guard: { readonly type: "isUnauthorizedError" };
  readonly actions: { readonly type: "clearAuthenticatedData" };
} {
  return {
    target: "#app.signedOut.idle",
    guard: { type: "isUnauthorizedError" },
    actions: { type: "clearAuthenticatedData" },
  } as const;
}

function initialContext(): AppContext {
  return {
    user: null,
    authError: "",
    ...resetWorkspaceContext(),
  };
}

function resetAuthenticatedContext(): AppContext {
  return {
    user: null,
    authError: "",
    ...resetWorkspaceContext(),
  };
}

function resetWorkspaceContext(): Omit<AppContext, "user" | "authError"> {
  return {
    groups: [],
    selectedGroupId: null,
    preferredGroupId: null,
    ...resetDashboardContext(),
    pendingGroupName: "",
    toastMessage: null,
  };
}

function resetDashboardContext(): Omit<
  AppContext,
  "user" | "authError" | "groups" | "selectedGroupId" | "preferredGroupId" | "pendingGroupName" | "toastMessage"
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
    postMutation: null,
    ...resetAddFeedContext(),
  };
}

function resetAddFeedContext(): Pick<
  AppContext,
  "addFeedOpen" | "addFeedSources" | "addFeedPreview" | "addFeedError" | "pendingAddFeedPayload"
> {
  return {
    addFeedOpen: false,
    addFeedSources: [],
    addFeedPreview: null,
    addFeedError: "",
    pendingAddFeedPayload: null,
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

function requireSelectedGroupId(context: AppContext): string {
  if (context.selectedGroupId === null) {
    throw new Error("No group selected");
  }
  return context.selectedGroupId;
}

function requireSelectedFeedId(context: AppContext): string {
  if (context.selectedFeedId === null) {
    throw new Error("No feed selected");
  }
  return context.selectedFeedId;
}

function requireOutputDate(context: AppContext): string {
  if (context.output === null) {
    throw new Error("No feed output loaded");
  }
  return context.output.date || context.selectedFeedDate;
}

function requirePendingToggleFeed(context: AppContext): DailyFeed {
  const feed = context.feeds.find((candidate) => candidate.id === context.pendingToggleFeedId);
  if (feed === undefined) {
    throw new Error("Feed not found");
  }
  return feed;
}

function requirePendingAddFeedPayload(context: AppContext): CreateDailyFeedRequest {
  if (context.pendingAddFeedPayload === null) {
    throw new Error("Feed payload is missing");
  }
  return context.pendingAddFeedPayload;
}

function requirePostMutation<TKind extends PostMutation["kind"]>(
  context: AppContext,
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

function upsertPost(posts: GroupFeedPost[], post: GroupFeedPost): GroupFeedPost[] {
  return [post, ...posts.filter((candidate) => candidate.id !== post.id)];
}
