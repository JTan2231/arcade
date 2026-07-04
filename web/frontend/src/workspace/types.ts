import type { ActorRefFromLogic } from "xstate";

import type { addFeedMachine } from "../machines/addFeedMachine";
import type { dashboardMachine } from "../machines/dashboardMachine";

export type DashboardActorRef = ActorRefFromLogic<typeof dashboardMachine>;
export type AddFeedActorRef = ActorRefFromLogic<typeof addFeedMachine>;

export type Navigate = (path: string, mode?: "push" | "replace") => void;
export type ToastCallback = (message: string) => void;
