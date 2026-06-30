import { useEffect, useState, type ReactNode } from "react";

import { getPublicFeed, getPublicFeedOutput, getPublicGroup, getPublicPost, isNotFound } from "../api";
import { formatDateLabel } from "../dates";
import { errorMessage } from "../errors";
import type { PublicFeed, PublicFeedOutputItem, PublicGroup, PublicPost, PublicRoute } from "../types";

type PublicPageProps = {
  route: PublicRoute;
  signedIn: boolean;
};

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "not-found" }
  | { status: "error"; message: string };

export function PublicPage({ route, signedIn }: PublicPageProps) {
  switch (route.kind) {
    case "group":
      return <PublicGroupPage signedIn={signedIn} slug={route.slug} />;
    case "feed":
      return <PublicFeedPage date={route.date} feedId={route.feedId} signedIn={signedIn} />;
    case "post":
      return <PublicPostPage postId={route.postId} signedIn={signedIn} />;
  }
}

function PublicGroupPage({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  const [state, setState] = useState<LoadState<PublicGroup>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getPublicGroup(slug, { signal: controller.signal })
      .then((group) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", data: group });
        }
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
    <PublicShell signedIn={signedIn}>
      {state.status === "loading" ? <PublicLoading label="Loading group..." /> : null}
      {state.status === "not-found" ? <PublicNotFound /> : null}
      {state.status === "error" ? <PublicError message={state.message} /> : null}
      {state.status === "ready" ? (
        <section className="public-page" aria-label="Public group">
          <header className="public-page-header">
            <div>
              <h2>{state.data.name}</h2>
              {state.data.description !== undefined ? <p>{state.data.description}</p> : null}
            </div>
          </header>
          <section className="public-section" aria-label="Public feeds">
            <div className="section-title">Public feeds</div>
            {state.data.feeds.length === 0 ? <div className="empty-state">No public feeds.</div> : null}
            {state.data.feeds.length > 0 ? (
              <div className="stack">
                {state.data.feeds.map((feed) => (
                  <a className="public-list-link" href={`/f/${encodeURIComponent(feed.id)}`} key={feed.id}>
                    <span className="title">{feed.name}</span>
                    {feed.description !== undefined ? <span className="meta">{feed.description}</span> : null}
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        </section>
      ) : null}
    </PublicShell>
  );
}

function PublicFeedPage({ feedId, date, signedIn }: { feedId: string; date: string | null; signedIn: boolean }) {
  const [state, setState] = useState<LoadState<PublicFeed>>({ status: "loading" });

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
          setState({ status: "ready", data: feed });
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
    <PublicShell signedIn={signedIn}>
      {state.status === "loading" ? <PublicLoading label="Loading feed..." /> : null}
      {state.status === "not-found" ? <PublicNotFound /> : null}
      {state.status === "error" ? <PublicError message={state.message} /> : null}
      {state.status === "ready" ? <PublicFeedArticle feed={state.data} /> : null}
    </PublicShell>
  );
}

function PublicPostPage({ postId, signedIn }: { postId: string; signedIn: boolean }) {
  const [state, setState] = useState<LoadState<PublicPost>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getPublicPost(postId, { signal: controller.signal })
      .then((post) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", data: post });
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
    <PublicShell signedIn={signedIn}>
      {state.status === "loading" ? <PublicLoading label="Loading post..." /> : null}
      {state.status === "not-found" ? <PublicNotFound /> : null}
      {state.status === "error" ? <PublicError message={state.message} /> : null}
      {state.status === "ready" ? (
        <section className="public-page" aria-label="Public post">
          <PublicPostCard post={state.data} />
        </section>
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
      <main className="public-layout" aria-label="Public page">
        {children}
      </main>
    </>
  );
}

function PublicFeedArticle({ feed }: { feed: PublicFeed }) {
  const showGroupLink = feed.group.visibility === "public";
  return (
    <section className="public-page" aria-label="Public feed">
      <header className="public-page-header">
        <div>
          <h2>{feed.name}</h2>
          <div className="meta">
            {showGroupLink ? (
              <a href={`/g/${encodeURIComponent(feed.group.slug)}`}>{feed.group.name}</a>
            ) : (
              feed.group.name
            )}{" "}
            · {formatDateLabel(feed.date)}
          </div>
          {feed.description !== undefined ? <p>{feed.description}</p> : null}
        </div>
      </header>
      <section className="public-section" aria-label="Feed output">
        <div className="section-title">Output</div>
        {feed.items.length === 0 ? <div className="empty-state">No generated items for this date.</div> : null}
        {feed.items.length > 0 ? (
          <div className="stack">
            {feed.items.map((item) => (
              <PublicOutputItem item={item} key={item.position} />
            ))}
          </div>
        ) : null}
      </section>
      <section className="public-section" aria-label="Public posts">
        <div className="section-title">Posts</div>
        {feed.posts.length === 0 ? <div className="empty-state">No public posts.</div> : null}
        {feed.posts.length > 0 ? (
          <div className="stack">
            {feed.posts.map((post) => (
              <PublicPostCard post={post} key={post.id} compact />
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function PublicOutputItem({ item }: { item: PublicFeedOutputItem }) {
  return (
    <div className="public-output-item">
      <div className="title">{item.title}</div>
      {item.action.type === "link" && item.action.url !== undefined ? (
        <a href={item.action.url} target="_blank" rel="noreferrer">
          {item.action.label || "Open"}
        </a>
      ) : null}
      {item.action.type === "text" && item.action.text !== undefined ? (
        <details className="prompt-details">
          <summary>{item.action.label || "Prompt"}</summary>
          <pre>{item.action.text}</pre>
        </details>
      ) : null}
    </div>
  );
}

function PublicPostCard({ post, compact = false }: { post: PublicPost; compact?: boolean }) {
  return (
    <section className="public-post-card" aria-label={compact ? `Post by ${publicUserName(post.author)}` : undefined}>
      <div className="post-card-header">
        <div>
          <div className="title">{publicUserName(post.author)}</div>
          <div className="meta">
            {post.feed.name} · {formatDateLabel(post.feed_date)}
          </div>
        </div>
        {compact ? (
          <a className="public-post-link" href={`/p/${encodeURIComponent(post.id)}`}>
            Open post
          </a>
        ) : null}
      </div>
      <pre className="post-evidence-code">{post.evidence_text}</pre>
      {post.caption !== undefined && post.caption !== "" ? <div className="post-caption">{post.caption}</div> : null}
      {post.tags.length > 0 ? (
        <div className="post-tag-list" aria-label="Post tags">
          {post.tags.map((tag) => (
            <span className="post-tag-pill" key={tag.id}>
              {tag.name}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PublicLoading({ label }: { label: string }) {
  return <div className="empty-state">{label}</div>;
}

function PublicNotFound() {
  return <div className="empty-state">This public page was not found.</div>;
}

function PublicError({ message }: { message: string }) {
  return (
    <div className="form-error" role="alert">
      {message}
    </div>
  );
}

function publicUserName(user: PublicPost["author"]): string {
  return user.display_name || user.username;
}
