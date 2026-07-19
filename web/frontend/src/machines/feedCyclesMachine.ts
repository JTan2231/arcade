import { assign, fromPromise, sendParent, setup } from "xstate";
import type { DoneActorEvent, ErrorActorEvent, EventObject } from "xstate";

import {
  deleteGroupDailyFeedCycleSettings,
  isUnauthorized,
  previewGroupDailyFeedCycleSettings,
  refreshGroupDailyFeedCycle,
  replaceGroupDailyFeedCycleSettings,
} from "../api";
import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { errorMessage } from "../errors";
import type {
  CatalogSource,
  CyclePreview,
  CycleSettings,
  DailyFeed,
  DailyFeedCycle,
  DailyFeedCycleSettingsSummary,
  UpsertCycleSettingsRequest,
} from "../types";

type FeedCyclesInput = {
  currentUserId: string;
  groupId: string;
  feed: DailyFeed;
};

export type FeedCyclesContext = FeedCyclesInput & {
  settings: CycleSettings | null;
  cycles: DailyFeedCycle[];
  sources: CatalogSource[];
  editorOpen: boolean;
  preview: CyclePreview | null;
  pendingPayload: UpsertCycleSettingsRequest | null;
  pendingCycleId: string | null;
  error: string;
  errorKind: "load" | "preview" | "save" | "delete" | "refresh" | null;
};

type FeedCyclesEvent =
  | { type: "EDITOR_OPENED" }
  | { type: "EDITOR_CLOSED" }
  | { type: "DRAFT_CHANGED" }
  | { type: "PREVIEW_SUBMITTED"; payload: UpsertCycleSettingsRequest }
  | { type: "SAVE_SUBMITTED"; payload: UpsertCycleSettingsRequest }
  | { type: "DELETE_SUBMITTED" }
  | { type: "REFRESH_SUBMITTED"; cycleId: string }
  | { type: "CLOSED" };

export type FeedCyclesOutputEvent =
  | { type: "FEED_CYCLES_CLOSED" }
  | { type: "CYCLE_SETTINGS_SAVED"; settings: CycleSettings }
  | {
      type: "CYCLE_SETTINGS_DELETED";
      settings: CycleSettings | null;
      cycleSettings: DailyFeedCycleSettingsSummary | null;
    }
  | { type: "CYCLE_REFRESHED"; cycle: DailyFeedCycle }
  | { type: "UNAUTHORIZED" };

type FeedCyclesLoadOutput = {
  settings: CycleSettings | null;
  cycles: DailyFeedCycle[];
  sources: CatalogSource[];
};

type PayloadInput = {
  currentUserId: string;
  groupId: string;
  feedId: string;
  payload: UpsertCycleSettingsRequest;
};

type CycleInput = {
  currentUserId: string;
  groupId: string;
  feedId: string;
  cycleId: string;
};

type DeleteCycleSettingsInput = Omit<PayloadInput, "payload">;

type DeleteCycleSettingsOutput = {
  settings: CycleSettings | null;
  cycleSettings: DailyFeedCycleSettingsSummary | null;
  cycles: DailyFeedCycle[];
};

const feedCyclesSetup = setup({
  types: {
    context: {} as FeedCyclesContext,
    events: {} as FeedCyclesEvent,
    input: {} as FeedCyclesInput,
  },
  guards: {
    isUnauthorizedError: ({ event }) => "error" in event && isUnauthorized(event.error),
  },
  actors: {
    loadFeedCycles: fromPromise<FeedCyclesLoadOutput, FeedCyclesInput>(async ({ input, signal }) => {
      const [settings, cycles, sources] = await Promise.all([
        queryCache.read(queries.cycleSettings, input.currentUserId, input.groupId, input.feed.id, { signal }),
        queryCache.read(queries.feedCycles, input.currentUserId, input.groupId, input.feed.id, { signal }),
        queryCache.read(queries.groupCatalogSources, input.currentUserId, input.groupId, { signal }),
      ]);
      return { settings, cycles, sources };
    }),
    previewCycleSettings: fromPromise<CyclePreview, PayloadInput>(({ input, signal }) =>
      previewGroupDailyFeedCycleSettings(input.groupId, input.feedId, input.payload, { signal }),
    ),
    saveCycleSettings: fromPromise<CycleSettings, PayloadInput>(async ({ input, signal }) => {
      const settings = await replaceGroupDailyFeedCycleSettings(input.groupId, input.feedId, input.payload, { signal });
      invalidateCycleCaches(input.currentUserId, input.groupId, input.feedId);
      queryCache.write(queries.cycleSettings, settings, input.currentUserId, input.groupId, input.feedId);
      return settings;
    }),
    deleteCycleSettings: fromPromise<DeleteCycleSettingsOutput, DeleteCycleSettingsInput>(async ({ input, signal }) => {
      await deleteGroupDailyFeedCycleSettings(input.groupId, input.feedId, { signal });
      invalidateCycleCaches(input.currentUserId, input.groupId, input.feedId);
      const [settings, feeds, cycles] = await Promise.all([
        queryCache.read(queries.cycleSettings, input.currentUserId, input.groupId, input.feedId, { signal }),
        queryCache.read(queries.groupFeeds, input.currentUserId, input.groupId, { signal }),
        queryCache.read(queries.feedCycles, input.currentUserId, input.groupId, input.feedId, { signal }),
      ]);
      const cycleSettings = feeds.find((feed) => feed.id === input.feedId)?.cycle_settings ?? null;
      return { settings, cycleSettings, cycles };
    }),
    refreshCycle: fromPromise<DailyFeedCycle, CycleInput>(async ({ input, signal }) => {
      const cycle = await refreshGroupDailyFeedCycle(input.groupId, input.feedId, input.cycleId, { signal });
      invalidateCycleOutputCaches(input.currentUserId, input.groupId, input.feedId);
      queryCache.touched(["user", input.currentUserId, "group", input.groupId, "feed", input.feedId, "cycles"]);
      return cycle;
    }),
  },
});

