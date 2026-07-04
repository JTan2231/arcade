import { isUnauthorized } from "../../api";
import type { DashboardContext, DashboardEvent } from "./events";

type DashboardGuardArgs = {
  context: DashboardContext;
};

export const dashboardGuards = {
  isUnauthorizedError: ({ event }: { event: DashboardEvent }) =>
    "error" in event && isUnauthorized((event as { error: unknown }).error),
  hasSelectedGroup: ({ context }: DashboardGuardArgs) => context.selectedGroupId !== null,
  hasSelectedFeed: ({ context }: DashboardGuardArgs) =>
    context.selectedGroupId !== null && context.selectedFeedId !== null,
  hasLoadedOutput: ({ context }: DashboardGuardArgs) =>
    context.selectedGroupId !== null && context.selectedFeedId !== null && context.output !== null,
  hasSelectedMetric: ({ context }: DashboardGuardArgs) =>
    context.selectedGroupId !== null && context.selectedFeedId !== null && context.selectedMetricId !== null,
  hasRestorableFeed: ({ context }: DashboardGuardArgs) =>
    context.selectedGroupId !== null && context.selectedFeedId !== null,
  hasRestorableGroup: ({ context }: DashboardGuardArgs) => context.selectedGroupId !== null,
};
