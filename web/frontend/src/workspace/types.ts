import type { ActorRefFromLogic } from "xstate";

import type { addFeedMachine } from "../machines/addFeedMachine";
import type { dashboardMachine } from "../machines/dashboardMachine";
import type { feedEventsMachine } from "../machines/feedEventsMachine";

export type DashboardActorRef = ActorRefFromLogic<typeof dashboardMachine>;
export type AddFeedActorRef = ActorRefFromLogic<typeof addFeedMachine>;
export type FeedEventsActorRef = ActorRefFromLogic<typeof feedEventsMachine>;

export type Navigate = (path: string, mode?: "push" | "replace") => void;
export type ToastCallback = (message: string) => void;
