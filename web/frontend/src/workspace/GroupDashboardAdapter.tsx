import { useCallback, useEffect } from "react";

import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { GroupDashboard } from "../components/GroupDashboard";
import type { AddFeedContext } from "../machines/addFeedMachine";
import type { DashboardContext } from "../machines/dashboardMachine";
import type { DailyFeed, Group } from "../types";
import { useAddFeedAdapter } from "./AddFeedAdapter";
import { useFeedOutputAdapter } from "./FeedOutputAdapter";
import { useMetricsAdapter } from "./MetricsAdapter";
import { usePostsAdapter } from "./PostsAdapter";
import type { AddFeedActorRef, DashboardActorRef, Navigate } from "./types";

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
}) {
  const loadFeedOutputSummaries = useCallback(
    (selectedDate: string, signal: AbortSignal) => {
      if (selectedGroupId === null || selectedFeedId === null) {
        return Promise.reject(new Error("No feed selected"));
      }
      if (currentUserId === null) {
        return Promise.reject(new Error("No user selected"));
      }
      return queryCache.read(
        queries.feedOutputSummaries,
        currentUserId,
        selectedGroupId,
        selectedFeedId,
        selectedDate,
        {
          signal,
        },
      );
    },
    [currentUserId, selectedFeedId, selectedGroupId],
  );
  useEffect(() => {
    if (currentUserId === null || selectedGroupId === null || selectedFeedId === null) {
      return;
    }

    queryCache.prefetch(queries.feedOutputSummaries, currentUserId, selectedGroupId, selectedFeedId, selectedFeedDate);
  }, [currentUserId, selectedFeedDate, selectedFeedId, selectedGroupId]);
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
