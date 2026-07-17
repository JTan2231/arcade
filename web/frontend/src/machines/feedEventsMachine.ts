import { assign, fromPromise, sendParent, setup } from "xstate";
import type { DoneActorEvent, ErrorActorEvent, EventObject } from "xstate";

import {
  createGroupDailyFeedEvent,
  deleteGroupDailyFeedEvent,
  isUnauthorized,
  previewGroupDailyFeedEvent,
  updateGroupDailyFeedEvent,
} from "../api";
import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { errorMessage } from "../errors";
import type {
  CatalogSource,
  DailyFeed,
  DailyFeedEvent,
  DailyFeedEventPreview,
  UpsertDailyFeedEventRequest,
} from "../types";

type FeedEventsInput = {
  currentUserId: string;
  groupId: string;
  feed: DailyFeed;
};

type FeedEventEditorMode = "create" | "edit";

export type FeedEventsContext = FeedEventsInput & {
  events: DailyFeedEvent[];
  sources: CatalogSource[];
  editorMode: FeedEventEditorMode | null;
  editingEventId: string | null;
  preview: DailyFeedEventPreview | null;
  pendingPayload: UpsertDailyFeedEventRequest | null;
  pendingDeleteEventId: string | null;
  error: string;
  errorKind: "load" | "preview" | "save" | "delete" | null;
};

type FeedEventsEvent =
  | { type: "CREATE_OPENED" }
  | { type: "EDIT_OPENED"; eventId: string }
  | { type: "EDITOR_CLOSED" }
  | { type: "DRAFT_CHANGED" }
  | { type: "PREVIEW_SUBMITTED"; payload: UpsertDailyFeedEventRequest }
  | { type: "SAVE_SUBMITTED"; payload: UpsertDailyFeedEventRequest }
  | { type: "DELETE_SUBMITTED"; eventId: string }
  | { type: "CLOSED" };

export type FeedEventsOutputEvent =
  | { type: "FEED_EVENTS_CLOSED" }
  | { type: "FEED_EVENT_SAVED"; operation: "created" | "updated" }
  | { type: "FEED_EVENT_DELETED" }
  | { type: "UNAUTHORIZED" };

type FeedEventsLoadOutput = {
  events: DailyFeedEvent[];
  sources: CatalogSource[];
};

type PayloadInput = {
  currentUserId: string;
  groupId: string;
  feedId: string;
  eventId: string | null;
  eventStatus: DailyFeedEvent["status"] | null;
  payload: UpsertDailyFeedEventRequest;
};

type SaveOutput = {
  event: DailyFeedEvent;
  operation: "created" | "updated";
};

type DeleteInput = {
  currentUserId: string;
  groupId: string;
  feedId: string;
  eventId: string;
};

const feedEventsSetup = setup({
  types: {
    context: {} as FeedEventsContext,
    events: {} as FeedEventsEvent,
    input: {} as FeedEventsInput,
  },
  guards: {
    isUnauthorizedError: ({ event }) => "error" in event && isUnauthorized(event.error),
  },
  actors: {
    loadFeedEvents: fromPromise<FeedEventsLoadOutput, FeedEventsInput>(async ({ input, signal }) => {
      const [events, sources] = await Promise.all([
        queryCache.read(queries.feedEvents, input.currentUserId, input.groupId, input.feed.id, { signal }),
        queryCache.read(queries.groupCatalogSources, input.currentUserId, input.groupId, { signal }),
      ]);
      return {
        events,
        sources,
      };
    }),
    previewFeedEvent: fromPromise<DailyFeedEventPreview, PayloadInput>(({ input, signal }) =>
      previewGroupDailyFeedEvent(input.groupId, input.feedId, input.payload, { signal }),
    ),
    saveFeedEvent: fromPromise<SaveOutput, PayloadInput>(async ({ input, signal }) => {
      const event =
        input.eventId === null
          ? await createGroupDailyFeedEvent(input.groupId, input.feedId, input.payload, { signal })
          : await updateGroupDailyFeedEvent(
              input.groupId,
              input.feedId,
              input.eventId,
              input.eventStatus === "active"
                ? { ends_on: input.payload.ends_on }
                : { ...input.payload, description: input.payload.description ?? null },
              { signal },
            );
      invalidateFeedEventCaches(input.currentUserId, input.groupId, input.feedId);
      return { event, operation: input.eventId === null ? "created" : "updated" };
    }),
    deleteFeedEvent: fromPromise<{ eventId: string }, DeleteInput>(async ({ input, signal }) => {
      await deleteGroupDailyFeedEvent(input.groupId, input.feedId, input.eventId, { signal });
      invalidateFeedEventCaches(input.currentUserId, input.groupId, input.feedId);
      return { eventId: input.eventId };
    }),
  },
});

