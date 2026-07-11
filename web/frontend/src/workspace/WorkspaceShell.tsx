import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useSelector } from "@xstate/react";

import { isUnauthorized } from "../api";
import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { useInviteLinks } from "../invites/useInviteLinks";
import { matchesTopState } from "../machines/stateMatches";
import { groupPath, publicRouteCacheKey, type AppRoute } from "../routes";
import type { Group, User } from "../types";
import { GroupDashboardAdapter } from "./GroupDashboardAdapter";
import { GroupSettingsAdapter } from "./GroupSettingsAdapter";
import { GroupsNavAdapter } from "./GroupsNavAdapter";
import { PublicRouteAdapter } from "./PublicRouteAdapter";
import { EMPTY_FEEDS } from "./empty";
import type { AddFeedActorRef, DashboardActorRef, Navigate, ToastCallback } from "./types";

type MemberRouteTarget =
  | { routeKey: string; status: "loading" | "public" }
  | { routeKey: string; status: "member"; groupId: string; feedId?: string; date?: string | null };

type ResolvedMemberRouteTarget = Extract<MemberRouteTarget, { status: "member" }>;

const EMPTY_GROUPS: Group[] = [];

export function WorkspaceShell({
  dashboardRef,
  currentUser,
  route,
  signedIn,
  navigationPathRef,
  onNavigate,
  onLogout,
  onToast,
  onUnauthorized,
}: {
  dashboardRef: DashboardActorRef | undefined;
  currentUser: User | null;
  route: AppRoute;
  signedIn: boolean;
  navigationPathRef: MutableRefObject<string | null>;
  onNavigate: Navigate;
  onLogout: () => void;
  onToast: ToastCallback;
  onUnauthorized: () => void;
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
  const publicRoute = typeof route === "object" && route.kind !== "invite" ? route : null;
  const publicRouteKey = publicRoute === null ? "" : publicRouteCacheKey(publicRoute);

  const groups = dashboardContext?.groups ?? EMPTY_GROUPS;
  const selectedGroupId = dashboardContext?.selectedGroupId ?? null;
  const feeds = dashboardContext?.feeds ?? EMPTY_FEEDS;
  const selectedFeedId = dashboardContext?.selectedFeedId ?? null;
  const selectedFeedDate = dashboardContext?.selectedFeedDate ?? "";
  const currentUserId = currentUser?.id ?? null;

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const workspaceMemberRouteTarget = useMemo<ResolvedMemberRouteTarget | null>(() => {
    if (publicRoute?.kind === "feed" && signedIn && selectedGroup?.my_status === "active") {
      const feed = feeds.find((candidate) => candidate.id === publicRoute.feedId);
      if (feed !== undefined) {
        return {
          routeKey: publicRouteKey,
          status: "member",
          groupId: feed.group_id,
          feedId: feed.id,
          date: publicRoute.date,
        };
      }
    }

    if (memberRouteTarget?.status === "member" && memberRouteTarget.routeKey === publicRouteKey) {
      return memberRouteTarget;
    }

    return null;
  }, [feeds, memberRouteTarget, publicRoute, publicRouteKey, selectedGroup, signedIn]);

  const inviteLinks = useInviteLinks({
    signedIn,
    selectedGroup,
    currentUserId,
    onUnauthorized,
    onToast,
  });

  useEffect(() => {
    if (!signedIn || currentUserId === null || publicRoute === null || publicRoute.kind === "group") {
      setMemberRouteTarget(null);
      return undefined;
    }

    if (
      publicRoute.kind === "feed" &&
      selectedGroup?.my_status === "active" &&
      feeds.some((feed) => feed.id === publicRoute.feedId)
    ) {
      setMemberRouteTarget(null);
      return undefined;
    }

    const controller = new AbortController();
    const routeKey = publicRouteKey;
    setMemberRouteTarget({ routeKey, status: "loading" });

    if (publicRoute.kind === "feed") {
      queryCache
        .read(queries.meDailyFeeds, currentUserId, { signal: controller.signal })
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

    queryCache
      .read(queries.memberFeedPostRoute, currentUserId, publicRoute.postId, { signal: controller.signal })
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
  }, [currentUserId, feeds, onUnauthorized, publicRoute, publicRouteKey, selectedGroup, signedIn]);

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
      workspaceMemberRouteTarget === null ||
      dashboardRef === undefined
    ) {
      memberRouteGroupRefreshRef.current = null;
      return;
    }

    const targetGroup = groups.find(
      (group) => group.id === workspaceMemberRouteTarget.groupId && group.my_status === "active",
    );
    if (targetGroup === undefined) {
      if (!loadingGroups) {
        const refreshKey = `${workspaceMemberRouteTarget.routeKey}:${workspaceMemberRouteTarget.groupId}`;
        if (memberRouteGroupRefreshRef.current !== refreshKey) {
          memberRouteGroupRefreshRef.current = refreshKey;
          dashboardRef.send({ type: "GROUPS_REFRESH_REQUESTED", preferredGroupId: workspaceMemberRouteTarget.groupId });
        }
      }
      return;
    }

    memberRouteGroupRefreshRef.current = null;
    if (selectedGroupId !== workspaceMemberRouteTarget.groupId) {
      dashboardRef.send({ type: "GROUP_SELECTED", groupId: workspaceMemberRouteTarget.groupId });
      return;
    }
    if (workspaceMemberRouteTarget.feedId === undefined) {
      return;
    }
    if (!feeds.some((feed) => feed.id === workspaceMemberRouteTarget.feedId)) {
      return;
    }
    if (selectedFeedId !== workspaceMemberRouteTarget.feedId) {
      dashboardRef.send({ type: "FEED_SELECTED", feedId: workspaceMemberRouteTarget.feedId });
      return;
    }
    if (
      workspaceMemberRouteTarget.date !== undefined &&
      workspaceMemberRouteTarget.date !== null &&
      selectedFeedDate !== "" &&
      selectedFeedDate !== workspaceMemberRouteTarget.date
    ) {
      dashboardRef.send({ type: "FEED_DATE_CHANGED", date: workspaceMemberRouteTarget.date });
    }
  }, [
    dashboardRef,
    feeds,
    groups,
    loadingGroups,
    publicRoute,
    selectedFeedDate,
    selectedFeedId,
    selectedGroupId,
    signedIn,
    workspaceMemberRouteTarget,
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
    workspaceMemberRouteTarget !== null
      ? (groups.find((group) => group.id === workspaceMemberRouteTarget.groupId && group.my_status === "active") ??
        null)
      : null;
  const groupRouteUsesWorkspace = publicRoute?.kind === "group" && signedIn && groupRouteGroup?.my_status === "active";
  const memberRouteUsesWorkspace =
    publicRoute !== null &&
    publicRoute.kind !== "group" &&
    signedIn &&
    workspaceMemberRouteTarget !== null &&
    memberRouteTargetGroup !== null;
  const publicRouteUsesWorkspace = groupRouteUsesWorkspace || memberRouteUsesWorkspace;

  if (publicRoute !== null && !publicRouteUsesWorkspace) {
    return <PublicRouteAdapter onNavigate={onNavigate} route={publicRoute} signedIn={signedIn} />;
  }

  return (
    <main className="layout group-layout" aria-label="Arcade workspace">
      <button className="secondary workspace-logout-button" type="button" onClick={onLogout}>
        Logout
      </button>
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
      />
      <GroupSettingsAdapter
        dashboardRef={dashboardRef}
        dashboardContext={dashboardContext}
        dashboardStateValue={dashboardStateValue}
        selectedGroup={selectedGroup}
        feeds={feeds}
        selectedFeedId={selectedFeedId}
        currentUserId={currentUser?.id ?? null}
        inviteLinkProps={inviteLinks}
        onNavigate={onNavigate}
      />
    </main>
  );
}
