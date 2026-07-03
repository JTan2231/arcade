import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useMachine, useSelector } from "@xstate/react";
import type { ActorRefFromLogic } from "xstate";

import {
  acceptFriendRequest,
  acceptGroupInvite,
  cancelFriendRequest,
  cancelGroupInvite,
  createFriendRequest,
  createGroupInvite,
  declineFriendRequest,
  declineGroupInvite,
  deleteFriend,
  getMemberFeedPostRoute,
  isUnauthorized,
  listMeDailyFeeds,
  listFriendRequests,
  listFriends,
  listGroupInviteCandidates,
  listGroupInvites,
  rotateFriendCode,
} from "./api";
import { AuthView } from "./components/AuthView";
import { FriendsPanel } from "./components/FriendsPanel";
import { GroupDashboard } from "./components/GroupDashboard";
import { GroupSettingsDialog } from "./components/GroupSettingsDialog";
import { GroupsPanel } from "./components/GroupsPanel";
import { PublicPage } from "./components/PublicPages";
import { Toast } from "./components/Toast";
import { errorMessage } from "./errors";
import { appMachine } from "./machines/appMachine";
import type { addFeedMachine } from "./machines/addFeedMachine";
import type { dashboardMachine } from "./machines/dashboardMachine";
import type {
  DailyFeed,
  FeedMetric,
  Friend,
  FriendRequests,
  Group,
  GroupFeedPost,
  GroupInvite,
  GroupInviteCandidate,
  GroupMember,
  GroupPostTag,
  PublicRoute,
  User,
} from "./types";

type DashboardActorRef = ActorRefFromLogic<typeof dashboardMachine>;
type AddFeedActorRef = ActorRefFromLogic<typeof addFeedMachine>;
type AppRoute = "workspace" | "profile" | PublicRoute;
type MemberRouteTarget =
  | { routeKey: string; status: "loading" | "public" }
  | { routeKey: string; status: "member"; groupId: string; feedId?: string; date?: string | null };

