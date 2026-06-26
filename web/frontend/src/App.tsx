import { useEffect, useMemo } from "react";
import { useMachine } from "@xstate/react";

import { AuthView } from "./components/AuthView";
import { GroupDashboard } from "./components/GroupDashboard";
import { GroupsPanel } from "./components/GroupsPanel";
import { Toast } from "./components/Toast";
import { appMachine } from "./machines/appMachine";

export default function App() {
  const [snapshot, send] = useMachine(appMachine);
  const { context } = snapshot;
  const stateValue = snapshot.value;
  const checkingSession = matchesTopState(stateValue, "checkingSession");
  const signedOut = matchesTopState(stateValue, "signedOut");
  const loggingIn = matchesChildState(stateValue, "signedOut", "loggingIn");
  const signingUp = matchesChildState(stateValue, "signedOut", "signingUp");
  const loadingGroups = matchesChildState(stateValue, "signedIn", "loadingGroups");
  const creatingGroup = matchesChildState(stateValue, "signedIn", "creatingGroup");
  const loadingFeeds = matchesChildState(stateValue, "signedIn", "loadingFeeds");
  const loadingTodayOutput = matchesChildState(stateValue, "signedIn", "loadingTodayOutput");
  const loadingDatedOutput = matchesChildState(stateValue, "signedIn", "loadingDatedOutput");
  const loadingPosts = matchesChildState(stateValue, "signedIn", "loadingPosts");
  const creatingPost = matchesChildState(stateValue, "signedIn", "creatingPost");
  const addFeedLoadingSources = matchesChildState(stateValue, "signedIn", "addFeedLoadingSources");
  const addFeedPreviewing = matchesChildState(stateValue, "signedIn", "addFeedPreviewing");
  const addFeedCreating = matchesChildState(stateValue, "signedIn", "addFeedCreating");

  useEffect(() => {
    if (context.toastMessage === null) {
      return undefined;
    }

    const timer = window.setTimeout(() => send({ type: "TOAST_DISMISSED" }), 2400);
    return () => window.clearTimeout(timer);
  }, [context.toastMessage, send]);

  const selectedGroup = useMemo(
    () => context.groups.find((group) => group.id === context.selectedGroupId) || null,
    [context.groups, context.selectedGroupId],
  );

  const postMutation = context.postMutation;
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
          {context.user ? <div className="header-user">{context.user.display_name}</div> : null}
        </div>
        <button className="secondary" type="button" onClick={() => send({ type: "LOGOUT_REQUESTED" })}>
          Logout
        </button>
      </header>

      <main className="layout group-layout" aria-label="Arcade workspace">
        <GroupsPanel
          groups={context.groups}
          selectedGroupId={context.selectedGroupId}
          loading={loadingGroups}
          creating={creatingGroup}
          onCreateGroup={(name) => send({ type: "GROUP_CREATE_SUBMITTED", name })}
          onSelectGroup={(groupId) => send({ type: "GROUP_SELECTED", groupId })}
        />
        <GroupDashboard
          group={selectedGroup}
          feeds={context.feeds}
          feedsLoading={loadingFeeds}
          feedsError={context.feedsError}
          selectedFeedId={context.selectedFeedId}
          selectedFeedDate={context.selectedFeedDate}
          output={context.output}
          outputLoading={loadingTodayOutput || loadingDatedOutput}
          outputError={context.outputError}
          posts={context.posts}
          postsLoading={loadingPosts}
          postsError={context.postsError}
          postSubmitting={creatingPost}
          updatingPostId={updatingPostId}
          deletingPostId={deletingPostId}
          currentUserId={context.user?.id ?? null}
          addFeedOpen={context.addFeedOpen}
          addFeedSources={context.addFeedSources}
          addFeedSourcesLoading={addFeedLoadingSources}
          addFeedPreview={context.addFeedPreview}
          addFeedPreviewLoading={addFeedPreviewing}
          addFeedSaving={addFeedCreating}
          addFeedError={context.addFeedError}
          onSelectFeed={(feedId) => send({ type: "FEED_SELECTED", feedId })}
          onChangeFeedDate={(date) => send({ type: "FEED_DATE_CHANGED", date })}
          onToggleFeedEnabled={(feedId) => send({ type: "FEED_ENABLED_TOGGLED", feedId })}
          onOpenAddFeed={() => send({ type: "ADD_FEED_OPENED" })}
          onCloseAddFeed={() => send({ type: "ADD_FEED_CLOSED" })}
          onAddFeedDraftChanged={() => send({ type: "ADD_FEED_DRAFT_CHANGED" })}
          onPreviewFeed={(payload) => send({ type: "ADD_FEED_PREVIEW_SUBMITTED", payload })}
          onCreateFeed={(payload) => send({ type: "ADD_FEED_CREATE_SUBMITTED", payload })}
          onCreateFeedPost={(payload) => send({ type: "POST_CREATE_SUBMITTED", payload })}
          onUpdateFeedPost={(postId, payload) => send({ type: "POST_UPDATE_SUBMITTED", postId, payload })}
          onDeleteFeedPost={(postId) => send({ type: "POST_DELETE_SUBMITTED", postId })}
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

function isStateObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
