import { FormEvent, useState } from "react";

import { feedDateOptions, formatDateLabel } from "../dates";
import type {
  DailyFeed,
  DailyFeedAction,
  DailyFeedOutput,
  DailyFeedOutputItem,
  Group,
  GroupFeedPost,
} from "../types";

type GroupDashboardProps = {
  group: Group | null;
  feeds: DailyFeed[];
  feedsLoading: boolean;
  feedsError: string;
  selectedFeedId: string | null;
  selectedFeedDate: string;
  output: DailyFeedOutput | null;
  outputLoading: boolean;
  outputError: string;
  posts: GroupFeedPost[];
  postsLoading: boolean;
  postsError: string;
  postSubmitting: boolean;
  currentUserId: string | null;
  onSelectFeed: (id: string) => void;
  onChangeFeedDate: (date: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => Promise<boolean>;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => Promise<boolean>;
  onDeleteFeedPost: (postId: string) => Promise<boolean>;
};

export function GroupDashboard({
  group,
  feeds,
  feedsLoading,
  feedsError,
  selectedFeedId,
  selectedFeedDate,
  output,
  outputLoading,
  outputError,
  posts,
  postsLoading,
  postsError,
  postSubmitting,
  currentUserId,
  onSelectFeed,
  onChangeFeedDate,
  onToggleFeedEnabled,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
}: GroupDashboardProps) {
  if (!group) {
    return (
      <section className="panel group-dashboard-panel">
        <div className="empty-state">
          <div className="title">No group selected</div>
          <div className="meta">Create or open a group to view feeds.</div>
        </div>
      </section>
    );
  }

  const manage = canManageGroup(group);
  const feed = feeds.find((candidate) => candidate.id === selectedFeedId) || null;

  return (
    <section className="panel group-dashboard-panel">
      <div className="dashboard-grid">
        <section className="dashboard-section feeds-section" aria-label="Feeds">
          <FeedList
            feeds={feeds}
            loading={feedsLoading}
            error={feedsError}
            manage={manage}
            selectedFeedId={selectedFeedId}
            onSelectFeed={onSelectFeed}
          />
        </section>

        <section className="dashboard-section feed-output-section" aria-label="Selected feed output">
          {feed ? (
            <div className="output-actions feed-output-toolbar">
              {manage ? (
                <button
                  className="secondary"
                  type="button"
                  aria-label={feed.enabled ? "Disable feed" : "Enable feed"}
                  onClick={() => onToggleFeedEnabled(feed.id)}
                >
                  Manage
                </button>
              ) : null}
              <label className="date-control">
                Date
                <select value={selectedFeedDate} onChange={(event) => onChangeFeedDate(event.target.value)}>
                  {feedDateOptions(selectedFeedDate).map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <FeedOutput
            feed={feed}
            output={output}
            loading={outputLoading}
            error={outputError}
            posts={posts}
            postsLoading={postsLoading}
            postsError={postsError}
            postSubmitting={postSubmitting}
            currentUserId={currentUserId}
            onCreateFeedPost={onCreateFeedPost}
            onUpdateFeedPost={onUpdateFeedPost}
            onDeleteFeedPost={onDeleteFeedPost}
          />
        </section>
      </div>
    </section>
  );
}

function FeedList({
  feeds,
  loading,
  error,
  manage,
  selectedFeedId,
  onSelectFeed,
}: {
  feeds: DailyFeed[];
  loading: boolean;
  error: string;
  manage: boolean;
  selectedFeedId: string | null;
  onSelectFeed: (id: string) => void;
}) {
  if (loading) {
    return <div className="empty-state">Loading feeds...</div>;
  }
  if (error) {
    return (
      <div className="form-error" role="alert">
        {error}
      </div>
    );
  }
  if (!feeds.length) {
    return <div className="empty-state">{manage ? "No feeds yet." : "No feeds are available for this group."}</div>;
  }

  return (
    <div className="stack">
      {feeds.map((feed) => {
        const selected = feed.id === selectedFeedId;

        return (
          <button
            aria-pressed={selected}
            className={`row selectable-row feed-row ${selected ? "selected-row" : ""}`}
            key={feed.id}
            type="button"
            onClick={() => onSelectFeed(feed.id)}
          >
            <div className="title">{feed.name}</div>
            {!feed.enabled ? <div className="meta">Disabled</div> : null}
          </button>
        );
      })}
    </div>
  );
}

function FeedOutput({
  feed,
  output,
  loading,
  error,
  posts,
  postsLoading,
  postsError,
  postSubmitting,
  currentUserId,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
}: {
  feed: DailyFeed | null;
  output: DailyFeedOutput | null;
  loading: boolean;
  error: string;
  posts: GroupFeedPost[];
  postsLoading: boolean;
  postsError: string;
  postSubmitting: boolean;
  currentUserId: string | null;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => Promise<boolean>;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => Promise<boolean>;
  onDeleteFeedPost: (postId: string) => Promise<boolean>;
}) {
  if (!feed) {
    return <div className="empty-state">Select a feed to view its daily output.</div>;
  }
  if (loading) {
    return <div className="empty-state">Loading output...</div>;
  }
  if (error) {
    return (
      <div className="form-error" role="alert">
        {error}
      </div>
    );
  }
  if (!output) {
    return <div className="empty-state">No output loaded.</div>;
  }
  const items = output.items || [];
  const isDailyThread = feed.kind === "daily_thread";

  return (
    <>
      <div className="output-summary">
        <div className="title">{output.title}</div>
        <div className="meta">{formatDateLabel(output.date)}</div>
      </div>
      {items.length ? (
        <div className="stack output-items">
          {items.map((item) => (
            <OutputItem item={item} key={`${item.position}-${item.item?.id || item.role}`} />
          ))}
        </div>
      ) : !isDailyThread ? (
        <div className="empty-state">No generated items for {output.date}.</div>
      ) : (
        null
      )}
      <FeedPostSection
        key={`${feed.id}-${output.date}`}
        disabled={!feed.enabled}
        posts={posts}
        loading={postsLoading}
        error={postsError}
        submitting={postSubmitting}
        currentUserId={currentUserId}
        onCreateFeedPost={onCreateFeedPost}
        onUpdateFeedPost={onUpdateFeedPost}
        onDeleteFeedPost={onDeleteFeedPost}
      />
    </>
  );
}

function FeedPostSection({
  disabled,
  posts,
  loading,
  error,
  submitting,
  currentUserId,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
}: {
  disabled: boolean;
  posts: GroupFeedPost[];
  loading: boolean;
  error: string;
  submitting: boolean;
  currentUserId: string | null;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => Promise<boolean>;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => Promise<boolean>;
  onDeleteFeedPost: (postId: string) => Promise<boolean>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [evidenceText, setEvidenceText] = useState("");
  const [caption, setCaption] = useState("");
  const ownPost = currentUserId ? posts.find((post) => post.author_user_id === currentUserId) || null : null;
  const postUnavailable = disabled || loading || Boolean(ownPost);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEvidence = evidenceText.trim();
    if (!trimmedEvidence || postUnavailable) {
      return;
    }

    const saved = await onCreateFeedPost({ evidenceText: trimmedEvidence, caption });
    if (!saved) {
      return;
    }
    setEvidenceText("");
    setCaption("");
    setFormOpen(false);
  }

  return (
    <section className="feed-posts-section" aria-label="Posts">
      <div className="feed-posts-header">
        <button
          className="secondary"
          type="button"
          disabled={postUnavailable}
          title={ownPost ? "You already posted in this thread." : undefined}
          onClick={() => setFormOpen((open) => !open)}
        >
          Post
        </button>
      </div>

      {formOpen ? (
        <form className="feed-post-form" onSubmit={handleSubmit}>
          <label>
            Evidence
            <textarea
              className="evidence-textarea"
              required
              value={evidenceText}
              onChange={(event) => setEvidenceText(event.target.value)}
            />
          </label>
          <label>
            Caption
            <textarea
              className="caption-textarea"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
          <div className="output-actions">
            <button className="secondary" type="button" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" disabled={submitting || !evidenceText.trim()}>
              Submit
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <div className="empty-state">Loading posts...</div> : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      {!loading && !error && posts.length ? (
        <div className="stack feed-posts-list">
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              mine={currentUserId === post.author_user_id}
              post={post}
              onUpdateFeedPost={onUpdateFeedPost}
              onDeleteFeedPost={onDeleteFeedPost}
            />
          ))}
        </div>
      ) : null}
      {!loading && !error && !posts.length ? <div className="empty-state">No posts yet.</div> : null}
    </section>
  );
}

function FeedPostCard({
  post,
  mine,
  onUpdateFeedPost,
  onDeleteFeedPost,
}: {
  post: GroupFeedPost;
  mine: boolean;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => Promise<boolean>;
  onDeleteFeedPost: (postId: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [evidenceText, setEvidenceText] = useState(post.evidence_text);
  const [caption, setCaption] = useState(post.caption || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function beginEdit() {
    setEvidenceText(post.evidence_text);
    setCaption(post.caption || "");
    setEditing(true);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEvidence = evidenceText.trim();
    if (!trimmedEvidence || saving || deleting) {
      return;
    }

    setSaving(true);
    try {
      const saved = await onUpdateFeedPost(post.id, { evidenceText: trimmedEvidence, caption });
      if (saved) {
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (saving || deleting || !window.confirm("Delete this post?")) {
      return;
    }

    setDeleting(true);
    const deleted = await onDeleteFeedPost(post.id);
    if (!deleted) {
      setDeleting(false);
    }
  }

  return (
    <article className="row feed-post-card">
      <div className="post-card-header">
        <div>
          <div className="title">{post.author_display_name || post.author_username}</div>
          <div className="meta">{formatDateTime(post.created_at)}</div>
        </div>
        {mine && !editing ? (
          <div className="post-card-actions">
            <button className="secondary" type="button" disabled={deleting} onClick={beginEdit}>
              Edit
            </button>
            <button className="danger" type="button" disabled={deleting} onClick={handleDelete}>
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <form className="feed-post-form edit-post-form" onSubmit={handleUpdate}>
          <label>
            Evidence
            <textarea
              className="evidence-textarea"
              required
              value={evidenceText}
              onChange={(event) => setEvidenceText(event.target.value)}
            />
          </label>
          <label>
            Caption
            <textarea
              className="caption-textarea"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
          <div className="output-actions">
            <button className="secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" disabled={saving || deleting || !evidenceText.trim()}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <EvidenceCodeBlock value={post.evidence_text} />
          {post.caption ? <div className="post-caption">{post.caption}</div> : null}
        </>
      )}
    </article>
  );
}

function EvidenceCodeBlock({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = value.split(/\r?\n/);
  const hasPreview = lines.length > 3;
  const previewText = lines.slice(0, 3).join("\n");
  const displayText = hasPreview && !expanded ? previewText : value;

  function expand() {
    if (hasPreview && !expanded) {
      setExpanded(true);
    }
  }

  return (
    <div className={`post-evidence-code-wrap ${hasPreview && !expanded ? "preview" : ""}`}>
      <pre
        aria-expanded={hasPreview ? expanded : undefined}
        className={`post-evidence-code ${hasPreview && !expanded ? "clickable" : ""}`}
        onClick={expand}
        onKeyDown={(event) => {
          if (!hasPreview || expanded) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded(true);
          }
        }}
        role={hasPreview && !expanded ? "button" : undefined}
        tabIndex={hasPreview && !expanded ? 0 : undefined}
      >
        {displayText}
      </pre>
      {hasPreview && expanded ? (
        <div className="post-evidence-collapse-row">
          <button className="secondary" type="button" onClick={() => setExpanded(false)}>
            Collapse
          </button>
        </div>
      ) : null}
    </div>
  );
}

function OutputItem({ item }: { item: DailyFeedOutputItem }) {
  const catalogItem = item.item || {};
  const data = catalogItem.data || {};
  const rating = primitiveDisplay(data.rating);
  const tags = Array.isArray(data.tags)
    ? data.tags
        .filter((tag): tag is string => typeof tag === "string")
        .slice(0, 4)
        .join(", ")
    : "";
  const details = [catalogItem.source_name, rating ? `Rating ${rating}` : "", tags].filter(Boolean);

  return (
    <div className="row output-item">
      <div className="output-item-main">
        <div className="item-position">{item.position}</div>
        <div>
          <div className="title">{catalogItem.title || "Untitled"}</div>
          {details.map((detail) => (
            <div className="meta" key={detail}>
              {detail}
            </div>
          ))}
          <div className="meta">{item.reason || ""}</div>
        </div>
      </div>
      <div className="output-item-side">
        <span className="pill">{item.role || "target"}</span>
        <span className="pill">{item.points || 0} pts</span>
        <OutputAction action={item.action} />
      </div>
    </div>
  );
}

function OutputAction({ action }: { action?: DailyFeedAction }) {
  if (action?.type === "external_url" && action.url) {
    return (
      <a className="button-link" href={action.url} target="_blank" rel="noreferrer">
        {action.label || "Open"}
      </a>
    );
  }

  if (action?.type === "text" && action.text) {
    return (
      <details className="prompt-details">
        <summary>{action.label || "Prompt"}</summary>
        <pre>{action.text}</pre>
      </details>
    );
  }

  return null;
}

function canManageGroup(group: Group | null): boolean {
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

function primitiveDisplay(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