const EMPTY_GROUPS: Group[] = [];
const EMPTY_FEEDS: DailyFeed[] = [];
const EMPTY_POSTS: GroupFeedPost[] = [];
const EMPTY_POST_TAGS: GroupPostTag[] = [];
const EMPTY_GROUP_MEMBERS: GroupMember[] = [];
const EMPTY_METRICS: FeedMetric[] = [];
const EMPTY_FRIENDS: Friend[] = [];
const EMPTY_GROUP_INVITES: GroupInvite[] = [];
const EMPTY_INVITE_CANDIDATES: GroupInviteCandidate[] = [];
const EMPTY_FRIEND_REQUESTS: FriendRequests = {
  incoming: [],
  outgoing: [],
};

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => readAppRoute());
  const [snapshot, send] = useMachine(appMachine);
  const { context } = snapshot;
  const dashboardRef = snapshot.children["dashboard"] as DashboardActorRef | undefined;
  const dashboardSnapshot = useSelector(dashboardRef, (childSnapshot) => childSnapshot);
  const addFeedRef = dashboardSnapshot?.children["addFeed"] as AddFeedActorRef | undefined;
  const addFeedSnapshot = useSelector(addFeedRef, (childSnapshot) => childSnapshot);
  const [friendRequests, setFriendRequests] = useState<FriendRequests>(EMPTY_FRIEND_REQUESTS);
  const [friends, setFriends] = useState<Friend[]>(EMPTY_FRIENDS);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>(EMPTY_GROUP_INVITES);
  const [inviteCandidates, setInviteCandidates] = useState<GroupInviteCandidate[]>(EMPTY_INVITE_CANDIDATES);
  const [socialLoading, setSocialLoading] = useState(false);
  const [inviteCandidatesLoading, setInviteCandidatesLoading] = useState(false);
  const [socialError, setSocialError] = useState("");
  const [socialMutating, setSocialMutating] = useState<string | null>(null);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [memberRouteTarget, setMemberRouteTarget] = useState<MemberRouteTarget | null>(null);
  const appNavigationPathRef = useRef<string | null>(null);

  const checkingSession = snapshot.matches("checkingSession");
  const signedOut = snapshot.matches("signedOut");
  const signedIn = snapshot.matches("signedIn");
  const loggingIn = snapshot.matches({ signedOut: "loggingIn" });
  const signingUp = snapshot.matches({ signedOut: "signingUp" });

  const dashboardContext = dashboardSnapshot?.context ?? null;
  const addFeedContext = addFeedSnapshot?.context ?? null;
  const dashboardStateValue = dashboardSnapshot?.value;
  const addFeedStateValue = addFeedSnapshot?.value;

  const loadingGroups = matchesTopState(dashboardStateValue, "loadingGroups");
  const creatingGroup = matchesTopState(dashboardStateValue, "creatingGroup");
  const loadingFeeds = matchesChildState(dashboardStateValue, "groupSelected", "loadingFeeds");
  const refreshingFeedGeneration = matchesChildState(dashboardStateValue, "groupSelected", "refreshingFeedGeneration");
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
  const loadingPosts = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "loadingPosts");
  const loadingMetrics = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "loadingMetrics");
  const loadingLeaderboard = matchesGrandchildState(
    dashboardStateValue,
    "groupSelected",
    "feedSelected",
    "loadingLeaderboard",
  );
  const creatingPost = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "creatingPost");
  const creatingPostTag = matchesChildState(dashboardStateValue, "groupSelected", "creatingPostTag");
  const creatingMetric = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "creatingMetric");
  const creatingJudgment = matchesGrandchildState(
    dashboardStateValue,
    "groupSelected",
    "feedSelected",
    "creatingJudgment",
  );
  const addFeedOpen = matchesChildState(dashboardStateValue, "groupSelected", "addFeed");
  const addFeedLoadingSources = matchesTopState(addFeedStateValue, "loadingSources");
  const addFeedPreviewing = matchesTopState(addFeedStateValue, "previewing");
  const addFeedCreating = matchesTopState(addFeedStateValue, "creating");
  const publicRoute = typeof route === "object" ? route : null;
  const publicRouteKey = publicRoute === null ? "" : publicRouteCacheKey(publicRoute);
  const showingProfile = route === "profile";
  const setAppPath = useCallback((path: string, mode: "push" | "replace" = "push") => {
    if (window.location.pathname === path) {
      return;
    }
    appNavigationPathRef.current = path;
    if (mode === "replace") {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
    setRoute(readAppRoute());
  }, []);

  useEffect(() => {
    function handlePopState() {
      appNavigationPathRef.current = null;
      setRoute(readAppRoute());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (context.toastMessage === null) {
      return undefined;
    }

    const timer = window.setTimeout(() => send({ type: "TOAST_DISMISSED" }), 2400);
    return () => window.clearTimeout(timer);
  }, [context.toastMessage, send]);

  const groups = dashboardContext?.groups ?? EMPTY_GROUPS;
  const selectedGroupId = dashboardContext?.selectedGroupId ?? null;
  const feeds = dashboardContext?.feeds ?? EMPTY_FEEDS;
  const selectedFeedId = dashboardContext?.selectedFeedId ?? null;
  const selectedFeedDate = dashboardContext?.selectedFeedDate ?? "";

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

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
            send({ type: "UNAUTHORIZED" });
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
          send({ type: "UNAUTHORIZED" });
          return;
        }
        setMemberRouteTarget({ routeKey, status: "public" });
      });
    return () => controller.abort();
  }, [publicRoute, publicRouteKey, send, signedIn]);

  useEffect(() => {
    if (!signedIn || publicRoute?.kind !== "group" || loadingGroups || dashboardRef === undefined) {
      return;
    }
    if (appNavigationPathRef.current === window.location.pathname) {
      return;
    }
    const group = groups.find((candidate) => candidate.slug === publicRoute.slug);
    if (group?.my_status === "active" && group.id !== selectedGroupId) {
      dashboardRef.send({ type: "GROUP_SELECTED", groupId: group.id });
    }
  }, [dashboardRef, groups, loadingGroups, publicRoute, selectedGroupId, signedIn]);

  useEffect(() => {
    if (
      !signedIn ||
      publicRoute?.kind !== "group" ||
      selectedGroup === null ||
      selectedGroup.my_status !== "active" ||
      appNavigationPathRef.current !== window.location.pathname ||
      selectedGroup.slug === publicRoute.slug
    ) {
      return;
    }
    setAppPath(groupPath(selectedGroup), "replace");
  }, [publicRoute, selectedGroup, setAppPath, signedIn]);

  useEffect(() => {
    if (!signedIn || memberRouteTarget?.status !== "member" || dashboardRef === undefined) {
      return;
    }
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
  }, [dashboardRef, feeds, memberRouteTarget, selectedFeedDate, selectedFeedId, selectedGroupId, signedIn]);

  useEffect(() => {
    if (route !== "workspace" || !signedIn || selectedGroup === null || selectedGroup.my_status !== "active") {
      return;
    }
    setAppPath(groupPath(selectedGroup), "replace");
  }, [route, selectedGroup, setAppPath, signedIn]);

  const handleSocialError = useCallback(
    (error: unknown) => {
      if (isUnauthorized(error)) {
        send({ type: "UNAUTHORIZED" });
        return;
      }
      const message = errorMessage(error);
      setSocialError(message);
      send({ type: "TOAST_REQUESTED", message });
    },
    [send],
  );

  const refreshSocial = useCallback(
    async (options: { signal?: AbortSignal } = {}) => {
      setSocialLoading(true);
      setSocialError("");
      try {
        const apiOptions = options.signal === undefined ? {} : { signal: options.signal };
        const [nextRequests, nextFriends, nextGroupInvites] = await Promise.all([
          listFriendRequests(apiOptions),
          listFriends(apiOptions),
          listGroupInvites(apiOptions),
        ]);
        if (options.signal?.aborted === true) {
          return;
        }
        setFriendRequests(nextRequests);
        setFriends(nextFriends);
        setGroupInvites(nextGroupInvites);
      } catch (error) {
        if (options.signal?.aborted !== true) {
          handleSocialError(error);
        }
      } finally {
        if (options.signal?.aborted !== true) {
          setSocialLoading(false);
        }
      }
    },
    [handleSocialError],
  );

  const refreshInviteCandidates = useCallback(
    async (group: Group | null, options: { signal?: AbortSignal } = {}) => {
      if (group === null || group.my_status !== "active") {
        setInviteCandidates(EMPTY_INVITE_CANDIDATES);
        setInviteCandidatesLoading(false);
        return;
      }
      setInviteCandidatesLoading(true);
      try {
        const apiOptions = options.signal === undefined ? {} : { signal: options.signal };
        const nextCandidates = await listGroupInviteCandidates(group.id, apiOptions);
        if (options.signal?.aborted === true) {
          return;
        }
        setInviteCandidates(nextCandidates);
      } catch (error) {
        if (options.signal?.aborted !== true) {
          handleSocialError(error);
        }
      } finally {
        if (options.signal?.aborted !== true) {
          setInviteCandidatesLoading(false);
        }
      }
    },
    [handleSocialError],
  );

  useEffect(() => {
    if (!signedIn) {
      setFriendRequests(EMPTY_FRIEND_REQUESTS);
      setFriends(EMPTY_FRIENDS);
      setGroupInvites(EMPTY_GROUP_INVITES);
      setSocialLoading(false);
      setSocialError("");
      return undefined;
    }

    const controller = new AbortController();
    void refreshSocial({ signal: controller.signal });
    return () => controller.abort();
  }, [refreshSocial, signedIn]);

  useEffect(() => {
    if (!signedIn || showingProfile) {
      setInviteCandidates(EMPTY_INVITE_CANDIDATES);
      setInviteCandidatesLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    void refreshInviteCandidates(selectedGroup, { signal: controller.signal });
    return () => controller.abort();
  }, [refreshInviteCandidates, selectedGroup, showingProfile, signedIn]);

  async function runSocialMutation(key: string, task: () => Promise<string>) {
    setSocialMutating(key);
    setSocialError("");
    try {
      const message = await task();
      send({ type: "TOAST_REQUESTED", message });
      await refreshSocial();
      await refreshInviteCandidates(selectedGroup);
    } catch (error) {
      handleSocialError(error);
    } finally {
      setSocialMutating(null);
    }
  }

  function handleAddFriend(friendCode: string) {
    void runSocialMutation("add-friend", async () => {
      const request = await createFriendRequest(friendCode);
      return request.status === "accepted" ? "Friend added" : "Friend request sent";
    });
  }

  function handleAcceptFriendRequest(requestId: string) {
    void runSocialMutation(`accept-request:${requestId}`, async () => {
      await acceptFriendRequest(requestId);
      return "Friend added";
    });
  }

  function handleDeclineFriendRequest(requestId: string) {
    void runSocialMutation(`decline-request:${requestId}`, async () => {
      await declineFriendRequest(requestId);
      return "Friend request declined";
    });
  }

  function handleCancelFriendRequest(requestId: string) {
    void runSocialMutation(`cancel-request:${requestId}`, async () => {
      await cancelFriendRequest(requestId);
      return "Friend request canceled";
    });
  }

  function handleDeleteFriend(userId: string) {
    void runSocialMutation(`delete-friend:${userId}`, async () => {
      await deleteFriend(userId);
      return "Friend removed";
    });
  }

  function handleRotateFriendCode() {
    void runSocialMutation("rotate-code", async () => {
      const user = await rotateFriendCode();
      send({ type: "USER_UPDATED", user });
      return "Friend code rotated";
    });
  }

  function handleInviteFriend(userId: string) {
    if (selectedGroup === null) {
      return;
    }
    setInvitingUserId(userId);
    void runSocialMutation(`invite-friend:${userId}`, async () => {
      await createGroupInvite(selectedGroup.id, userId);
      return "Group invite sent";
    }).finally(() => setInvitingUserId(null));
  }

  function handleCancelGroupInviteForCandidate(userId: string) {
    if (selectedGroup === null) {
      return;
    }
    setInvitingUserId(userId);
    void runSocialMutation(`cancel-group-invite:${userId}`, async () => {
      await cancelGroupInvite(selectedGroup.id, userId);
      return "Group invite canceled";
    }).finally(() => setInvitingUserId(null));
  }

  function handleAcceptGroupInvite(invite: GroupInvite) {
    if (context.user === null) {
      return;
    }
    const userId = context.user.id;
    void runSocialMutation(`accept-group:${invite.group.id}`, async () => {
      await acceptGroupInvite(invite.group.id, userId);
      dashboardRef?.send({ type: "GROUPS_REFRESH_REQUESTED", preferredGroupId: invite.group.id });
      return "Group invite accepted";
    });
  }

  function handleDeclineGroupInvite(invite: GroupInvite) {
    if (context.user === null) {
      return;
    }
    const userId = context.user.id;
    void runSocialMutation(`decline-group:${invite.group.id}`, async () => {
      await declineGroupInvite(invite.group.id, userId);
      return "Group invite declined";
    });
  }

  function handleInternalLinkClick(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    setAppPath(path);
  }

  const postMutation = dashboardContext?.postMutation ?? null;
  const updatingPostId = postMutation?.kind === "update" ? postMutation.postId : null;
  const deletingPostId = postMutation?.kind === "delete" ? postMutation.postId : null;
  const postTagMutation = dashboardContext?.postTagMutation ?? null;
  const updatingPostTagId = postTagMutation?.kind === "update" ? postTagMutation.tagId : null;
  const deletingPostTagId = postTagMutation?.kind === "delete" ? postTagMutation.tagId : null;
  const groupMemberMutation = dashboardContext?.groupMemberMutation ?? null;
  const removingMemberUserId = groupMemberMutation?.userId ?? null;
  const updatingGroupVisibility = (dashboardContext?.groupVisibilityMutation ?? null) !== null;
  const metricMutation = dashboardContext?.metricMutation ?? null;
  const updatingMetricId = metricMutation?.kind === "update" ? metricMutation.metricId : null;
  const deletingMetricId = metricMutation?.kind === "delete" ? metricMutation.metricId : null;
  const judgmentMutation = dashboardContext?.judgmentMutation ?? null;
  const judgingPostId = creatingJudgment ? (judgmentMutation?.postId ?? null) : null;
  const profilePath = context.user === null ? "/" : userProfilePath(context.user);
  const groupRouteGroup =
    publicRoute?.kind === "group" ? (groups.find((group) => group.slug === publicRoute.slug) ?? null) : null;
  const groupRouteUsesWorkspace =
    publicRoute?.kind === "group" && signedIn && (loadingGroups || groupRouteGroup?.my_status === "active");
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
    (memberRouteResolutionPending || memberRouteTarget?.status === "member");
  const publicRouteUsesWorkspace = groupRouteUsesWorkspace || memberRouteUsesWorkspace;

  if (publicRoute !== null && !publicRouteUsesWorkspace) {
    return (
      <>
        <PublicPage
          onCopyPublicPostLink={(postId) => void copyPublicPath(postPath(postId), "Post link copied")}
          onNavigate={setAppPath}
          route={publicRoute}
          signedIn={signedIn}
        />
        <Toast message={context.toastMessage} />
      </>
    );
  }

  async function copyPublicPath(path: string, message: string) {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      send({ type: "TOAST_REQUESTED", message });
    } catch {
      send({ type: "TOAST_REQUESTED", message: url });
    }
  }

  if (checkingSession) {
    return (
      <>
        <main className="auth-layout">
          <section className="panel auth-panel" aria-label="Authentication">
            <div className="empty-state">Checking session...</div>
          </section>
        </main>
        <Toast message={context.toastMessage} />
      </>
    );
  }

  if (signedOut) {
    return (
      <>
        <AuthView
          error={context.authError}
          submitting={loggingIn || signingUp}
          onClearError={() => send({ type: "AUTH_ERROR_CLEARED" })}
          onLogin={(payload) => send({ type: "LOGIN_SUBMITTED", payload })}
          onSignup={(payload) => send({ type: "SIGNUP_SUBMITTED", payload })}
        />
        <Toast message={context.toastMessage} />
      </>
    );
  }

  return (
    <>
      <header className="app-header">
        <div>
          <h1>
            <a className="app-title-link" href="/" onClick={(event) => handleInternalLinkClick(event, "/")}>
              Arcade
            </a>
          </h1>
          {context.user !== null ? (
            <a
              className="header-user"
              href={profilePath}
              onClick={(event) => handleInternalLinkClick(event, profilePath)}
            >
              {context.user.display_name}
            </a>
          ) : null}
        </div>
        <button className="secondary" type="button" onClick={() => send({ type: "LOGOUT_REQUESTED" })}>
          Logout
        </button>
      </header>

      <main
        className={`layout ${showingProfile ? "profile-layout" : "group-layout"}`}
        aria-label={showingProfile ? "User profile" : "Arcade workspace"}
      >
        {showingProfile ? (
          <div className="profile-stack">
            <FriendsPanel
              user={context.user}
              friendRequests={friendRequests}
              friends={friends}
              groupInvites={groupInvites}
              loading={socialLoading}
              error={socialError}
              mutating={socialMutating}
              onAddFriend={handleAddFriend}
              onAcceptFriendRequest={handleAcceptFriendRequest}
              onDeclineFriendRequest={handleDeclineFriendRequest}
              onCancelFriendRequest={handleCancelFriendRequest}
              onDeleteFriend={handleDeleteFriend}
              onRotateFriendCode={handleRotateFriendCode}
              onAcceptGroupInvite={handleAcceptGroupInvite}
              onDeclineGroupInvite={handleDeclineGroupInvite}
            />
          </div>
        ) : (
          <>
            <div className="sidebar-stack">
              <GroupsPanel
                groups={groups}
                feeds={feeds}
                selectedGroupId={selectedGroupId}
                selectedFeedId={selectedFeedId}
                loading={loadingGroups}
                feedsLoading={loadingFeeds}
                feedsError={dashboardContext?.feedsError ?? ""}
                creating={creatingGroup}
                deletingGroupId={dashboardContext?.pendingDeleteGroupId ?? null}
                pendingToggleFeedId={dashboardContext?.pendingToggleFeedId ?? null}
                pendingRefreshFeedId={
                  refreshingFeedGeneration ? (dashboardContext?.pendingRefreshFeedId ?? null) : null
                }
                pendingDeleteFeedId={dashboardContext?.pendingDeleteFeedId ?? null}
                onCreateGroup={(name) => dashboardRef?.send({ type: "GROUP_CREATE_SUBMITTED", name })}
                onSelectGroup={(groupId) => {
                  const group = groups.find((candidate) => candidate.id === groupId);
                  if (group !== undefined) {
                    setAppPath(groupPath(group));
                  }
                  dashboardRef?.send({ type: "GROUP_SELECTED", groupId });
                }}
                onOpenGroupSettings={(groupId) => dashboardRef?.send({ type: "GROUP_SETTINGS_OPENED", groupId })}
                onDeleteGroup={(groupId) => dashboardRef?.send({ type: "GROUP_DELETE_SUBMITTED", groupId })}
                onSelectFeed={(feedId) => {
                  setAppPath(feedPath(feedId));
                  dashboardRef?.send({ type: "FEED_SELECTED", feedId });
                }}
                onToggleFeedEnabled={(feedId) => dashboardRef?.send({ type: "FEED_ENABLED_TOGGLED", feedId })}
                onRefreshFeedGeneration={(feedId) => {
                  if (feedId === selectedFeedId) {
                    setAppPath(feedPath(feedId));
                  }
                  dashboardRef?.send({ type: "FEED_GENERATION_REFRESHED", feedId });
                }}
                onCopyPublicFeedLink={(feedId) =>
                  void copyPublicPath(
                    feedPath(feedId, feedId === selectedFeedId && selectedFeedDate !== "" ? selectedFeedDate : null),
                    "Feed link copied",
                  )
                }
                onDeleteFeed={(feedId) => dashboardRef?.send({ type: "FEED_DELETE_SUBMITTED", feedId })}
                onAddFeed={() => dashboardRef?.send({ type: "ADD_FEED_OPENED" })}
              />
            </div>
            <GroupDashboard
              group={selectedGroup}
              feeds={feeds}
              selectedFeedId={selectedFeedId}
              selectedFeedDate={selectedFeedDate}
              output={dashboardContext?.output ?? null}
              outputLoading={loadingTodayOutput || loadingDatedOutput}
              outputError={dashboardContext?.outputError ?? ""}
              posts={dashboardContext?.posts ?? EMPTY_POSTS}
              postTags={dashboardContext?.postTags ?? EMPTY_POST_TAGS}
              postsLoading={loadingPosts}
              postsError={dashboardContext?.postsError ?? ""}
              metrics={dashboardContext?.metrics ?? EMPTY_METRICS}
              selectedMetricId={dashboardContext?.selectedMetricId ?? null}
              metricLeaderboard={dashboardContext?.metricLeaderboard ?? null}
              metricsLoading={loadingMetrics}
              leaderboardLoading={loadingLeaderboard}
              metricsError={dashboardContext?.metricsError ?? ""}
              postSubmitting={creatingPost}
              updatingPostId={updatingPostId}
              deletingPostId={deletingPostId}
              judgingPostId={judgingPostId}
              currentUserId={context.user?.id ?? null}
              addFeedOpen={addFeedOpen}
              addFeedSources={addFeedContext?.sources ?? []}
              addFeedSourcesLoading={addFeedLoadingSources}
              addFeedPreview={addFeedContext?.preview ?? null}
              addFeedPreviewLoading={addFeedPreviewing}
              addFeedSaving={addFeedCreating}
              addFeedError={addFeedContext?.error ?? ""}
              onChangeFeedDate={(date) => {
                if (selectedFeedId !== null) {
                  setAppPath(feedPath(selectedFeedId, date));
                }
                dashboardRef?.send({ type: "FEED_DATE_CHANGED", date });
              }}
              onCloseAddFeed={() => {
                if (addFeedRef !== undefined) {
                  addFeedRef.send({ type: "CLOSED" });
                  return;
                }
                dashboardRef?.send({ type: "ADD_FEED_CLOSED" });
              }}
              onAddFeedDraftChanged={() => addFeedRef?.send({ type: "DRAFT_CHANGED" })}
              onPreviewFeed={(payload) => addFeedRef?.send({ type: "PREVIEW_SUBMITTED", payload })}
              onCreateFeed={(payload) => addFeedRef?.send({ type: "CREATE_SUBMITTED", payload })}
              onCreateFeedPost={(payload) => dashboardRef?.send({ type: "POST_CREATE_SUBMITTED", payload })}
              onUpdateFeedPost={(postId, payload) =>
                dashboardRef?.send({ type: "POST_UPDATE_SUBMITTED", postId, payload })
              }
              onCopyPublicPostLink={(postId) => void copyPublicPath(postPath(postId), "Post link copied")}
              onDeleteFeedPost={(postId) => dashboardRef?.send({ type: "POST_DELETE_SUBMITTED", postId })}
              onAddMetric={() => {
                if (selectedGroupId !== null) {
                  dashboardRef?.send({ type: "GROUP_SETTINGS_OPENED", groupId: selectedGroupId });
                }
              }}
              onSelectMetric={(metricId) => dashboardRef?.send({ type: "METRIC_SELECTED", metricId })}
              onCreateMetricJudgment={(metricId, postId, payload) =>
                dashboardRef?.send({
                  type: "JUDGMENT_CREATE_SUBMITTED",
                  metricId,
                  postId,
                  value: payload.value,
                  note: payload.note ?? "",
                })
              }
            />
            {dashboardContext?.groupSettingsOpen === true && selectedGroup !== null ? (
              <GroupSettingsDialog
                currentUserId={context.user?.id ?? null}
                deletingTagId={deletingPostTagId}
                deletingMetricId={deletingMetricId}
                feeds={feeds}
                group={selectedGroup}
                inviteCandidates={inviteCandidates}
                inviteCandidatesLoading={inviteCandidatesLoading}
                invitingUserId={invitingUserId}
                loading={loadingFeeds}
                members={dashboardContext.groupMembers ?? EMPTY_GROUP_MEMBERS}
                membersError={dashboardContext.groupMembersError}
                metricSubmitting={creatingMetric}
                metrics={dashboardContext.metrics ?? EMPTY_METRICS}
                metricsError={dashboardContext.metricsError}
                metricsLoading={loadingMetrics}
                removingMemberUserId={removingMemberUserId}
                selectedFeedId={selectedFeedId}
                tagError={dashboardContext.postTagsError}
                tagSaving={creatingPostTag}
                tags={dashboardContext.postTags ?? EMPTY_POST_TAGS}
                updatingMetricId={updatingMetricId}
                updatingTagId={updatingPostTagId}
                visibilitySaving={updatingGroupVisibility}
                onCancelGroupInvite={handleCancelGroupInviteForCandidate}
                onClose={() => dashboardRef?.send({ type: "GROUP_SETTINGS_CLOSED" })}
                onCreateMetric={(payload) => dashboardRef?.send({ type: "METRIC_CREATE_SUBMITTED", payload })}
                onCreateTag={(payload) => dashboardRef?.send({ type: "POST_TAG_CREATE_SUBMITTED", payload })}
                onDeleteMetric={(metricId) => dashboardRef?.send({ type: "METRIC_DELETE_SUBMITTED", metricId })}
                onDeleteTag={(tagId) => dashboardRef?.send({ type: "POST_TAG_DELETE_SUBMITTED", tagId })}
                onInviteFriend={handleInviteFriend}
                onRemoveMember={(userId) => dashboardRef?.send({ type: "GROUP_MEMBER_REMOVE_SUBMITTED", userId })}
                onSelectFeed={(feedId) => {
                  setAppPath(feedPath(feedId));
                  dashboardRef?.send({ type: "FEED_SELECTED", feedId });
                }}
                onUpdateVisibility={(visibility) =>
                  dashboardRef?.send({ type: "GROUP_VISIBILITY_CHANGED", groupId: selectedGroup.id, visibility })
                }
                onUpdateMetric={(metricId, payload) =>
                  dashboardRef?.send({ type: "METRIC_UPDATE_SUBMITTED", metricId, payload })
                }
                onUpdateTag={(tagId, payload) =>
                  dashboardRef?.send({ type: "POST_TAG_UPDATE_SUBMITTED", tagId, payload })
                }
              />
            ) : null}
          </>
        )}
      </main>

      <Toast message={context.toastMessage} />
    </>
  );
}

