import { useEffect, useState, type ReactNode } from "react";

import { getPublicFeed, getPublicFeedOutput, getPublicGroup, getPublicPost, isNotFound } from "../api";
import { errorMessage } from "../errors";
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

type PublicPageProps = {
  route: PublicRoute;
  signedIn: boolean;
  onCopyPublicPostLink: (postId: string) => void;
  onNavigate: (path: string, mode?: "push" | "replace") => void;
};

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "not-found" }
  | { status: "error"; message: string };

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

export function PublicPage({ route, signedIn, onCopyPublicPostLink, onNavigate }: PublicPageProps) {
  switch (route.kind) {
    case "group":
      return (
        <PublicGroupPage
          onCopyPublicPostLink={onCopyPublicPostLink}
          onNavigate={onNavigate}
          signedIn={signedIn}
          slug={route.slug}
        />
      );
    case "feed":
      return (
        <PublicFeedPage
          date={route.date}
          feedId={route.feedId}
          onCopyPublicPostLink={onCopyPublicPostLink}
          onNavigate={onNavigate}
          signedIn={signedIn}
        />
      );
    case "post":
      return (
        <PublicPostPage
          onCopyPublicPostLink={onCopyPublicPostLink}
          onNavigate={onNavigate}
          postId={route.postId}
          signedIn={signedIn}
        />
      );
  }
}

function PublicGroupPage({
  slug,
  signedIn,
  onCopyPublicPostLink,
  onNavigate,
}: {
  slug: string;
  signedIn: boolean;
  onCopyPublicPostLink: (postId: string) => void;
  onNavigate: (path: string, mode?: "push" | "replace") => void;
}) {
  const [state, setState] = useState<LoadState<PublicDashboardData>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    getPublicGroup(slug, { signal: controller.signal })
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

        const feed = await getPublicFeed(firstFeed.id, { signal: controller.signal });
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
      onCopyPublicPostLink={onCopyPublicPostLink}
      onNavigate={onNavigate}
      signedIn={signedIn}
      state={state}
    />
  );
}

function PublicFeedPage({
  feedId,
  date,
  signedIn,
  onCopyPublicPostLink,
  onNavigate,
}: {
  feedId: string;
  date: string | null;
  signedIn: boolean;
  onCopyPublicPostLink: (postId: string) => void;
  onNavigate: (path: string, mode?: "push" | "replace") => void;
}) {
  const [state, setState] = useState<LoadState<PublicDashboardData>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    const request =
      date === null
        ? getPublicFeed(feedId, { signal: controller.signal })
        : getPublicFeedOutput(feedId, date, { signal: controller.signal });

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
      onCopyPublicPostLink={onCopyPublicPostLink}
      onNavigate={onNavigate}
      signedIn={signedIn}
      state={state}
    />
  );
}

function PublicPostPage({
  postId,
  signedIn,
  onCopyPublicPostLink,
  onNavigate,
}: {
  postId: string;
  signedIn: boolean;
  onCopyPublicPostLink: (postId: string) => void;
  onNavigate: (path: string, mode?: "push" | "replace") => void;
}) {
  const [state, setState] = useState<LoadState<PublicDashboardData>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    getPublicPost(postId, { signal: controller.signal })
      .then(async (post) => {
        if (controller.signal.aborted) {
          return;
        }
        try {
          const feed = await getPublicFeedOutput(post.feed.id, post.feed_date, { signal: controller.signal });
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
      onCopyPublicPostLink={onCopyPublicPostLink}
      onNavigate={onNavigate}
      signedIn={signedIn}
      state={state}
    />
  );
}

function PublicDashboardView({
  state,
  signedIn,
  onCopyPublicPostLink,
  onNavigate,
}: {
  state: LoadState<PublicDashboardData>;
  signedIn: boolean;
  onCopyPublicPostLink: (postId: string) => void;
  onNavigate: (path: string, mode?: "push" | "replace") => void;
}) {
  return (
    <PublicShell signedIn={signedIn}>
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
          addFeedSources={[]}
          addFeedSourcesLoading={false}
          currentUserId={null}
          deletingMetricId={null}
          deletingPostId={null}
          feeds={state.data.feeds}
          group={state.data.group}
          judgingPostId={null}
          leaderboardLoading={false}
          metricLeaderboard={null}
          metricSubmitting={false}
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
          onCopyPublicPostLink={onCopyPublicPostLink}
          onCreateFeed={noop}
          onCreateFeedPost={noop}
          onCreateMetric={noop}
          onCreateMetricJudgment={noop}
          onDeleteFeedPost={noop}
          onDeleteMetric={noop}
          onPreviewFeed={noop}
          onSelectFeed={(feedId) => onNavigate(feedPath(feedId))}
          onSelectMetric={noop}
          onUpdateFeedPost={noop}
          onUpdateMetric={noop}
          output={state.data.output}
          outputError=""
          outputLoading={false}
          postSubmitting={false}
          postTags={EMPTY_POST_TAGS}
          posts={state.data.posts}
          postsError=""
          postsLoading={false}
          readOnly
          selectedFeedDate={state.data.selectedFeedDate}
          selectedFeedId={state.data.selectedFeedId}
          selectedMetricId={null}
          standalone
          updatingMetricId={null}
          updatingPostId={null}
        />
      ) : null}
    </PublicShell>
  );
}

function PublicShell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
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
        <a className="header-link-button" href="/">
          {signedIn ? "Open app" : "Sign in"}
        </a>
      </header>
      <main className="layout group-layout public-route-layout" aria-label="Arcade workspace">
        {children}
      </main>
    </>
  );
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
    evidence_kind: post.evidence_kind,
    evidence_text: post.evidence_text,
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

function feedPath(feedId: string, date: string | null = null): string {
  const encodedFeedId = encodeURIComponent(feedId);
  return date === null || date === "" ? `/f/${encodedFeedId}` : `/f/${encodedFeedId}/${encodeURIComponent(date)}`;
}

function noop() {
  return undefined;
}