export const feedCyclesMachine = feedCyclesSetup.createMachine({
  id: "feedCycles",
  context: ({ input }) => ({
    ...input,
    settings: null,
    cycles: [],
    sources: [],
    editorOpen: false,
    preview: null,
    pendingPayload: null,
    pendingCycleId: null,
    error: "",
    errorKind: null,
  }),
  initial: "loading",
  on: {
    CLOSED: { actions: sendCloseToParent() },
  },
  states: {
    loading: {
      invoke: {
        src: "loadFeedCycles",
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: context.groupId,
          feed: context.feed,
        }),
        onDone: {
          target: "ready",
          actions: assign(({ event }) => ({
            settings: event.output.settings,
            cycles: event.output.cycles,
            sources: event.output.sources,
            editorOpen: false,
            error: "",
            errorKind: null,
          })),
        },
        onError: [
          { guard: { type: "isUnauthorizedError" }, actions: sendUnauthorizedToParent() },
          {
            target: "ready",
            actions: assign(({ event }) => ({ error: errorMessage(event.error), errorKind: "load" as const })),
          },
        ],
      },
    },
    ready: {
      on: {
        EDITOR_OPENED: {
          actions: assign({ editorOpen: true, preview: null, error: "", errorKind: null }),
        },
        EDITOR_CLOSED: {
          actions: assign({
            editorOpen: false,
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
          actions: assign(({ event }) => ({ pendingPayload: event.payload, error: "", errorKind: null })),
        },
        DELETE_SUBMITTED: {
          guard: ({ context }) => context.settings !== null,
          target: "deleting",
          actions: assign({ error: "", errorKind: null }),
        },
        REFRESH_SUBMITTED: {
          guard: ({ context, event }) => context.cycles.some((cycle) => cycle.id === event.cycleId),
          target: "refreshing",
          actions: assign(({ event }) => ({ pendingCycleId: event.cycleId, error: "", errorKind: null })),
        },
      },
    },
    previewing: {
      on: {
        DRAFT_CHANGED: {
          target: "ready",
          actions: assign({ pendingPayload: null, preview: null, error: "", errorKind: null }),
        },
        EDITOR_CLOSED: {
          target: "ready",
          actions: assign({
            editorOpen: false,
            pendingPayload: null,
            preview: null,
            error: "",
            errorKind: null,
          }),
        },
      },
      invoke: {
        src: "previewCycleSettings",
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
          { guard: { type: "isUnauthorizedError" }, actions: sendUnauthorizedToParent() },
          {
            target: "ready",
            actions: assign(({ event }) => ({
              pendingPayload: null,
              pendingCycleId: null,
              error: errorMessage(event.error),
              errorKind: "preview" as const,
            })),
          },
        ],
      },
    },
    saving: {
      invoke: {
        src: "saveCycleSettings",
        input: ({ context }) => payloadInput(context),
        onDone: {
          target: "ready",
          actions: [
            assign(({ event }) => ({
              settings: event.output,
              editorOpen: false,
              preview: null,
              pendingPayload: null,
              error: "",
              errorKind: null,
            })),
            sendSavedToParent(),
          ],
        },
        onError: [
          { guard: { type: "isUnauthorizedError" }, actions: sendUnauthorizedToParent() },
          {
            target: "ready",
            actions: assign(({ event }) => ({
              pendingPayload: null,
              pendingCycleId: null,
              error: errorMessage(event.error),
              errorKind: "save" as const,
            })),
          },
        ],
      },
    },
    deleting: {
      invoke: {
        src: "deleteCycleSettings",
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: context.groupId,
          feedId: context.feed.id,
        }),
        onDone: {
          target: "ready",
          actions: [
            assign(({ context, event }) => ({
              settings: event.output.settings,
              feed: setFeedCycleSettingsSummary(context.feed, event.output.cycleSettings),
              cycles: event.output.cycles,
              editorOpen: false,
              preview: null,
              error: "",
              errorKind: null,
            })),
            sendDeletedToParent(),
          ],
        },
        onError: [
          { guard: { type: "isUnauthorizedError" }, actions: sendUnauthorizedToParent() },
          {
            target: "ready",
            actions: assign(({ event }) => ({
              pendingPayload: null,
              pendingCycleId: null,
              error: errorMessage(event.error),
              errorKind: "delete" as const,
            })),
          },
        ],
      },
    },
    refreshing: {
      invoke: {
        src: "refreshCycle",
        input: ({ context }) => ({
          currentUserId: context.currentUserId,
          groupId: context.groupId,
          feedId: context.feed.id,
          cycleId: requirePendingCycleId(context),
        }),
        onDone: {
          target: "ready",
          actions: [
            assign(({ context, event }) => ({
              cycles: upsertCycle(context.cycles, event.output),
              pendingCycleId: null,
              error: "",
              errorKind: null,
            })),
            sendRefreshedToParent(),
          ],
        },
        onError: [
          { guard: { type: "isUnauthorizedError" }, actions: sendUnauthorizedToParent() },
          {
            target: "ready",
            actions: assign(({ event }) => ({
              pendingPayload: null,
              pendingCycleId: null,
              error: errorMessage(event.error),
              errorKind: "refresh" as const,
            })),
          },
        ],
      },
    },
  },
});

