import { useCallback } from "react";

import { listGroupDailyFeedOutputSummaries } from "../api";
import { GroupDashboard } from "../components/GroupDashboard";
import type { AddFeedContext } from "../machines/addFeedMachine";
import type { DashboardContext } from "../machines/dashboardMachine";
import type { DailyFeed, Group } from "../types";
import { useAddFeedAdapter } from "./AddFeedAdapter";
import { useFeedOutputAdapter } from "./FeedOutputAdapter";
import { useMetricsAdapter } from "./MetricsAdapter";
import { usePostsAdapter } from "./PostsAdapter";
import type { AddFeedActorRef, DashboardActorRef, Navigate, ToastCallback } from "./types";

export function GroupDashboardAdapter({
  dashboardRef,
  addFeedRef,
  dashboardContext,
  addFeedContext,
  dashboardStateValue,
  addFeedStateValue,
  selectedGroup,
  selectedGroupId,
  feeds,
  selectedFeedId,
  selectedFeedDate,
  currentUserId,
  onNavigate,
  onToast,
}: {
  dashboardRef: DashboardActorRef | undefined;
  addFeedRef: AddFeedActorRef | undefined;
  dashboardContext: DashboardContext | null;
  addFeedContext: AddFeedContext | null;
  dashboardStateValue: unknown;
  addFeedStateValue: unknown;
  selectedGroup: Group | null;
  selectedGroupId: string | null;
  feeds: DailyFeed[];
  selectedFeedId: string | null;
  selectedFeedDate: string;
  currentUserId: string | null;
  onNavigate: Navigate;
  onToast: ToastCallback;
}) {
  const loadFeedOutputSummaries = useCallback(
    (selectedDate: string, signal: AbortSignal) => {
      if (selectedGroupId === null || selectedFeedId === null) {
        return Promise.reject(new Error("No feed selected"));
      }
      return listGroupDailyFeedOutputSummaries(selectedGroupId, selectedFeedId, selectedDate, { signal });
    },
    [selectedFeedId, selectedGroupId],
  );
  const feedOutputProps = useFeedOutputAdapter({
    dashboardRef,
    dashboardContext,
    dashboardStateValue,
    selectedFeedId,
    onNavigate,
  });
  const postsProps = usePostsAdapter({
    dashboardRef,
    dashboardContext,
    dashboardStateValue,
    currentUserId,
    onToast,
  });
  const metricsProps = useMetricsAdapter({
    dashboardRef,
    dashboardContext,
    dashboardStateValue,
    selectedGroupId,
  });
  const addFeedProps = useAddFeedAdapter({
    dashboardRef,
    addFeedRef,
    addFeedContext,
    dashboardStateValue,
    addFeedStateValue,
  });

  return (
    <GroupDashboard
      group={selectedGroup}
      feeds={feeds}
      loadFeedOutputSummaries={loadFeedOutputSummaries}
      selectedFeedId={selectedFeedId}
      selectedFeedDate={selectedFeedDate}
      {...feedOutputProps}
      {...postsProps}
      {...metricsProps}
      {...addFeedProps}
    />
  );
}
