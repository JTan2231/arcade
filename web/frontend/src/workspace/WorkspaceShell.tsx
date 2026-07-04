import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSelector } from "@xstate/react";

import { getMemberFeedPostRoute, isUnauthorized, listMeDailyFeeds } from "../api";
import { matchesTopState } from "../machines/stateMatches";
import { groupPath, publicRouteCacheKey, type AppRoute } from "../routes";
import { useSocialGraph } from "../social/useSocialGraph";
import type { Group } from "../types";
import { FriendsAdapter } from "./FriendsAdapter";
import { GroupDashboardAdapter } from "./GroupDashboardAdapter";
import { GroupSettingsAdapter } from "./GroupSettingsAdapter";
import { GroupsNavAdapter } from "./GroupsNavAdapter";
import { PublicRouteAdapter } from "./PublicRouteAdapter";
import { EMPTY_FEEDS } from "./empty";
import type { AddFeedActorRef, DashboardActorRef, Navigate, ToastCallback } from "./types";

type MemberRouteTarget =
  | { routeKey: string; status: "loading" | "public" }
  | { routeKey: string; status: "member"; groupId: string; feedId?: string; date?: string | null };

const EMPTY_GROUPS: Group[] = [];

export function WorkspaceShell({
  dashboardRef,
  currentUser,
  route,
  signedIn,
  header,
  navigationPathRef,
  onNavigate,
  onToast,
  onUnauthorized,
  onUserUpdated,
}: {
  dashboardRef: DashboardActorRef | undefined;
  currentUser: Parameters<typeof useSocialGraph>[0]["currentUser"];
  route: AppRoute;
  signedIn: boolean;
  header: ReactNode;
  navigationPathRef: MutableRefObject<string | null>;
  onNavigate: Navigate;
  onToast: ToastCallback;
  onUnauthorized: () => void;
  onUserUpdated: Parameters<typeof useSocialGraph>[0]["onUserUpdated"];
}) {
  const dashboardSnapshot = useSelector(dashboardRef, (childSnapshot) => childSnapshot);
  const addFeedRef = dashboardSnapshot?.children["addFeed"] as AddFeedActorRef | undefined;
  const addFeedSnapshot = useSelector(addFeedRef, (childSnapshot) => childSnapshot);
  const [memberRouteTarget, setMemberRouteTarget] = useState<MemberRouteTarget | null>(null);
  const memberRouteGroupRefreshRef = useRef<string | null>(null);

  const dashboardContext = dashboardSnapshot?.context ?? null;
  const addFeedContext = addFeedSnapshot?.context ?? null;
  const dashboardStateValue = dashboardSnapshot?.value;
  const addFeedStateValue = addFeedSnapshot?.value;
  const loadingGroups = matchesTopState(dashboardStateValue, "loadingGroups");
  const publicRoute = typeof route === "object" ? route : null;
  const publicRouteKey = publicRoute === null ? "" : publicRouteCacheKey(publicRoute);
  const showingProfile = route === "profile";

  const groups = dashboardContext?.groups ?? EMPTY_GROUPS;
  const selectedGroupId = dashboardContext?.selectedGroupId ?? null;
  const feeds = dashboardContext?.feeds ?? EMPTY_FEEDS;
  const selectedFeedId = dashboardContext?.selectedFeedId ?? null;
  const selectedFeedDate = dashboardContext?.selectedFeedDate ?? "";

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const socialGraph = useSocialGraph({
    signedIn,
    showingProfile,
    selectedGroup,
    currentUser,
    onUnauthorized,
    onToast,
    onUserUpdated,
    onGroupInviteAccepted: (groupId) =>
      dashboardRef?.send({ type: "GROUPS_REFRESH_REQUESTED", preferredGroupId: groupId }),
  });

  useEffect(() => {
    if (!signedIn || publicRoute === null || publicRoute.kind === "group") {
      setMemberRouteTarget(null);
      return undefined;
    }

    const controller = new AbortController();
    const routeKey = publicRouteKey;
    setMemberRouteTarget({ routeKey, status: "loading" });

    if (publicRoute.kind === "feed") {
      listMeDailyFeeds({ signal: controller.signal })
        .then((memberFeeds) => {
          if (controller.signal.aborted) {
            return;
          }
          const feed = memberFeeds.find((candidate) => candidate.id === publicRoute.feedId);
          setMemberRouteTarget(
            feed === undefined
              ? { routeKey, status: "public" }
              : {
                  routeKey,
                  status: "member",
                  groupId: feed.group_id,
                  feedId: feed.id,
                  date: publicRoute.date,
                },
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          if (isUnauthorized(error)) {
            onUnauthorized();
            return;
          }
          setMemberRouteTarget({ routeKey, status: "public" });
        });
      return () => controller.abort();
    }

    getMemberFeedPostRoute(publicRoute.postId, { signal: controller.signal })
      .then((target) => {
        if (controller.signal.aborted) {
          return;
        }
        setMemberRouteTarget({
          routeKey,
          status: "member",
          groupId: target.group_id,
          feedId: target.feed_id,
          date: target.feed_date,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isUnauthorized(error)) {
          onUnauthorized();
          return;
        }
        setMemberRouteTarget({ routeKey, status: "public" });
      });
    return () => controller.abort();
  }, [onUnauthorized, publicRoute, publicRouteKey, signedIn]);

  useEffect(() => {
    if (!signedIn || publicRoute?.kind !== "group" || loadingGroups || dashboardRef === undefined) {
      return;
    }
    if (navigationPathRef.current === window.location.pathname) {
      return;
    }
    const group = groups.find((candidate) => candidate.slug === publicRoute.slug);
    if (group?.my_status === "active" && group.id !== selectedGroupId) {
      dashboardRef.send({ type: "GROUP_SELECTED", groupId: group.id });
    }
  }, [dashboardRef, groups, loadingGroups, navigationPathRef, publicRoute, selectedGroupId, signedIn]);

  useEffect(() => {
    if (
      !signedIn ||
      publicRoute?.kind !== "group" ||
      selectedGroup === null ||
      selectedGroup.my_status !== "active" ||
      navigationPathRef.current !== window.location.pathname ||
      selectedGroup.slug === publicRoute.slug
    ) {
      return;
    }
    onNavigate(groupPath(selectedGroup), "replace");
  }, [navigationPathRef, onNavigate, publicRoute, selectedGroup, signedIn]);

  useEffect(() => {
    if (
      !signedIn ||
      publicRoute === null ||
      publicRoute.kind === "group" ||
      memberRouteTarget?.status !== "member" ||
      memberRouteTarget.routeKey !== publicRouteKey ||
      dashboardRef === undefined
    ) {
      memberRouteGroupRefreshRef.current = null;
      return;
    }

    const targetGroup = groups.find((group) => group.id === memberRouteTarget.groupId && group.my_status === "active");
    if (targetGroup === undefined) {
      if (!loadingGroups) {
        const refreshKey = `${memberRouteTarget.routeKey}:${memberRouteTarget.groupId}`;
        if (memberRouteGroupRefreshRef.current !== refreshKey) {
          memberRouteGroupRefreshRef.current = refreshKey;
          dashboardRef.send({ type: "GROUPS_REFRESH_REQUESTED", preferredGroupId: memberRouteTarget.groupId });
        }
      }
      return;
    }

    memberRouteGroupRefreshRef.current = null;
    if (selectedGroupId !== memberRouteTarget.groupId) {
      dashboardRef.send({ type: "GROUP_SELECTED", groupId: memberRouteTarget.groupId });
      return;
    }
    if (memberRouteTarget.feedId === undefined) {
      return;
    }
    if (!feeds.some((feed) => feed.id === memberRouteTarget.feedId)) {
      return;
    }
    if (selectedFeedId !== memberRouteTarget.feedId) {
      dashboardRef.send({ type: "FEED_SELECTED", feedId: memberRouteTarget.feedId });
      return;
    }
    if (
      memberRouteTarget.date !== undefined &&
      memberRouteTarget.date !== null &&
      selectedFeedDate !== "" &&
      selectedFeedDate !== memberRouteTarget.date
    ) {
      dashboardRef.send({ type: "FEED_DATE_CHANGED", date: memberRouteTarget.date });
    }
  }, [
    dashboardRef,
    feeds,
    groups,
    loadingGroups,
    memberRouteTarget,
    publicRoute,
    publicRouteKey,
    selectedFeedDate,
    selectedFeedId,
    selectedGroupId,
    signedIn,
  ]);

  useEffect(() => {
    if (route !== "workspace" || !signedIn || selectedGroup === null || selectedGroup.my_status !== "active") {
      return;
    }
    onNavigate(groupPath(selectedGroup), "replace");
  }, [onNavigate, route, selectedGroup, signedIn]);

  const groupRouteGroup =
    publicRoute?.kind === "group" ? (groups.find((group) => group.slug === publicRoute.slug) ?? null) : null;
  const memberRouteTargetGroup =
    memberRouteTarget?.status === "member"
      ? (groups.find((group) => group.id === memberRouteTarget.groupId && group.my_status === "active") ?? null)
      : null;
  const groupRouteUsesWorkspace = publicRoute?.kind === "group" && signedIn && groupRouteGroup?.my_status === "active";
  const memberRouteResolutionPending =
    publicRoute !== null &&
    publicRoute.kind !== "group" &&
    signedIn &&
    (memberRouteTarget === null ||
      memberRouteTarget.routeKey !== publicRouteKey ||
      memberRouteTarget.status === "loading");
  const memberRouteUsesWorkspace =
    publicRoute !== null &&
    publicRoute.kind !== "group" &&
    signedIn &&
    !memberRouteResolutionPending &&
    memberRouteTarget?.routeKey === publicRouteKey &&
    memberRouteTargetGroup !== null;
  const publicRouteUsesWorkspace = groupRouteUsesWorkspace || memberRouteUsesWorkspace;

  if (publicRoute !== null && !publicRouteUsesWorkspace) {
    return <PublicRouteAdapter onNavigate={onNavigate} onToast={onToast} route={publicRoute} signedIn={signedIn} />;
  }

  return (
    <>
      {header}
      <main
        className={`layout ${showingProfile ? "profile-layout" : "group-layout"}`}
        aria-label={showingProfile ? "User profile" : "Arcade workspace"}
      >
        {showingProfile ? (
          <div className="profile-stack">
            <FriendsAdapter socialGraph={socialGraph} />
          </div>
        ) : (
          <>
            <div className="sidebar-stack">
              <GroupsNavAdapter
                dashboardRef={dashboardRef}
                dashboardContext={dashboardContext}
                dashboardStateValue={dashboardStateValue}
                groups={groups}
                feeds={feeds}
                selectedGroupId={selectedGroupId}
                selectedFeedId={selectedFeedId}
                selectedFeedDate={selectedFeedDate}
                onNavigate={onNavigate}
                onToast={onToast}
              />
            </div>
            <GroupDashboardAdapter
              dashboardRef={dashboardRef}
              addFeedRef={addFeedRef}
              dashboardContext={dashboardContext}
              addFeedContext={addFeedContext}
              dashboardStateValue={dashboardStateValue}
              addFeedStateValue={addFeedStateValue}
              selectedGroup={selectedGroup}
              selectedGroupId={selectedGroupId}
              feeds={feeds}
              selectedFeedId={selectedFeedId}
              selectedFeedDate={selectedFeedDate}
              currentUserId={currentUser?.id ?? null}
              onNavigate={onNavigate}
              onToast={onToast}
            />
            <GroupSettingsAdapter
              dashboardRef={dashboardRef}
              dashboardContext={dashboardContext}
              dashboardStateValue={dashboardStateValue}
              selectedGroup={selectedGroup}
              feeds={feeds}
              selectedFeedId={selectedFeedId}
              currentUserId={currentUser?.id ?? null}
              inviteCandidateProps={socialGraph.inviteCandidateProps}
              onNavigate={onNavigate}
            />
          </>
        )}
      </main>
    </>
  );
}