export const feedEventsMachine = feedEventsSetup.createMachine({
  id: "feedEvents",
  context: ({ input }) => ({
    ...input,
    events: [],
    sources: [],
    editorMode: null,
    editingEventId: null,
    preview: null,
    pendingPayload: null,
    pendingDeleteEventId: null,
    error: "",
    errorKind: null,
  }),
  initial: "loading",
  on: {
    CLOSED: {
      actions: sendCloseToParent(),
    },
  },
  states: {
    loading: {
      invoke: {
        src: "loadFeedEvents",
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: context.groupId,
          feed: context.feed,
        }),
        onDone: {
          target: "ready",
          actions: assign(({ event }) => ({
            events: event.output.events,
            sources: event.output.sources,
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
            target: "ready",
            actions: assign(({ event }) => ({
              error: errorMessage(event.error),
              errorKind: "load" as const,
            })),
          },
        ],
      },
    },
    ready: {
      on: {
        CREATE_OPENED: {
          actions: assign({
            editorMode: "create",
            editingEventId: null,
            preview: null,
            error: "",
            errorKind: null,
          }),
        },
        EDIT_OPENED: {
          guard: ({ context, event }) => context.events.some((candidate) => candidate.id === event.eventId),
          actions: assign(({ event }) => ({
            editorMode: "edit",
            editingEventId: event.eventId,
            preview: null,
            error: "",
            errorKind: null,
          })),
        },
        EDITOR_CLOSED: {
          actions: assign({
            editorMode: null,
            editingEventId: null,
            preview: null,
            error: "",
            errorKind: null,
          }),
        },
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
        SAVE_SUBMITTED: {
          target: "saving",
          actions: assign(({ event }) => ({
            pendingPayload: event.payload,
            error: "",
            errorKind: null,
          })),
        },
        DELETE_SUBMITTED: {
          guard: ({ context, event }) => context.events.some((candidate) => candidate.id === event.eventId),
          target: "deleting",
          actions: assign(({ event }) => ({
            pendingDeleteEventId: event.eventId,
            error: "",
            errorKind: null,
          })),
        },
      },
    },
    previewing: {
      on: {
        DRAFT_CHANGED: {
          target: "ready",
          actions: assign({
            pendingPayload: null,
            preview: null,
            error: "",
            errorKind: null,
          }),
        },
      },
      invoke: {
        src: "previewFeedEvent",
        input: ({ context }) => payloadInput(context),
        onDone: {
          target: "ready",
          actions: assign(({ event }) => ({
            preview: event.output,
            pendingPayload: null,
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
            target: "ready",
            actions: assign(({ event }) => ({
              preview: null,
              pendingPayload: null,
              error: errorMessage(event.error),
              errorKind: "preview" as const,
            })),
          },
        ],
      },
    },
    saving: {
      invoke: {
        src: "saveFeedEvent",
        input: ({ context }) => payloadInput(context),
        onDone: {
          target: "ready",
          actions: [
            assign(({ context, event }) => ({
              events: upsertEvent(context.events, event.output.event),
              editorMode: null,
              editingEventId: null,
              preview: null,
              pendingPayload: null,
              error: "",
              errorKind: null,
            })),
            sendSavedToParent(),
          ],
        },
        onError: [
          {
            guard: { type: "isUnauthorizedError" },
            actions: sendUnauthorizedToParent(),
          },
          {
            target: "ready",
            actions: assign(({ event }) => ({
              pendingPayload: null,
              error: errorMessage(event.error),
              errorKind: "save" as const,
            })),
          },
        ],
      },
    },
    deleting: {
      invoke: {
        src: "deleteFeedEvent",
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: context.groupId,
          feedId: context.feed.id,
          eventId: requireDeleteEventId(context),
        }),
        onDone: {
          target: "ready",
          actions: [
            assign(({ context, event }) => ({
              events: context.events.filter((candidate) => candidate.id !== event.output.eventId),
              pendingDeleteEventId: null,
              error: "",
              errorKind: null,
            })),
            sendDeletedToParent(),
          ],
        },
        onError: [
          {
            guard: { type: "isUnauthorizedError" },
            actions: sendUnauthorizedToParent(),
          },
          {
            target: "ready",
            actions: assign(({ event }) => ({
              pendingDeleteEventId: null,
              error: errorMessage(event.error),
              errorKind: "delete" as const,
            })),
          },
        ],
      },
    },
  },
});

function payloadInput(context: FeedEventsContext): PayloadInput {
  if (context.pendingPayload === null) {
    throw new Error("Feed event payload is missing");
  }
  return {
    currentUserId: context.currentUserId,
    groupId: context.groupId,
    feedId: context.feed.id,
    eventId: context.editingEventId,
    eventStatus:
      context.editingEventId === null
        ? null
        : (context.events.find((event) => event.id === context.editingEventId)?.status ?? null),
    payload: context.pendingPayload,
  };
}

function requireDeleteEventId(context: FeedEventsContext): string {
  if (context.pendingDeleteEventId === null) {
    throw new Error("Feed event id is missing");
  }
  return context.pendingDeleteEventId;
}

function upsertEvent(events: DailyFeedEvent[], event: DailyFeedEvent): DailyFeedEvent[] {
  return [...events.filter((candidate) => candidate.id !== event.id), event];
}

function invalidateFeedEventCaches(currentUserId: string, groupId: string, feedId: string) {
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "events"]);
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "today"]);
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "output"]);
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "outputs"]);
  queryCache.touched(["anon", "public", "feed", feedId]);
}

function sendCloseToParent() {
  return sendParent<FeedEventsContext, EventObject, undefined, FeedEventsOutputEvent, FeedEventsEvent>({
    type: "FEED_EVENTS_CLOSED",
  });
}

function sendUnauthorizedToParent() {
  return sendParent<FeedEventsContext, ErrorActorEvent, undefined, FeedEventsOutputEvent, FeedEventsEvent>({
    type: "UNAUTHORIZED",
  });
}

function sendSavedToParent() {
  return sendParent<FeedEventsContext, DoneActorEvent<SaveOutput>, undefined, FeedEventsOutputEvent, FeedEventsEvent>(
    ({ event }) => ({ type: "FEED_EVENT_SAVED", operation: event.output.operation }),
  );
}

function sendDeletedToParent() {
  return sendParent<
    FeedEventsContext,
    DoneActorEvent<{ eventId: string }>,
    undefined,
    FeedEventsOutputEvent,
    FeedEventsEvent
  >({ type: "FEED_EVENT_DELETED" });
}