function matchesTopState(value: unknown, state: string): boolean {
  if (typeof value === "string") {
    return value === state;
  }
  return isStateObject(value) && Object.prototype.hasOwnProperty.call(value, state);
}

function readAppRoute(): AppRoute {
  let segments: string[];
  try {
    segments = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return "workspace";
  }
  if (segments[0] === "user") {
    return "profile";
  }
  const resourceId = segments[1];
  if (segments[0] === "g" && segments.length === 2 && resourceId !== undefined && resourceId !== "") {
    return {
      kind: "group",
      slug: resourceId,
    };
  }
  if (
    segments[0] === "f" &&
    (segments.length === 2 || segments.length === 3) &&
    resourceId !== undefined &&
    resourceId !== ""
  ) {
    return {
      kind: "feed",
      feedId: resourceId,
      date: segments[2] ?? null,
    };
  }
  if (segments[0] === "p" && segments.length === 2 && resourceId !== undefined && resourceId !== "") {
    return {
      kind: "post",
      postId: resourceId,
    };
  }
  return "workspace";
}

function userProfilePath(user: User): string {
  return `/user/${encodeURIComponent(user.display_name)}`;
}

function groupPath(group: Group): string {
  return `/g/${encodeURIComponent(group.slug)}`;
}

function feedPath(feedId: string, date: string | null = null): string {
  const encodedFeedId = encodeURIComponent(feedId);
  return date === null || date === "" ? `/f/${encodedFeedId}` : `/f/${encodedFeedId}/${encodeURIComponent(date)}`;
}

function postPath(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`;
}

function publicRouteCacheKey(route: PublicRoute): string {
  switch (route.kind) {
    case "group":
      return `group:${route.slug}`;
    case "feed":
      return `feed:${route.feedId}:${route.date ?? ""}`;
    case "post":
      return `post:${route.postId}`;
  }
}

function matchesChildState(value: unknown, parent: string, child: string): boolean {
  if (!isStateObject(value)) {
    return false;
  }
  return value[parent] === child;
}

function matchesGrandchildState(value: unknown, parent: string, child: string, grandchild: string): boolean {
  if (!isStateObject(value)) {
    return false;
  }
  const childValue = value[parent];
  if (!isStateObject(childValue)) {
    return false;
  }
  return childValue[child] === grandchild;
}

function isStateObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
