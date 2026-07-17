import { useCallback, useEffect, useState, type ReactNode } from "react";

import { isNotFound, isUnauthorized, joinGroup } from "../api";
import { queries } from "../cache/queries";
import { queryCache } from "../cache/queryCache";
import { errorMessage } from "../errors";
import { feedPath, publicRoutePath, signInPath } from "../routes";
import type {
  DailyFeed,
  DailyFeedOutput,
  DailyFeedOutputItem,
  Group,
  GroupFeedPost,
  GroupPostTag,
  PublicFeed,
  PublicFeedOutputItem,
  PublicGroup,
  PublicGroupFeed,
  PublicPost,
  PublicRoute,
} from "../types";
import { GroupDashboard } from "./GroupDashboard";

export type PublicPageProps = {
  route: PublicRoute;
  signedIn: boolean;
  currentUserId: string | null;
  onNavigate: (path: string, mode?: "push" | "replace") => void;
  onGroupJoined: ((group: Group) => void) | undefined;
  onUnauthorized: (() => void) | undefined;
};

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "not-found" }
  | { status: "error"; message: string };

type PublicPageActionProps = Pick<
  PublicPageProps,
  "currentUserId" | "onGroupJoined" | "onNavigate" | "onUnauthorized" | "route" | "signedIn"
>;

type PublicDashboardData = {
  group: Group;
  feeds: DailyFeed[];
  selectedFeedId: string | null;
  selectedFeedDate: string;
  output: DailyFeedOutput | null;
  posts: GroupFeedPost[];
};

const EMPTY_POSTS: GroupFeedPost[] = [];
const EMPTY_POST_TAGS: GroupPostTag[] = [];

export function PublicPage({
  route,
  signedIn,
  currentUserId,
  onNavigate,
  onGroupJoined,
  onUnauthorized,
}: PublicPageProps) {
  switch (route.kind) {
    case "group":
      return (
        <PublicGroupPage
          currentUserId={currentUserId}
          onGroupJoined={onGroupJoined}
          onNavigate={onNavigate}
          onUnauthorized={onUnauthorized}
          route={route}
          signedIn={signedIn}
          slug={route.slug}
        />
      );
    case "feed":
      return (
        <PublicFeedPage
          currentUserId={currentUserId}
          date={route.date}
          feedId={route.feedId}
          onGroupJoined={onGroupJoined}
          onNavigate={onNavigate}
          onUnauthorized={onUnauthorized}
          route={route}
          signedIn={signedIn}
        />
      );
    case "post":
      return (
        <PublicPostPage
          currentUserId={currentUserId}
          onGroupJoined={onGroupJoined}
          onNavigate={onNavigate}
          onUnauthorized={onUnauthorized}
          postId={route.postId}
          route={route}
          signedIn={signedIn}
        />
      );
  }
}

