import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createGroup,
  createGroupDailyFeed,
  createGroupFeedPost,
  deleteGroupFeedPost,
  errorMessage,
  getGroupDailyFeedOutput,
  getGroupDailyFeedToday,
  getSession,
  isUnauthorized,
  listGroupCatalogSources,
  listGroupFeedPosts,
  listGroupDailyFeeds,
  listGroups,
  login,
  logout,
  previewGroupDailyFeed,
  signup,
  updateGroupDailyFeed,
  updateGroupFeedPost,
} from "./api";
import { AuthView } from "./components/AuthView";
import { GroupDashboard } from "./components/GroupDashboard";
import { GroupsPanel } from "./components/GroupsPanel";
import { Toast } from "./components/Toast";
import { todayDateValue } from "./dates";
import type {
  CatalogSource,
  CreateDailyFeedRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedPreview,
  Group,
  GroupFeedPost,
  LoginRequest,
  SignupRequest,
  User,
} from "./types";

type AuthStatus = "checking" | "anonymous" | "authenticated";

type LoadFeedOutputOptions = {
  groupId: string;
  feedId: string;
  date: string;
  useToday?: boolean;
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupCreating, setGroupCreating] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupFeeds, setGroupFeeds] = useState<DailyFeed[]>([]);
  const [groupFeedsLoading, setGroupFeedsLoading] = useState(false);
  const [groupFeedsError, setGroupFeedsError] = useState("");
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedFeedDate, setSelectedFeedDate] = useState(todayDateValue);
  const [selectedFeedOutput, setSelectedFeedOutput] = useState<DailyFeedOutput | null>(null);
  const [feedOutputLoading, setFeedOutputLoading] = useState(false);
  const [feedOutputError, setFeedOutputError] = useState("");
  const [feedPosts, setFeedPosts] = useState<GroupFeedPost[]>([]);
  const [feedPostsLoading, setFeedPostsLoading] = useState(false);
  const [feedPostsError, setFeedPostsError] = useState("");
  const [feedPostSubmitting, setFeedPostSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const groupRequestId = useRef(0);
  const feedOutputRequestId = useRef(0);
  const toastTimer = useRef<number | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId],
  );

  const resetAppState = useCallback(() => {
    setGroups([]);
    setGroupsLoading(false);
    setGroupCreating(false);
    setSelectedGroupId(null);
    setGroupFeeds([]);
    setGroupFeedsLoading(false);
    setGroupFeedsError("");
    setSelectedFeedId(null);
    setSelectedFeedDate(todayDateValue());
    setSelectedFeedOutput(null);
    setFeedOutputLoading(false);
    setFeedOutputError("");
    setFeedPosts([]);
    setFeedPostsLoading(false);
    setFeedPostsError("");
    setFeedPostSubmitting(false);
    groupRequestId.current += 1;
    feedOutputRequestId.current += 1;
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2400);
  }, []);

  const clearAuthenticatedState = useCallback(() => {
    resetAppState();
    setSessionUser(null);
    setAuthStatus("anonymous");
  }, [resetAppState]);

  const handleUnauthorized = useCallback(
    (error: unknown) => {
      if (!isUnauthorized(error)) {
        return false;
      }
      clearAuthenticatedState();
      setAuthError("");
      return true;
    },
    [clearAuthenticatedState],
  );

  const refreshGroups = useCallback(
    async (preferredGroupId?: string | null) => {
      setGroupsLoading(true);
      try {
        const nextGroups = await listGroups();
        const preferredSelectedId =
          preferredGroupId != null ? nextGroups.find((group) => group.id === preferredGroupId)?.id : undefined;
        const currentSelectedId =
          selectedGroupId !== null ? nextGroups.find((group) => group.id === selectedGroupId)?.id : undefined;
        const selected =
          preferredSelectedId ??
          currentSelectedId ??
          nextGroups.find((group) => group.my_status === "active")?.id ??
          nextGroups[0]?.id ??
          null;

        setGroups(nextGroups);
        setSelectedGroupId(selected);
      } catch (error) {
        if (!handleUnauthorized(error)) {
          showToast(errorMessage(error));
        }
      } finally {
        setGroupsLoading(false);
      }
    },
    [handleUnauthorized, selectedGroupId, showToast],
  );

  const loadFeedOutput = useCallback(
    async ({ groupId, feedId, date, useToday = false }: LoadFeedOutputOptions) => {
      const requestId = ++feedOutputRequestId.current;
      setFeedOutputLoading(true);
      setFeedOutputError("");
      setSelectedFeedOutput(null);
      setFeedPosts([]);
      setFeedPostsLoading(true);
      setFeedPostsError("");

      try {
        const output = useToday
          ? await getGroupDailyFeedToday(groupId, feedId)
          : await getGroupDailyFeedOutput(groupId, feedId, date);

        if (requestId !== feedOutputRequestId.current) {
          return;
        }

        setSelectedFeedOutput(output);
        setSelectedFeedDate(output.date || date);
        setFeedOutputLoading(false);

        try {
          const posts = await listGroupFeedPosts(groupId, feedId, output.date || date);
          if (requestId !== feedOutputRequestId.current) {
            return;
          }
          setFeedPosts(posts);
        } catch (error) {
          if (requestId !== feedOutputRequestId.current) {
            return;
          }
          if (!handleUnauthorized(error)) {
            setFeedPostsError(errorMessage(error));
          }
        }
      } catch (error) {
        if (requestId !== feedOutputRequestId.current) {
          return;
        }
        if (!handleUnauthorized(error)) {
          setFeedOutputError(errorMessage(error));
        }
      } finally {
        if (requestId === feedOutputRequestId.current) {
          setFeedOutputLoading(false);
          setFeedPostsLoading(false);
        }
      }
    },
    [handleUnauthorized],
  );

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const user = await getSession();
        if (cancelled) {
          return;
        }
        setSessionUser(user);
        setAuthStatus("authenticated");
      } catch {
        if (cancelled) {
          return;
        }
        clearAuthenticatedState();
      }
    }

    void boot();

    return () => {
      cancelled = true;
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, [clearAuthenticatedState]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    void refreshGroups();
  }, [authStatus, refreshGroups]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    const group = selectedGroup;
    const requestId = ++groupRequestId.current;
    feedOutputRequestId.current += 1;
    setGroupFeeds([]);
    setGroupFeedsError("");
    setSelectedFeedId(null);
    setSelectedFeedDate(todayDateValue());
    setSelectedFeedOutput(null);
    setFeedOutputError("");
    setFeedOutputLoading(false);
    setFeedPosts([]);
    setFeedPostsError("");
    setFeedPostsLoading(false);
    setFeedPostSubmitting(false);
    setGroupFeedsLoading(Boolean(group));

    if (!group) {
      setGroupFeedsLoading(false);
      return;
    }

    async function loadDashboardFeeds(currentGroup: Group) {
      try {
        const feeds = await listGroupDailyFeeds(currentGroup.id);
        if (requestId !== groupRequestId.current) {
          return;
        }

        setGroupFeeds(feeds);
        setGroupFeedsLoading(false);
        const firstFeed = feeds[0] ?? null;
        setSelectedFeedId(firstFeed?.id ?? null);
        setSelectedFeedDate(todayDateValue());

        if (firstFeed !== null) {
          await loadFeedOutput({
            groupId: currentGroup.id,
            feedId: firstFeed.id,
            date: todayDateValue(),
            useToday: true,
          });
        }
      } catch (error) {
        if (requestId !== groupRequestId.current) {
          return;
        }
        if (!handleUnauthorized(error)) {
          setGroupFeeds([]);
          setGroupFeedsLoading(false);
          setGroupFeedsError(errorMessage(error));
        }
      }
    }

    void loadDashboardFeeds(group);
  }, [authStatus, handleUnauthorized, loadFeedOutput, selectedGroup]);

  async function handleLogin(payload: LoginRequest) {
    try {
      const user = await login(payload);
      resetAppState();
      setAuthError("");
      setSessionUser(user);
      setAuthStatus("authenticated");
      showToast("Signed in");
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  async function handleSignup(payload: SignupRequest) {
    try {
      const user = await signup(payload);
      resetAppState();
      setAuthError("");
      setSessionUser(user);
      setAuthStatus("authenticated");
      showToast("Account created");
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      clearAuthenticatedState();
      showToast("Signed out");
    }
  }

  async function handleCreateGroup(name: string) {
    setGroupCreating(true);
    try {
      const group = await createGroup({ name });
      await refreshGroups(group.id);
      showToast("Group created");
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
    } finally {
      setGroupCreating(false);
    }
  }

  function handleSelectGroup(id: string) {
    setSelectedGroupId(id);
  }

  function handleSelectFeed(id: string) {
    if (!selectedGroup) {
      return;
    }
    if (selectedFeedId === id && selectedFeedOutput) {
      return;
    }

    const date = todayDateValue();
    setSelectedFeedId(id);
    setSelectedFeedDate(date);
    setSelectedFeedOutput(null);
    setFeedOutputError("");
    setFeedPosts([]);
    setFeedPostsError("");
    void loadFeedOutput({ groupId: selectedGroup.id, feedId: id, date, useToday: true });
  }

  function handleChangeFeedDate(date: string) {
    if (selectedGroup === null || selectedFeedId === null) {
      return;
    }

    setSelectedFeedDate(date);
    setSelectedFeedOutput(null);
    setFeedOutputError("");
    setFeedPosts([]);
    setFeedPostsError("");
    void loadFeedOutput({ groupId: selectedGroup.id, feedId: selectedFeedId, date });
  }

  async function handleToggleFeedEnabled(id: string) {
    if (!selectedGroup) {
      return;
    }

    const feed = groupFeeds.find((candidate) => candidate.id === id);
    if (!feed) {
      return;
    }

    try {
      const updated = await updateGroupDailyFeed(selectedGroup.id, feed.id, { enabled: !feed.enabled });
      setGroupFeeds((feeds) => feeds.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
      setSelectedFeedId(updated.id);
      showToast(updated.enabled ? "Feed enabled" : "Feed disabled");
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
    }
  }

  const handleLoadCatalogSources = useCallback(async (): Promise<CatalogSource[]> => {
    if (!selectedGroup) {
      return [];
    }
    try {
      return await listGroupCatalogSources(selectedGroup.id);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
      throw error;
    }
  }, [handleUnauthorized, selectedGroup, showToast]);

  async function handlePreviewFeed(payload: CreateDailyFeedRequest): Promise<DailyFeedPreview> {
    if (!selectedGroup) {
      throw new Error("No group selected");
    }
    try {
      return await previewGroupDailyFeed(selectedGroup.id, payload);
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
      throw error;
    }
  }

  async function handleCreateFeed(payload: CreateDailyFeedRequest): Promise<DailyFeed> {
    if (!selectedGroup) {
      throw new Error("No group selected");
    }
    try {
      const feed = await createGroupDailyFeed(selectedGroup.id, payload);
      setGroupFeeds((feeds) => [...feeds.filter((candidate) => candidate.id !== feed.id), feed]);
      setSelectedFeedId(feed.id);
      setSelectedFeedDate(todayDateValue());
      setSelectedFeedOutput(null);
      setFeedOutputError("");
      setFeedPosts([]);
      setFeedPostsError("");
      showToast("Feed created");
      void loadFeedOutput({
        groupId: selectedGroup.id,
        feedId: feed.id,
        date: todayDateValue(),
        useToday: true,
      });
      return feed;
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
      throw error;
    }
  }

  async function handleCreateFeedPost(payload: { evidenceText: string; caption: string }) {
    if (selectedGroup === null || selectedFeedId === null || selectedFeedOutput === null) {
      return false;
    }

    const requestId = feedOutputRequestId.current;
    const evidenceText = payload.evidenceText.trim();
    const caption = payload.caption.trim();
    if (!evidenceText) {
      return false;
    }

    setFeedPostSubmitting(true);
    try {
      const post = await createGroupFeedPost(selectedGroup.id, selectedFeedId, selectedFeedOutput.date, {
        evidence_kind: "text",
        evidence_text: evidenceText,
        ...(caption !== "" ? { caption } : {}),
      });
      if (requestId !== feedOutputRequestId.current) {
        return false;
      }
      setFeedPosts((posts) => [post, ...posts.filter((candidate) => candidate.id !== post.id)]);
      setFeedPostsError("");
      showToast("Post submitted");
      return true;
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
      return false;
    } finally {
      if (requestId === feedOutputRequestId.current) {
        setFeedPostSubmitting(false);
      }
    }
  }

  async function handleUpdateFeedPost(postId: string, payload: { evidenceText: string; caption: string }) {
    if (!selectedGroup) {
      return false;
    }

    const requestId = feedOutputRequestId.current;
    const evidenceText = payload.evidenceText.trim();
    const caption = payload.caption.trim();
    if (!evidenceText) {
      return false;
    }

    try {
      const post = await updateGroupFeedPost(selectedGroup.id, postId, {
        evidence_kind: "text",
        evidence_text: evidenceText,
        caption: caption !== "" ? caption : null,
      });
      if (requestId !== feedOutputRequestId.current) {
        return false;
      }
      setFeedPosts((posts) => posts.map((candidate) => (candidate.id === post.id ? post : candidate)));
      setFeedPostsError("");
      showToast("Post updated");
      return true;
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
      return false;
    }
  }

  async function handleDeleteFeedPost(postId: string) {
    if (!selectedGroup) {
      return false;
    }

    const requestId = feedOutputRequestId.current;
    try {
      await deleteGroupFeedPost(selectedGroup.id, postId);
      if (requestId !== feedOutputRequestId.current) {
        return false;
      }
      setFeedPosts((posts) => posts.filter((candidate) => candidate.id !== postId));
      setFeedPostsError("");
      showToast("Post deleted");
      return true;
    } catch (error) {
      if (!handleUnauthorized(error)) {
        showToast(errorMessage(error));
      }
      return false;
    }
  }

  if (authStatus === "checking") {
    return (
      <>
        <main className="auth-layout">
          <section className="panel auth-panel" aria-label="Authentication">
            <div className="empty-state">Checking session...</div>
          </section>
        </main>
        <Toast message={toastMessage} />
      </>
    );
  }

  if (authStatus === "anonymous") {
    return (
      <>
        <AuthView
          error={authError}
          onClearError={() => setAuthError("")}
          onLogin={handleLogin}
          onSignup={handleSignup}
        />
        <Toast message={toastMessage} />
      </>
    );
  }

  return (
    <>
      <header className="app-header">
        <div>
          <h1>Arcade</h1>
          {sessionUser ? <div className="header-user">{sessionUser.display_name}</div> : null}
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            void handleLogout();
          }}
        >
          Logout
        </button>
      </header>

      <main className="layout group-layout" aria-label="Arcade workspace">
        <GroupsPanel
          groups={groups}
          selectedGroupId={selectedGroupId}
          loading={groupsLoading}
          creating={groupCreating}
          onCreateGroup={handleCreateGroup}
          onSelectGroup={handleSelectGroup}
        />
        <GroupDashboard
          group={selectedGroup}
          feeds={groupFeeds}
          feedsLoading={groupFeedsLoading}
          feedsError={groupFeedsError}
          selectedFeedId={selectedFeedId}
          selectedFeedDate={selectedFeedDate}
          output={selectedFeedOutput}
          outputLoading={feedOutputLoading}
          outputError={feedOutputError}
          posts={feedPosts}
          postsLoading={feedPostsLoading}
          postsError={feedPostsError}
          postSubmitting={feedPostSubmitting}
          currentUserId={sessionUser?.id ?? null}
          onSelectFeed={handleSelectFeed}
          onChangeFeedDate={handleChangeFeedDate}
          onToggleFeedEnabled={handleToggleFeedEnabled}
          onLoadCatalogSources={handleLoadCatalogSources}
          onPreviewFeed={handlePreviewFeed}
          onCreateFeed={handleCreateFeed}
          onCreateFeedPost={handleCreateFeedPost}
          onUpdateFeedPost={handleUpdateFeedPost}
          onDeleteFeedPost={handleDeleteFeedPost}
        />
      </main>

      <Toast message={toastMessage} />
    </>
  );
}
