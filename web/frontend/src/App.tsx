import { useEffect, useMemo } from "react";
import { useMachine, useSelector } from "@xstate/react";
import type { ActorRefFromLogic } from "xstate";

import { AuthView } from "./components/AuthView";
import { GroupDashboard } from "./components/GroupDashboard";
import { GroupsPanel } from "./components/GroupsPanel";
import { Toast } from "./components/Toast";
import { appMachine } from "./machines/appMachine";
import type { addFeedMachine } from "./machines/addFeedMachine";
import type { dashboardMachine } from "./machines/dashboardMachine";
import type { DailyFeed, Group, GroupFeedPost } from "./types";

type DashboardActorRef = ActorRefFromLogic<typeof dashboardMachine>;
type AddFeedActorRef = ActorRefFromLogic<typeof addFeedMachine>;

const EMPTY_GROUPS: Group[] = [];
const EMPTY_FEEDS: DailyFeed[] = [];
const EMPTY_POSTS: GroupFeedPost[] = [];

export default function App() {
  const [snapshot, send] = useMachine(appMachine);
  const { context } = snapshot;
  const dashboardRef = snapshot.children["dashboard"] as DashboardActorRef | undefined;
  const dashboardSnapshot = useSelector(dashboardRef, (childSnapshot) => childSnapshot);
  const addFeedRef = dashboardSnapshot?.children["addFeed"] as AddFeedActorRef | undefined;
  const addFeedSnapshot = useSelector(addFeedRef, (childSnapshot) => childSnapshot);

  const checkingSession = snapshot.matches("checkingSession");
  const signedOut = snapshot.matches("signedOut");
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

  const postMutation = dashboardContext?.postMutation ?? null;
  const updatingPostId = postMutation?.kind === "update" ? postMutation.postId : null;
  const deletingPostId = postMutation?.kind === "delete" ? postMutation.postId : null;

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
          <h1>Arcade</h1>
          {context.user !== null ? <div className="header-user">{context.user.display_name}</div> : null}
        </div>
        <button className="secondary" type="button" onClick={() => send({ type: "LOGOUT_REQUESTED" })}>
          Logout
        </button>
      </header>

      <main className="layout group-layout" aria-label="Arcade workspace">
        <GroupsPanel
          groups={groups}
          selectedGroupId={selectedGroupId}
          loading={loadingGroups}
          creating={creatingGroup}
          onCreateGroup={(name) => dashboardRef?.send({ type: "GROUP_CREATE_SUBMITTED", name })}
          onSelectGroup={(groupId) => dashboardRef?.send({ type: "GROUP_SELECTED", groupId })}
        />
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
          onSelectFeed={(feedId) => dashboardRef?.send({ type: "FEED_SELECTED", feedId })}
          onChangeFeedDate={(date) => dashboardRef?.send({ type: "FEED_DATE_CHANGED", date })}
          onToggleFeedEnabled={(feedId) => dashboardRef?.send({ type: "FEED_ENABLED_TOGGLED", feedId })}
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
          onUpdateFeedPost={(postId, payload) => dashboardRef?.send({ type: "POST_UPDATE_SUBMITTED", postId, payload })}
          onDeleteFeedPost={(postId) => dashboardRef?.send({ type: "POST_DELETE_SUBMITTED", postId })}
        />
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
