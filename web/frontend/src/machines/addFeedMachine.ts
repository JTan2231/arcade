import { assign, fromPromise, sendParent, setup } from "xstate";
import type { DoneActorEvent, ErrorActorEvent, EventObject } from "xstate";

import { createGroupDailyFeed, isUnauthorized, previewGroupDailyFeed } from "../api";
import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { errorMessage } from "../errors";
import type { CatalogSource, CreateDailyFeedRequest, DailyFeed, DailyFeedPreview, EvidenceFormat } from "../types";

type AddFeedInput = {
  currentUserId: string;
  groupId: string;
};

export type AddFeedContext = {
  currentUserId: string;
  groupId: string;
  sources: CatalogSource[];
  evidenceFormats: EvidenceFormat[];
  preview: DailyFeedPreview | null;
  error: string;
  errorKind: "load" | "preview" | "create" | null;
  pendingPayload: CreateDailyFeedRequest | null;
};

type AddFeedEvent =
  | { type: "DRAFT_CHANGED" }
  | { type: "PREVIEW_SUBMITTED"; payload: CreateDailyFeedRequest }
  | { type: "CREATE_SUBMITTED"; payload: CreateDailyFeedRequest }
  | { type: "CLOSED" };

export type AddFeedOutputEvent =
  | { type: "ADD_FEED_CLOSED" }
  | { type: "FEED_CREATED"; feed: DailyFeed }
  | { type: "UNAUTHORIZED" };

type FeedPayloadInput = {
  currentUserId: string;
  groupId: string;
  payload: CreateDailyFeedRequest;
};

type AddFeedLoadOutput = {
  sources: CatalogSource[];
  evidenceFormats: EvidenceFormat[];
};

const addFeedSetup = setup({
  types: {
    context: {} as AddFeedContext,
    events: {} as AddFeedEvent,
    input: {} as AddFeedInput,
  },
  guards: {
    isUnauthorizedError: ({ event }) => "error" in event && isUnauthorized(event.error),
  },
  actors: {
    loadAddFeedData: fromPromise<AddFeedLoadOutput, { currentUserId: string; groupId: string }>(
      async ({ input, signal }) => {
        const [sources, evidenceFormats] = await Promise.all([
          queryCache.read(queries.groupCatalogSources, input.currentUserId, input.groupId, { signal }),
          queryCache.read(queries.groupEvidenceFormats, input.currentUserId, input.groupId, "active", { signal }),
        ]);
        return { sources, evidenceFormats };
      },
    ),
    previewGroupDailyFeed: fromPromise<DailyFeedPreview, FeedPayloadInput>(({ input, signal }) =>
      previewGroupDailyFeed(input.groupId, input.payload, { signal }),
    ),
    createGroupDailyFeed: fromPromise<DailyFeed, FeedPayloadInput>(async ({ input, signal }) => {
      const feed = await createGroupDailyFeed(input.groupId, input.payload, { signal });
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feeds"]);
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "evidence-formats"]);
      queryCache.touched(["user", input.currentUserId, "me", "daily-feeds"]);
      return feed;
    }),
  },
});

export const addFeedMachine = addFeedSetup.createMachine({
  id: "addFeed",
  context: ({ input }) => ({
    currentUserId: input.currentUserId,
    groupId: input.groupId,
    sources: [],
    evidenceFormats: [],
    preview: null,
    error: "",
    errorKind: null,
    pendingPayload: null,
  }),
  initial: "loadingSources",
  on: {
    CLOSED: {
      actions: sendCloseToParent(),
    },
  },
  states: {
    loadingSources: {
      invoke: {
        src: "loadAddFeedData",
        input: ({ context }) => ({ currentUserId: context.currentUserId, groupId: context.groupId }),
        onDone: {
          target: "editing",
          actions: assign(({ event }) => ({
            sources: event.output.sources,
            evidenceFormats: event.output.evidenceFormats,
            error: "",
            errorKind: null,
          })),
        },
        onError: [
          {
            guard: { type: "isUnauthorizedError" },
            actions: sendUnauthorizedToParent(),
          },
          {
            target: "editing",
            actions: assign(({ event }) => ({
              sources: [],
              evidenceFormats: [],
              error: errorMessage(event.error),
              errorKind: "load",
            })),
          },
        ],
      },
    },
    editing: {
      on: {
        DRAFT_CHANGED: {
          actions: assign(({ context }) => ({
            preview: null,
            ...(context.errorKind === "load" ? {} : { error: "", errorKind: null }),
          })),
        },
        PREVIEW_SUBMITTED: {
          target: "previewing",
          actions: assign(({ event }) => ({
            pendingPayload: event.payload,
            preview: null,
            error: "",
            errorKind: null,
          })),
        },
        CREATE_SUBMITTED: {
          target: "creating",
          actions: assign(({ event }) => ({
            pendingPayload: event.payload,
            error: "",
            errorKind: null,
          })),
        },
      },
    },
    previewing: {
      on: {
        DRAFT_CHANGED: {
          target: "editing",
          actions: assign({
            pendingPayload: null,
            preview: null,
            error: "",
            errorKind: null,
          }),
        },
      },
      invoke: {
        src: "previewGroupDailyFeed",
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: context.groupId,
          payload: requirePendingPayload(context),
        }),
        onDone: {
          target: "editing",
          actions: assign(({ event }) => ({
            preview: event.output,
            error: "",
            errorKind: null,
            pendingPayload: null,
          })),
        },
        onError: [
          {
            guard: { type: "isUnauthorizedError" },
            actions: sendUnauthorizedToParent(),
          },
          {
            target: "editing",
            actions: assign(({ event }) => ({
              preview: null,
              error: errorMessage(event.error),
              errorKind: "preview",
              pendingPayload: null,
            })),
          },
        ],
      },
    },
    creating: {
      on: {
        DRAFT_CHANGED: {
          actions: assign({
            preview: null,
            error: "",
            errorKind: null,
          }),
        },
      },
      invoke: {
        src: "createGroupDailyFeed",
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: context.groupId,
          payload: requirePendingPayload(context),
        }),
        onDone: {
          target: "editing",
          actions: sendFeedCreatedToParent(),
        },
        onError: [
          {
            guard: { type: "isUnauthorizedError" },
            actions: sendUnauthorizedToParent(),
          },
          {
            target: "editing",
            actions: assign(({ event }) => ({
              error: errorMessage(event.error),
              errorKind: "create",
              pendingPayload: null,
            })),
          },
        ],
      },
    },
  },
});

function requirePendingPayload(context: AddFeedContext): CreateDailyFeedRequest {
  if (context.pendingPayload === null) {
    throw new Error("Feed payload is missing");
  }
  return context.pendingPayload;
}

function sendCloseToParent() {
  return sendParent<AddFeedContext, EventObject, undefined, AddFeedOutputEvent, AddFeedEvent>({
    type: "ADD_FEED_CLOSED",
  });
}

function sendUnauthorizedToParent() {
  return sendParent<AddFeedContext, ErrorActorEvent, undefined, AddFeedOutputEvent, AddFeedEvent>({
    type: "UNAUTHORIZED",
  });
}

function sendFeedCreatedToParent() {
  return sendParent<AddFeedContext, DoneActorEvent<DailyFeed>, undefined, AddFeedOutputEvent, AddFeedEvent>(
    ({ event }) => ({ type: "FEED_CREATED", feed: event.output }),
  );
}
