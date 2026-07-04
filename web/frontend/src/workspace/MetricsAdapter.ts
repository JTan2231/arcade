import type { GroupDashboardProps } from "../components/GroupDashboard";
import { matchesGrandchildState } from "../machines/stateMatches";
import type { DashboardContext } from "../machines/dashboardMachine";
import { EMPTY_METRICS } from "./empty";
import type { DashboardActorRef } from "./types";

type MetricsProps = Pick<
  GroupDashboardProps,
  | "metrics"
  | "selectedMetricId"
  | "metricLeaderboard"
  | "metricsLoading"
  | "leaderboardLoading"
  | "metricsError"
  | "judgingPostId"
  | "onAddMetric"
  | "onSelectMetric"
  | "onCreateMetricJudgment"
>;

export function useMetricsAdapter({
  dashboardRef,
  dashboardContext,
  dashboardStateValue,
  selectedGroupId,
}: {
  dashboardRef: DashboardActorRef | undefined;
  dashboardContext: DashboardContext | null;
  dashboardStateValue: unknown;
  selectedGroupId: string | null;
}): MetricsProps {
  const loadingMetrics = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "loadingMetrics");
  const loadingLeaderboard = matchesGrandchildState(
    dashboardStateValue,
    "groupSelected",
    "feedSelected",
    "loadingLeaderboard",
  );
  const creatingJudgment = matchesGrandchildState(
    dashboardStateValue,
    "groupSelected",
    "feedSelected",
    "creatingJudgment",
  );
  const judgmentMutation = dashboardContext?.judgmentMutation ?? null;
  const judgingPostId = creatingJudgment ? (judgmentMutation?.postId ?? null) : null;

  return {
    metrics: dashboardContext?.metrics ?? EMPTY_METRICS,
    selectedMetricId: dashboardContext?.selectedMetricId ?? null,
    metricLeaderboard: dashboardContext?.metricLeaderboard ?? null,
    metricsLoading: loadingMetrics,
    leaderboardLoading: loadingLeaderboard,
    metricsError: dashboardContext?.metricsError ?? "",
    judgingPostId,
    onAddMetric: () => {
      if (selectedGroupId !== null) {
        dashboardRef?.send({ type: "GROUP_SETTINGS_OPENED", groupId: selectedGroupId });
      }
    },
    onSelectMetric: (metricId) => dashboardRef?.send({ type: "METRIC_SELECTED", metricId }),
    onCreateMetricJudgment: (metricId, postId, payload) =>
      dashboardRef?.send({
        type: "JUDGMENT_CREATE_SUBMITTED",
        metricId,
        postId,
        value: payload.value,
        note: payload.note ?? "",
      }),
  };
}
