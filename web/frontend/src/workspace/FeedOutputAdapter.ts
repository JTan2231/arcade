import type { GroupDashboardProps } from "../components/GroupDashboard";
import { matchesGrandchildState } from "../machines/stateMatches";
import type { DashboardContext } from "../machines/dashboardMachine";
import { feedPath } from "../routes";
import type { DashboardActorRef, Navigate } from "./types";

type FeedOutputProps = Pick<GroupDashboardProps, "output" | "outputLoading" | "outputError" | "onChangeFeedDate">;

export function useFeedOutputAdapter({
  dashboardRef,
  dashboardContext,
  dashboardStateValue,
  selectedFeedId,
  onNavigate,
}: {
  dashboardRef: DashboardActorRef | undefined;
  dashboardContext: DashboardContext | null;
  dashboardStateValue: unknown;
  selectedFeedId: string | null;
  onNavigate: Navigate;
}): FeedOutputProps {
  const loadingTodayOutput = matchesGrandchildState(
    dashboardStateValue,
    "groupSelected",
    "feedSelected",
    "loadingTodayOutput",
  );
  const loadingDatedOutput = matchesGrandchildState(
    dashboardStateValue,
    "groupSelected",
    "feedSelected",
    "loadingDatedOutput",
  );

  return {
    output: dashboardContext?.output ?? null,
    outputLoading: loadingTodayOutput || loadingDatedOutput,
    outputError: dashboardContext?.outputError ?? "",
    onChangeFeedDate: (date) => {
      if (selectedFeedId !== null) {
        onNavigate(feedPath(selectedFeedId, date));
      }
      dashboardRef?.send({ type: "FEED_DATE_CHANGED", date });
    },
  };
}