function PublicGroupPage({
  slug,
  signedIn,
  currentUserId,
  onNavigate,
  onGroupJoined,
  onUnauthorized,
  route,
}: {
  slug: string;
} & PublicPageActionProps) {
  const [state, setState] = useState<LoadState<PublicDashboardData>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    queryCache
      .read(queries.publicGroup, slug, { signal: controller.signal })
      .then(async (group) => {
        if (controller.signal.aborted) {
          return;
        }
        if (group.feeds.length === 0) {
          setState({ status: "ready", data: publicGroupToEmptyDashboard(group) });
          return;
        }

        const firstFeed = group.feeds[0];
        if (firstFeed === undefined) {
          setState({ status: "ready", data: publicGroupToEmptyDashboard(group) });
          return;
        }

        const feed = await readPublicFeed(firstFeed.id, null, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setState({ status: "ready", data: publicFeedToDashboard(feed, group) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState(isNotFound(error) ? { status: "not-found" } : { status: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [slug]);

  return (
    <PublicDashboardView
      currentUserId={currentUserId}
      onGroupJoined={onGroupJoined}
      onNavigate={onNavigate}
      onUnauthorized={onUnauthorized}
      route={route}
      signedIn={signedIn}
      state={state}
    />
  );
}

function PublicFeedPage({
  feedId,
  date,
  signedIn,
  currentUserId,
  onNavigate,
  onGroupJoined,
  onUnauthorized,
  route,
}: {
  feedId: string;
  date: string | null;
} & PublicPageActionProps) {
  const [state, setState] = useState<LoadState<PublicDashboardData>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    const request =
      date === null ? readPublicFeed(feedId, null, controller.signal) : readPublicFeed(feedId, date, controller.signal);

    request
      .then((feed) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", data: publicFeedToDashboard(feed) });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState(isNotFound(error) ? { status: "not-found" } : { status: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [date, feedId]);

  return (
    <PublicDashboardView
      currentUserId={currentUserId}
      onGroupJoined={onGroupJoined}
      onNavigate={onNavigate}
      onUnauthorized={onUnauthorized}
      route={route}
      signedIn={signedIn}
      state={state}
    />
  );
}

function PublicPostPage({
  postId,
  signedIn,
  currentUserId,
  onNavigate,
  onGroupJoined,
  onUnauthorized,
  route,
}: {
  postId: string;
} & PublicPageActionProps) {
  const [state, setState] = useState<LoadState<PublicDashboardData>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    queryCache
      .read(queries.publicPost, postId, { signal: controller.signal })
      .then(async (post) => {
        if (controller.signal.aborted) {
          return;
        }
        try {
          const feed = await readPublicFeed(post.feed.id, post.feed_date, controller.signal);
          if (!controller.signal.aborted) {
            setState({ status: "ready", data: publicFeedToDashboard(feed) });
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setState(
              isNotFound(error)
                ? { status: "ready", data: publicPostToDashboard(post) }
                : { status: "error", message: errorMessage(error) },
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState(isNotFound(error) ? { status: "not-found" } : { status: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [postId]);

  return (
    <PublicDashboardView
      currentUserId={currentUserId}
      onGroupJoined={onGroupJoined}
      onNavigate={onNavigate}
      onUnauthorized={onUnauthorized}
      route={route}
      signedIn={signedIn}
      state={state}
    />
  );
}

function PublicDashboardView({
  state,
  signedIn,
  currentUserId,
  onNavigate,
  onGroupJoined,
  onUnauthorized,
  route,
}: PublicPageActionProps & {
  state: LoadState<PublicDashboardData>;
}) {
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const selectedFeedId = state.status === "ready" ? state.data.selectedFeedId : null;
  const group = state.status === "ready" ? state.data.group : null;
  const loadFeedOutputSummaries = useCallback(
    (selectedDate: string, signal: AbortSignal) => {
      if (selectedFeedId === null) {
        return Promise.reject(new Error("No feed selected"));
      }
      return queryCache.read(queries.publicFeedOutputSummaries, selectedFeedId, selectedDate, { signal });
    },
    [selectedFeedId],
  );

  async function handleJoin() {
    if (group === null || currentUserId === null || joining) {
      return;
    }

    setJoining(true);
    setJoinError("");
    try {
      const joinedGroup = await joinGroup(group.id);
      queryCache.touched(["user", currentUserId, "groups"]);
      queryCache.touched(["user", currentUserId, "group", group.id]);
      queryCache.touched(["user", currentUserId, "me", "daily-feeds"]);
      queryCache.touched(["anon", "public", "group", group.slug]);
      if (selectedFeedId !== null) {
        queryCache.touched(["anon", "public", "feed", selectedFeedId]);
      }
      if (route.kind === "post") {
        queryCache.touched(["user", currentUserId, "me", "feed-post-route", route.postId]);
        queryCache.touched(["anon", "public", "post", route.postId]);
      }
      onGroupJoined?.(joinedGroup);
    } catch (error) {
      setJoining(false);
      if (isUnauthorized(error)) {
        onUnauthorized?.();
        return;
      }
      setJoinError(errorMessage(error));
    }
  }

  const postAccessPrompt =
    group?.join_policy === "open" ? (
      <div className="post-access-status">
        {signedIn ? (
          <button
            className="secondary feed-post-button"
            disabled={joining || currentUserId === null}
            type="button"
            onClick={() => void handleJoin()}
          >
            {joining ? "Joining..." : "Join to post"}
          </button>
        ) : (
          <a className="post-access-link" href={signInPath(publicRoutePath(route))}>
            Sign in to post
          </a>
        )}
        <span className="meta">
          {signedIn ? "You’ll join this open group as a member." : "Sign in, then join this open group as a member."}
        </span>
        {joinError !== "" ? (
          <span className="form-error" role="alert">
            {joinError}
          </span>
        ) : null}
      </div>
    ) : undefined;

  return (
    <PublicShell returnPath={publicRoutePath(route)} signedIn={signedIn}>
      {state.status === "loading" ? <PublicStatusPanel>Loading...</PublicStatusPanel> : null}
      {state.status === "not-found" ? <PublicStatusPanel>This public page was not found.</PublicStatusPanel> : null}
      {state.status === "error" ? (
        <PublicStatusPanel>
          <div className="form-error" role="alert">
            {state.message}
          </div>
        </PublicStatusPanel>
      ) : null}
      {state.status === "ready" ? (
        <GroupDashboard
          addFeedError=""
          addFeedOpen={false}
          addFeedPreview={null}
          addFeedPreviewLoading={false}
          addFeedSaving={false}
          addFeedEvidenceFormats={[]}
          addFeedSources={[]}
          addFeedSourcesLoading={false}
          currentUserId={null}
          deletingPostId={null}
          feeds={state.data.feeds}
          group={state.data.group}
          judgingPostId={null}
          leaderboardLoading={false}
          loadFeedOutputSummaries={loadFeedOutputSummaries}
          metricLeaderboard={null}
          metrics={[]}
          metricsError=""
          metricsLoading={false}
          onAddFeedDraftChanged={noop}
          onChangeFeedDate={(date) => {
            if (state.data.selectedFeedId !== null) {
              onNavigate(feedPath(state.data.selectedFeedId, date));
            }
          }}
          onCloseAddFeed={noop}
          onCreateFeed={noop}
          onCreateFeedPost={noop}
          onCreateMetricJudgment={noop}
          onDeleteFeedPost={noop}
          onPreviewFeed={noop}
          onSelectFeed={(feedId) => onNavigate(feedPath(feedId))}
          onSelectMetric={noop}
          onUpdateFeedPost={noop}
          output={state.data.output}
          outputError=""
          outputLoading={false}
          postSubmitting={false}
          postAccessPrompt={postAccessPrompt}
          postTags={EMPTY_POST_TAGS}
          posts={state.data.posts}
          postsError=""
          postsLoading={false}
          readOnly
          selectedFeedDate={state.data.selectedFeedDate}
          selectedFeedId={state.data.selectedFeedId}
          selectedMetricId={null}
          standalone
          updatingPostId={null}
        />
      ) : null}
    </PublicShell>
  );
}

function PublicShell({
  children,
  signedIn,
  returnPath,
}: {
  children: ReactNode;
  signedIn: boolean;
  returnPath: string;
}) {
  return (
    <>
      <header className="app-header">
        <div>
          <h1>
            <a className="app-title-link" href="/">
              Arcade
            </a>
          </h1>
          <div className="header-user">Public view</div>
        </div>
        <a className="header-link-button" href={signedIn ? "/" : signInPath(returnPath)}>
          {signedIn ? "Open app" : "Sign in"}
        </a>
      </header>
      <main className="layout group-layout public-route-layout" aria-label="Arcade workspace">
        {children}
      </main>
    </>
  );
}

async function readPublicFeed(feedId: string, date: string | null, signal: AbortSignal): Promise<PublicFeed> {
  const feed = await queryCache.read(queries.publicFeed, feedId, date, { signal });
  queryCache.write(queries.publicFeed, feed, feedId, feed.date);
  return feed;
}

function PublicStatusPanel({ children }: { children: ReactNode }) {
  return (
    <section className="panel group-dashboard-panel">
      <div className="empty-state">{children}</div>
    </section>
  );
}

function publicGroupToEmptyDashboard(group: PublicGroup): PublicDashboardData {
  return {
    group: publicGroupToGroup(group),
    feeds: [],
    selectedFeedId: null,
    selectedFeedDate: "",
    output: null,
    posts: EMPTY_POSTS,
  };
}

function publicFeedToDashboard(feed: PublicFeed, group?: PublicGroup): PublicDashboardData {
  const feeds =
    group === undefined
      ? [publicFeedToDailyFeed(feed)]
      : group.feeds.map((candidate) => publicGroupFeedToDailyFeed(group, candidate));

  return {
    group: group === undefined ? publicFeedGroupToGroup(feed) : publicGroupToGroup(group),
    feeds,
    selectedFeedId: feed.id,
    selectedFeedDate: feed.date,
    output: publicFeedToOutput(feed),
    posts: feed.posts.map(publicPostToGroupPost),
  };
}

function publicPostToDashboard(post: PublicPost): PublicDashboardData {
  const feed = publicPostFeedToDailyFeed(post);
  return {
    group: publicParentGroupToGroup(post.group, post.created_at, post.updated_at),
    feeds: [feed],
    selectedFeedId: feed.id,
    selectedFeedDate: post.feed_date,
    output: {
      feed_id: post.feed.id,
      group_id: post.group.id,
      group_name: post.group.name,
      date: post.feed_date,
      title: post.feed.name,
      items: [],
    },
    posts: [publicPostToGroupPost(post)],
  };
}

function publicGroupToGroup(group: PublicGroup): Group {
  const converted: Group = {
    id: group.id,
    name: group.name,
    slug: group.slug,
    visibility: group.visibility,
    join_policy: group.join_policy,
    created_by_user_id: "",
    created_at: group.created_at,
    updated_at: group.updated_at,
  };
  if (group.description !== undefined) {
    converted.description = group.description;
  }
  return converted;
}

function publicFeedGroupToGroup(feed: PublicFeed): Group {
  return publicParentGroupToGroup(feed.group, feed.created_at, feed.updated_at);
}

function publicParentGroupToGroup(group: PublicFeed["group"], createdAt: string, updatedAt: string): Group {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    visibility: group.visibility,
    join_policy: group.join_policy,
    created_by_user_id: "",
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function publicGroupFeedToDailyFeed(group: PublicGroup, feed: PublicGroupFeed): DailyFeed {
  const converted: DailyFeed = {
    id: feed.id,
    group_id: group.id,
    group_name: group.name,
    name: feed.name,
    slug: feed.slug,
    kind: feed.kind,
    enabled: feed.enabled,
    captions_enabled: feed.captions_enabled,
    evidence_format: feed.evidence_format,
    schedule: feed.schedule,
    filters: [],
    created_at: feed.created_at,
    updated_at: feed.updated_at,
  };
  if (feed.description !== undefined) {
    converted.description = feed.description;
  }
  return converted;
}

function publicFeedToDailyFeed(feed: PublicFeed): DailyFeed {
  const converted: DailyFeed = {
    id: feed.id,
    group_id: feed.group.id,
    group_name: feed.group.name,
    name: feed.name,
    slug: feed.slug,
    kind: feed.kind,
    enabled: feed.enabled,
    captions_enabled: feed.captions_enabled,
    evidence_format: feed.evidence_format,
    schedule: feed.schedule,
    filters: [],
    created_at: feed.created_at,
    updated_at: feed.updated_at,
  };
  if (feed.description !== undefined) {
    converted.description = feed.description;
  }
  return converted;
}

function publicPostFeedToDailyFeed(post: PublicPost): DailyFeed {
  return {
    id: post.feed.id,
    group_id: post.group.id,
    group_name: post.group.name,
    name: post.feed.name,
    slug: post.feed.id,
    kind: "daily_thread",
    enabled: false,
    captions_enabled: false,
    evidence_format: post.evidence_format,
    schedule: {
      starts_at: `${post.feed_date}T00:00:00Z`,
      timezone: "UTC",
      interval_seconds: 86400,
    },
    filters: [],
    created_at: post.created_at,
    updated_at: post.updated_at,
  };
}

function publicFeedToOutput(feed: PublicFeed): DailyFeedOutput {
  return {
    feed_id: feed.id,
    group_id: feed.group.id,
    group_name: feed.group.name,
    date: feed.date,
    title: feed.name,
    items: feed.items.map((item) => publicOutputItemToDailyItem(feed, item)),
  };
}

function publicOutputItemToDailyItem(feed: PublicFeed, item: PublicFeedOutputItem): DailyFeedOutputItem {
  const action =
    item.action.type === "link"
      ? {
          type: "external_url" as const,
          label: item.action.label,
          ...(item.action.url !== undefined ? { url: item.action.url } : {}),
        }
      : {
          type: "text" as const,
          label: item.action.label,
          ...(item.action.text !== undefined ? { text: item.action.text } : {}),
        };

  return {
    position: item.position,
    role: `public-${item.position}`,
    points: 1,
    reason: "",
    item: {
      id: `${feed.id}:${item.position}`,
      source_id: "",
      source_name: feed.name,
      title: item.title,
      data: {
        name: item.title,
      },
    },
    action,
  };
}

function publicPostToGroupPost(post: PublicPost): GroupFeedPost {
  const converted: GroupFeedPost = {
    id: post.id,
    group_id: post.group.id,
    feed_instance_id: `${post.feed.id}:${post.feed_date}`,
    feed_id: post.feed.id,
    feed_date: post.feed_date,
    author_user_id: post.author.id,
    author_username: post.author.username,
    author_display_name: post.author.display_name,
    evidence_text: post.evidence_text,
    evidence_format: post.evidence_format,
    evidence_format_version: post.evidence_format_version,
    tags: post.tags.map((tag, index) => ({
      id: tag.id,
      group_id: post.group.id,
      name: tag.name,
      display_order: index,
      created_at: post.created_at,
      updated_at: post.updated_at,
    })),
    created_at: post.created_at,
    updated_at: post.updated_at,
  };
  if (post.author.avatar_url !== undefined) {
    converted.author_avatar_url = post.author.avatar_url;
  }
  if (post.caption !== undefined) {
    converted.caption = post.caption;
  }
  return converted;
}

function noop() {
  return undefined;
}
