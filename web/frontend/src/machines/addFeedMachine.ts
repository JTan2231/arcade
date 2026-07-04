import { assign, fromPromise, sendParent, setup } from "xstate";
import type { DoneActorEvent, ErrorActorEvent, EventObject } from "xstate";

import {
  createGroupDailyFeed,
  isUnauthorized,
  listGroupCatalogSources,
  listGroupEvidenceFormats,
  previewGroupDailyFeed,
} from "../api";
import { errorMessage } from "../errors";
import type { CatalogSource, CreateDailyFeedRequest, DailyFeed, DailyFeedPreview, EvidenceFormat } from "../types";

type AddFeedInput = {
  groupId: string;
};

export type AddFeedContext = {
  groupId: string;
  sources: CatalogSource[];
  evidenceFormats: EvidenceFormat[];
  preview: DailyFeedPreview | null;
  error: string;
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
    loadAddFeedData: fromPromise<AddFeedLoadOutput, { groupId: string }>(async ({ input, signal }) => {
      const [sources, evidenceFormats] = await Promise.all([
        listGroupCatalogSources(input.groupId, { signal }),
        listGroupEvidenceFormats(input.groupId, {}, { signal }),
      ]);
      return { sources, evidenceFormats };
    }),
    previewGroupDailyFeed: fromPromise<DailyFeedPreview, FeedPayloadInput>(({ input, signal }) =>
      previewGroupDailyFeed(input.groupId, input.payload, { signal }),
    ),
    createGroupDailyFeed: fromPromise<DailyFeed, FeedPayloadInput>(({ input, signal }) =>
      createGroupDailyFeed(input.groupId, input.payload, { signal }),
    ),
  },
});

export const addFeedMachine = addFeedSetup.createMachine({
  id: "addFeed",
  context: ({ input }) => ({
    groupId: input.groupId,
    sources: [],
    evidenceFormats: [],
    preview: null,
    error: "",
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
        input: ({ context }) => ({ groupId: context.groupId }),
        onDone: {
          target: "editing",
          actions: assign(({ event }) => ({
            sources: event.output.sources,
            evidenceFormats: event.output.evidenceFormats,
            error: "",
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
            })),
          },
        ],
      },
    },
    editing: {
      on: {
        DRAFT_CHANGED: {
          actions: assign({
            preview: null,
            error: "",
          }),
        },
        PREVIEW_SUBMITTED: {
          target: "previewing",
          actions: assign(({ event }) => ({
            pendingPayload: event.payload,
            preview: null,
            error: "",
          })),
        },
        CREATE_SUBMITTED: {
          target: "creating",
          actions: assign(({ event }) => ({
            pendingPayload: event.payload,
            error: "",
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
          }),
        },
      },
      invoke: {
        src: "previewGroupDailyFeed",
        input: ({ context }) => ({
          groupId: context.groupId,
          payload: requirePendingPayload(context),
        }),
        onDone: {
          target: "editing",
          actions: assign(({ event }) => ({
            preview: event.output,
            error: "",
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
          }),
        },
      },
      invoke: {
        src: "createGroupDailyFeed",
        input: ({ context }) => ({
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