function payloadInput(context: FeedCyclesContext): PayloadInput {
  if (context.pendingPayload === null) {
    throw new Error("Cycle settings payload is missing");
  }
  return {
    currentUserId: context.currentUserId,
    groupId: context.groupId,
    feedId: context.feed.id,
    payload: context.pendingPayload,
  };
}

function requirePendingCycleId(context: FeedCyclesContext): string {
  if (context.pendingCycleId === null) {
    throw new Error("Cycle refresh is missing");
  }
  return context.pendingCycleId;
}

function upsertCycle(cycles: DailyFeedCycle[], cycle: DailyFeedCycle): DailyFeedCycle[] {
  return [...cycles.filter((candidate) => candidate.id !== cycle.id), cycle].sort((left, right) =>
    right.starts_on.localeCompare(left.starts_on),
  );
}

function invalidateCycleCaches(currentUserId: string, groupId: string, feedId: string) {
  queryCache.touched(["user", currentUserId, "group", groupId, "feeds"]);
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "cycle-settings"]);
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "cycles"]);
  queryCache.touched(["user", currentUserId, "me", "daily-feeds"]);
  invalidateCycleOutputCaches(currentUserId, groupId, feedId);
}

function invalidateCycleOutputCaches(currentUserId: string, groupId: string, feedId: string) {
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "today"]);
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "output"]);
  queryCache.touched(["user", currentUserId, "group", groupId, "feed", feedId, "outputs"]);
  queryCache.touched(["anon", "public", "feed", feedId]);
}

function setFeedCycleSettingsSummary(feed: DailyFeed, cycleSettings: DailyFeedCycleSettingsSummary | null): DailyFeed {
  if (cycleSettings === null) {
    const withoutCycleSettings = { ...feed };
    delete withoutCycleSettings.cycle_settings;
    return withoutCycleSettings;
  }
  return { ...feed, cycle_settings: cycleSettings };
}

function sendCloseToParent() {
  return sendParent<FeedCyclesContext, EventObject, undefined, FeedCyclesOutputEvent, FeedCyclesEvent>({
    type: "FEED_CYCLES_CLOSED",
  });
}

function sendUnauthorizedToParent() {
  return sendParent<FeedCyclesContext, ErrorActorEvent, undefined, FeedCyclesOutputEvent, FeedCyclesEvent>({
    type: "UNAUTHORIZED",
  });
}

function sendSavedToParent() {
  return sendParent<
    FeedCyclesContext,
    DoneActorEvent<CycleSettings>,
    undefined,
    FeedCyclesOutputEvent,
    FeedCyclesEvent
  >(({ event }) => ({ type: "CYCLE_SETTINGS_SAVED", settings: event.output }));
}

function sendDeletedToParent() {
  return sendParent<
    FeedCyclesContext,
    DoneActorEvent<DeleteCycleSettingsOutput>,
    undefined,
    FeedCyclesOutputEvent,
    FeedCyclesEvent
  >(({ event }) => ({
    type: "CYCLE_SETTINGS_DELETED",
    settings: event.output.settings,
    cycleSettings: event.output.cycleSettings,
  }));
}

function sendRefreshedToParent() {
  return sendParent<
    FeedCyclesContext,
    DoneActorEvent<DailyFeedCycle>,
    undefined,
    FeedCyclesOutputEvent,
    FeedCyclesEvent
  >(({ event }) => ({ type: "CYCLE_REFRESHED", cycle: event.output }));
}
