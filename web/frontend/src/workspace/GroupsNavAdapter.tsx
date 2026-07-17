import { useEffect, useMemo, useState } from "react";

import { isUnauthorized } from "../api";
import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { GroupsPanel } from "../components/groups/GroupsPanel";
import { matchesChildState, matchesTopState } from "../machines/stateMatches";
import type { DashboardContext } from "../machines/dashboardMachine";
import { feedPath, groupPath } from "../routes";
import type { DailyFeed, Group } from "../types";
import { copyPublicPath } from "./copyPublicPath";
import { EMPTY_EVIDENCE_FORMATS } from "./empty";
import type { DashboardActorRef, Navigate, ToastCallback } from "./types";

export function GroupsNavAdapter({
  dashboardRef,
  dashboardContext,
  dashboardStateValue,
  groups,
  feeds,
  selectedGroupId,
  selectedFeedId,
  selectedFeedDate,
  onNavigate,
  onToast,
}: {
  dashboardRef: DashboardActorRef | undefined;
  dashboardContext: DashboardContext | null;
  dashboardStateValue: unknown;
  groups: Group[];
  feeds: DailyFeed[];
  selectedGroupId: string | null;
  selectedFeedId: string | null;
  selectedFeedDate: string;
  onNavigate: Navigate;
  onToast: ToastCallback;
}) {
  const currentUserId = dashboardContext?.currentUserId ?? "";
  const [memberFeeds, setMemberFeeds] = useState<DailyFeed[]>([]);
  const loadingGroups = matchesTopState(dashboardStateValue, "loadingGroups");
  const creatingGroup = matchesTopState(dashboardStateValue, "creatingGroup");
  const loadingFeeds = matchesChildState(dashboardStateValue, "groupSelected", "loadingFeeds");
  const refreshingFeedGeneration = matchesChildState(dashboardStateValue, "groupSelected", "refreshingFeedGeneration");
  const changingFeedFormat = matchesChildState(dashboardStateValue, "groupSelected", "changingFeedFormat");
  const changingFeedCaptions = matchesChildState(dashboardStateValue, "groupSelected", "changingFeedCaptions");
  const changingFeedSchedule = matchesChildState(dashboardStateValue, "groupSelected", "changingFeedSchedule");
  const pendingFeedCaptionsFeedId = changingFeedCaptions
    ? (dashboardContext?.feedCaptionsMutation?.feedId ?? null)
    : null;
  const pendingFeedFormatFeedId = changingFeedFormat ? (dashboardContext?.feedFormatMutation?.feedId ?? null) : null;
  const pendingFeedScheduleFeedId = changingFeedSchedule
    ? (dashboardContext?.feedScheduleMutation?.feedId ?? null)
    : null;
  const navFeeds = useMemo(() => {
    if (selectedGroupId === null) {
      return memberFeeds;
    }

    return [...memberFeeds.filter((feed) => feed.group_id !== selectedGroupId), ...feeds];
  }, [feeds, memberFeeds, selectedGroupId]);

  useEffect(() => {
    if (currentUserId === "") {
      setMemberFeeds([]);
      return undefined;
    }

    let active = true;
    queryCache
      .read(queries.meDailyFeeds, currentUserId)
      .then((nextFeeds) => {
        if (active) {
          setMemberFeeds(nextFeeds);
        }
      })
      .catch((error: unknown) => {
        if (active && !isUnauthorized(error)) {
          setMemberFeeds([]);
        }
      });

    return () => {
      active = false;
    };
  }, [currentUserId]);

  return (
    <GroupsPanel
      groups={groups}
      feeds={navFeeds}
      evidenceFormats={dashboardContext?.evidenceFormats ?? EMPTY_EVIDENCE_FORMATS}
      selectedGroupId={selectedGroupId}
      selectedFeedId={selectedFeedId}
      loading={loadingGroups}
      feedsLoading={loadingFeeds}
      feedsError={dashboardContext?.feedsError ?? ""}
      creating={creatingGroup}
      deletingGroupId={dashboardContext?.pendingDeleteGroupId ?? null}
      pendingToggleFeedId={dashboardContext?.pendingToggleFeedId ?? null}
      pendingFeedCaptionsFeedId={pendingFeedCaptionsFeedId}
      pendingFeedFormatFeedId={pendingFeedFormatFeedId}
      pendingFeedScheduleFeedId={pendingFeedScheduleFeedId}
      pendingRefreshFeedId={refreshingFeedGeneration ? (dashboardContext?.pendingRefreshFeedId ?? null) : null}
      pendingDeleteFeedId={dashboardContext?.pendingDeleteFeedId ?? null}
      onCreateGroup={(name) => dashboardRef?.send({ type: "GROUP_CREATE_SUBMITTED", name })}
      onSelectGroup={(groupId) => {
        const group = groups.find((candidate) => candidate.id === groupId);
        if (group !== undefined) {
          onNavigate(groupPath(group));
        }
        dashboardRef?.send({ type: "GROUP_SELECTED", groupId });
      }}
      onOpenGroupSettings={(groupId) => dashboardRef?.send({ type: "GROUP_SETTINGS_OPENED", groupId })}
      onDeleteGroup={(groupId) => dashboardRef?.send({ type: "GROUP_DELETE_SUBMITTED", groupId })}
      onSelectFeed={(feedId) => {
        const feed = navFeeds.find((candidate) => candidate.id === feedId);
        onNavigate(feedPath(feedId));
        if (feed === undefined || feed.group_id === selectedGroupId) {
          dashboardRef?.send({ type: "FEED_SELECTED", feedId });
        }
      }}
      onToggleFeedEnabled={(feedId) => dashboardRef?.send({ type: "FEED_ENABLED_TOGGLED", feedId })}
      onToggleFeedCaptions={(feedId) => dashboardRef?.send({ type: "FEED_CAPTIONS_TOGGLED", feedId })}
      onChangeFeedFormat={(feedId, evidenceFormatId) =>
        dashboardRef?.send({ type: "FEED_FORMAT_CHANGED", feedId, evidenceFormatId })
      }
      onChangeFeedSchedule={(feedId, schedule) =>
        dashboardRef?.send({ type: "FEED_SCHEDULE_CHANGED", feedId, schedule })
      }
      onRefreshFeedGeneration={(feedId) => {
        if (feedId === selectedFeedId) {
          onNavigate(feedPath(feedId));
        }
        dashboardRef?.send({ type: "FEED_GENERATION_REFRESHED", feedId });
      }}
      onCopyPublicFeedLink={(feedId) =>
        void copyPublicPath(
          feedPath(feedId, feedId === selectedFeedId && selectedFeedDate !== "" ? selectedFeedDate : null),
          "Feed link copied",
          onToast,
        )
      }
      onDeleteFeed={(feedId) => dashboardRef?.send({ type: "FEED_DELETE_SUBMITTED", feedId })}
      onAddFeed={() => dashboardRef?.send({ type: "ADD_FEED_OPENED" })}
    />
  );
}
