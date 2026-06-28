import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
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
  isUnauthorized,
  listFriendRequests,
  listFriends,
  listGroupInviteCandidates,
  listGroupInvites,
  rotateFriendCode,
} from "./api";
import { AuthView } from "./components/AuthView";
import { FriendsPanel } from "./components/FriendsPanel";
import { GroupDashboard } from "./components/GroupDashboard";
import { GroupsPanel } from "./components/GroupsPanel";
import { Toast } from "./components/Toast";
import { errorMessage } from "./errors";
import { appMachine } from "./machines/appMachine";
import type { addFeedMachine } from "./machines/addFeedMachine";
import type { dashboardMachine } from "./machines/dashboardMachine";
import type {
  DailyFeed,
  Friend,
  FriendRequests,
  Group,
  GroupFeedPost,
  GroupInvite,
  GroupInviteCandidate,
  User,
} from "./types";

type DashboardActorRef = ActorRefFromLogic<typeof dashboardMachine>;
type AddFeedActorRef = ActorRefFromLogic<typeof addFeedMachine>;
type AppRoute = "workspace" | "profile";

const EMPTY_GROUPS: Group[] = [];
const EMPTY_FEEDS: DailyFeed[] = [];
const EMPTY_POSTS: GroupFeedPost[] = [];
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
  const creatingPost = matchesGrandchildState(dashboardStateValue, "groupSelected", "feedSelected", "creatingPost");
  const addFeedOpen = matchesChildState(dashboardStateValue, "groupSelected", "addFeed");
  const addFeedLoadingSources = matchesTopState(addFeedStateValue, "loadingSources");
  const addFeedPreviewing = matchesTopState(addFeedStateValue, "previewing");
  const addFeedCreating = matchesTopState(addFeedStateValue, "creating");
  const showingProfile = route === "profile";

  useEffect(() => {
    function handlePopState() {
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

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

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
    window.history.pushState(null, "", path);
    setRoute(readAppRoute());
  }

  const postMutation = dashboardContext?.postMutation ?? null;
  const updatingPostId = postMutation?.kind === "update" ? postMutation.postId : null;
  const deletingPostId = postMutation?.kind === "delete" ? postMutation.postId : null;
  const profilePath = context.user === null ? "/" : userProfilePath(context.user);

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
                selectedGroupId={selectedGroupId}
                loading={loadingGroups}
                creating={creatingGroup}
                deletingGroupId={dashboardContext?.pendingDeleteGroupId ?? null}
                onCreateGroup={(name) => dashboardRef?.send({ type: "GROUP_CREATE_SUBMITTED", name })}
                onSelectGroup={(groupId) => dashboardRef?.send({ type: "GROUP_SELECTED", groupId })}
                onDeleteGroup={(groupId) => dashboardRef?.send({ type: "GROUP_DELETE_SUBMITTED", groupId })}
              />
            </div>
            <GroupDashboard
              group={selectedGroup}
              feeds={feeds}
              feedsLoading={loadingFeeds}
              feedsError={dashboardContext?.feedsError ?? ""}
              selectedFeedId={selectedFeedId}
              selectedFeedDate={dashboardContext?.selectedFeedDate ?? ""}
              output={dashboardContext?.output ?? null}
              outputLoading={loadingTodayOutput || loadingDatedOutput}
              outputError={dashboardContext?.outputError ?? ""}
              posts={dashboardContext?.posts ?? EMPTY_POSTS}
              postsLoading={loadingPosts}
              postsError={dashboardContext?.postsError ?? ""}
              postSubmitting={creatingPost}
              updatingPostId={updatingPostId}
              deletingPostId={deletingPostId}
              currentUserId={context.user?.id ?? null}
              addFeedOpen={addFeedOpen}
              addFeedSources={addFeedContext?.sources ?? []}
              addFeedSourcesLoading={addFeedLoadingSources}
              addFeedPreview={addFeedContext?.preview ?? null}
              addFeedPreviewLoading={addFeedPreviewing}
              addFeedSaving={addFeedCreating}
              addFeedError={addFeedContext?.error ?? ""}
              inviteCandidates={inviteCandidates}
              inviteCandidatesLoading={inviteCandidatesLoading}
              invitingUserId={invitingUserId}
              pendingToggleFeedId={dashboardContext?.pendingToggleFeedId ?? null}
              pendingDeleteFeedId={dashboardContext?.pendingDeleteFeedId ?? null}
              onSelectFeed={(feedId) => dashboardRef?.send({ type: "FEED_SELECTED", feedId })}
              onChangeFeedDate={(date) => dashboardRef?.send({ type: "FEED_DATE_CHANGED", date })}
              onToggleFeedEnabled={(feedId) => dashboardRef?.send({ type: "FEED_ENABLED_TOGGLED", feedId })}
              onDeleteFeed={(feedId) => dashboardRef?.send({ type: "FEED_DELETE_SUBMITTED", feedId })}
              onOpenAddFeed={() => dashboardRef?.send({ type: "ADD_FEED_OPENED" })}
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
              onDeleteFeedPost={(postId) => dashboardRef?.send({ type: "POST_DELETE_SUBMITTED", postId })}
              onInviteFriend={handleInviteFriend}
              onCancelGroupInvite={handleCancelGroupInviteForCandidate}
            />
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
  return window.location.pathname.startsWith("/user/") ? "profile" : "workspace";
}

function userProfilePath(user: User): string {
  return `/user/${encodeURIComponent(user.display_name)}`;
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
