import { FormEvent, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { highlightCodeBlock, prepareCodeBlock } from "../../syntaxHighlight";
import type {
  CreateFeedMetricJudgmentRequest,
  EvidenceFormat,
  FeedMetric,
  GroupFeedPost,
  GroupPostTag,
} from "../../types";
import {
  evidenceFormatConstraintSummary,
  normalizeEvidenceText,
  shouldShowPostFormat,
  validateEvidenceText,
} from "./evidenceText";
import { formatDateTime, sameStringSet, selectedActivePostTagIDs } from "./format";

const EVIDENCE_PREVIEW_LINE_LIMIT = 3;
const EVIDENCE_PREVIEW_RENDER_LINE_LIMIT = EVIDENCE_PREVIEW_LINE_LIMIT * 2;

export type CreateFeedPostPayload = {
  evidenceText: string;
  caption: string;
};

export type UpdateFeedPostPayload = {
  evidenceText?: string;
  caption?: string;
  tagIds?: string[];
};

export function FeedPostSection({
  disabled,
  evidenceFormat,
  posts,
  postTags,
  loading,
  error,
  submitting,
  updatingPostId,
  deletingPostId,
  currentUserId,
  judgedMetrics,
  canPost,
  canJudge,
  canManagePostTags,
  judgingPostId,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  disabled: boolean;
  evidenceFormat: EvidenceFormat;
  posts: GroupFeedPost[];
  postTags: GroupPostTag[];
  loading: boolean;
  error: string;
  submitting: boolean;
  updatingPostId: string | null;
  deletingPostId: string | null;
  currentUserId: string | null;
  judgedMetrics: FeedMetric[];
  canPost: boolean;
  canJudge: boolean;
  canManagePostTags: boolean;
  judgingPostId: string | null;
  onCreateFeedPost: (payload: CreateFeedPostPayload) => void;
  onUpdateFeedPost: (postId: string, payload: UpdateFeedPostPayload) => void;
  onDeleteFeedPost: (postId: string) => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [evidenceText, setEvidenceText] = useState("");
  const [caption, setCaption] = useState("");
  const [formError, setFormError] = useState("");
  const evidenceInputId = useId();
  const evidenceHintId = `${evidenceInputId}-hint`;
  const activePostTags = postTags.filter((tag) => tag.archived_at === undefined);
  const ownPost = currentUserId !== null ? (posts.find((post) => post.author_user_id === currentUserId) ?? null) : null;
  const postUnavailable = !canPost || disabled || loading || Boolean(ownPost);
  const postButtonTitle = !canPost
    ? "Active group membership required to post."
    : ownPost
      ? "You already posted in this thread."
      : undefined;

  useEffect(() => {
    if (ownPost === null || !formOpen || submitting) {
      return;
    }

    setEvidenceText("");
    setCaption("");
    setFormOpen(false);
  }, [formOpen, ownPost, submitting]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEvidence = normalizeEvidenceText(evidenceText);
    const validationMessage = validateEvidenceText(normalizedEvidence, evidenceFormat.active_version);
    if (validationMessage !== "" || postUnavailable) {
      setFormError(validationMessage);
      return;
    }

    setFormError("");
    onCreateFeedPost({ evidenceText: normalizedEvidence, caption });
  }

  return (
    <section className="feed-posts-section" aria-label="Posts">
      {loading ? <div className="empty-state">Loading posts...</div> : null}
      {error !== "" ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      {!loading && error === "" && posts.length > 0 ? (
        <div className="stack feed-posts-list">
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              canTag={currentUserId === post.author_user_id || canManagePostTags}
              mine={currentUserId === post.author_user_id}
              post={post}
              activePostTags={activePostTags}
              saving={updatingPostId === post.id}
              deleting={deletingPostId === post.id}
              judgedMetrics={judgedMetrics}
              canJudge={canJudge && currentUserId !== post.author_user_id}
              judging={judgingPostId === post.id}
              onUpdateFeedPost={onUpdateFeedPost}
              onDeleteFeedPost={onDeleteFeedPost}
              onCreateMetricJudgment={onCreateMetricJudgment}
            />
          ))}
        </div>
      ) : null}
      {!loading && error === "" && posts.length === 0 ? (
        <div className="feed-posts-empty">There&apos;s nothing here...</div>
      ) : null}

      <div className="feed-posts-header">
        <button
          className="secondary feed-post-button"
          type="button"
          disabled={postUnavailable}
          title={postButtonTitle}
          onClick={() => setFormOpen((open) => !open)}
        >
          Post
        </button>
      </div>

      {formOpen ? (
        <form className="feed-post-form" onSubmit={handleSubmit}>
          <label htmlFor={evidenceInputId}>Evidence</label>
          <span id={evidenceHintId} className="field-hint">
            {evidenceFormatConstraintSummary(evidenceFormat.active_version)}
          </span>
          <textarea
            id={evidenceInputId}
            className="evidence-textarea"
            required
            aria-describedby={evidenceHintId}
            value={evidenceText}
            onChange={(event) => {
              setEvidenceText(event.target.value);
              setFormError("");
            }}
          />
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
          {formError !== "" ? (
            <div className="form-error" role="alert">
              {formError}
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function FeedPostCard({
  post,
  activePostTags,
  canTag,
  mine,
  saving,
  deleting,
  judgedMetrics,
  canJudge,
  judging,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  post: GroupFeedPost;
  activePostTags: GroupPostTag[];
  canTag: boolean;
  mine: boolean;
  saving: boolean;
  deleting: boolean;
  judgedMetrics: FeedMetric[];
  canJudge: boolean;
  judging: boolean;
  onUpdateFeedPost: (postId: string, payload: UpdateFeedPostPayload) => void;
  onDeleteFeedPost: (postId: string) => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [evidenceText, setEvidenceText] = useState(post.evidence_text);
  const [caption, setCaption] = useState(post.caption ?? "");
  const [formError, setFormError] = useState("");
  const evidenceInputId = useId();
  const evidenceHintId = `${evidenceInputId}-hint`;
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() => selectedActivePostTagIDs(post, activePostTags));
  const [initialTagIds, setInitialTagIds] = useState<string[]>(() => selectedActivePostTagIDs(post, activePostTags));
  const [submittedUpdate, setSubmittedUpdate] = useState<{
    evidenceText: string;
    caption: string;
    seenSaving: boolean;
  } | null>(null);
  const evidencePreview = prepareEvidencePreview(post.evidence_text);
  const evidenceCollapsed = evidencePreview.hasPreview && !evidenceExpanded;

  useEffect(() => {
    if (submittedUpdate === null) {
      return;
    }
    if (saving) {
      if (!submittedUpdate.seenSaving) {
        setSubmittedUpdate({ ...submittedUpdate, seenSaving: true });
      }
      return;
    }
    if (!submittedUpdate.seenSaving) {
      return;
    }
    if (post.evidence_text === submittedUpdate.evidenceText && (post.caption ?? "") === submittedUpdate.caption) {
      setEditing(false);
    }
    setSubmittedUpdate(null);
  }, [post.caption, post.evidence_text, saving, submittedUpdate]);

  useEffect(() => {
    setEvidenceExpanded(false);
  }, [post.id, post.evidence_text]);

  useEffect(() => {
    if (!actionMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (actionMenuRef.current?.contains(event.target as Node) === true) {
        return;
      }
      setActionMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActionMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionMenuOpen]);

  function beginEdit() {
    setEvidenceText(post.evidence_text);
    setCaption(post.caption ?? "");
    setFormError("");
    setTagMenuOpen(false);
    setActionMenuOpen(false);
    setEditing(true);
  }

  function beginTagging() {
    const nextTagIds = selectedActivePostTagIDs(post, activePostTags);
    setSelectedTagIds(nextTagIds);
    setInitialTagIds(nextTagIds);
    setActionMenuOpen(false);
    setTagMenuOpen(true);
  }

  function closeTagMenu() {
    if (saving || deleting) {
      return;
    }
    setTagMenuOpen(false);
    if (!sameStringSet(selectedTagIds, initialTagIds)) {
      onUpdateFeedPost(post.id, { tagIds: selectedTagIds });
    }
  }

  function toggleTagMenu() {
    if (tagMenuOpen) {
      closeTagMenu();
      return;
    }
    beginTagging();
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEvidence = normalizeEvidenceText(evidenceText);
    const validationMessage = validateEvidenceText(normalizedEvidence, post.evidence_format_version);
    if (validationMessage !== "" || saving || deleting) {
      setFormError(validationMessage);
      return;
    }

    const trimmedCaption = caption.trim();
    setFormError("");
    setSubmittedUpdate({ evidenceText: normalizedEvidence, caption: trimmedCaption, seenSaving: false });
    onUpdateFeedPost(post.id, {
      evidenceText: normalizedEvidence,
      caption: trimmedCaption,
    });
  }

  function handleDelete() {
    if (saving || deleting || !window.confirm("Delete this post?")) {
      return;
    }

    setActionMenuOpen(false);
    onDeleteFeedPost(post.id);
  }

  const taggable = canTag && activePostTags.length > 0;
  const postActionsVisible = taggable || mine;
  const hasCaption = post.caption !== undefined && post.caption !== "";
  const byline = (
    <div className="post-card-byline">
      <div className="title post-author-name">{post.author_display_name || post.author_username}</div>
      <div className="meta post-timestamp">{formatDateTime(post.created_at)}</div>
      <PostTagPills tags={post.tags} />
    </div>
  );
  const postActions =
    postActionsVisible && !editing ? (
      <div className="post-card-actions" ref={actionMenuRef}>
        <button
          aria-label="Post actions"
          aria-expanded={actionMenuOpen}
          aria-haspopup="true"
          className="icon-button post-action-button post-action-menu-button"
          title="Post actions"
          type="button"
          disabled={saving || deleting}
          onClick={() => setActionMenuOpen((open) => !open)}
        >
          <span className="post-action-menu-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        {actionMenuOpen ? (
          <div className="post-action-menu-panel">
            {taggable ? (
              <button
                aria-label="Tag"
                className="icon-button post-action-button"
                title="Tag"
                type="button"
                disabled={saving || deleting}
                onClick={toggleTagMenu}
              >
                <PostActionIcon>
                  <path d="M20 10V5a2 2 0 0 0-2-2h-5L3 13l8 8 9-11Z" />
                  <path d="M17.5 6.5h.01" />
                </PostActionIcon>
              </button>
            ) : null}
            {mine ? (
              <>
                <button
                  aria-label="Edit"
                  className="icon-button post-action-button"
                  title="Edit"
                  type="button"
                  disabled={deleting}
                  onClick={beginEdit}
                >
                  <PostActionIcon>
                    <path d="M12 20h9" />
                    <path d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5Z" />
                  </PostActionIcon>
                </button>
                <button
                  aria-label="Delete"
                  className="icon-button post-action-button post-action-button-danger"
                  title="Delete"
                  type="button"
                  disabled={deleting}
                  onClick={handleDelete}
                >
                  <PostActionIcon>
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M6 6l1 15h10l1-15" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </PostActionIcon>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <article className="row feed-post-card">
      {editing ? <div className="post-card-header">{byline}</div> : null}

      {tagMenuOpen && !editing ? (
        <PostTagMenu
          disabled={saving || deleting}
          selectedTagIds={selectedTagIds}
          tags={activePostTags}
          onClose={closeTagMenu}
          onSelectionChange={setSelectedTagIds}
        />
      ) : null}

      {editing ? (
        <form className="feed-post-form edit-post-form" onSubmit={handleUpdate}>
          <label htmlFor={evidenceInputId}>Evidence</label>
          <span id={evidenceHintId} className="field-hint">
            {evidenceFormatConstraintSummary(post.evidence_format_version)}
          </span>
          <textarea
            id={evidenceInputId}
            className="evidence-textarea"
            required
            aria-describedby={evidenceHintId}
            value={evidenceText}
            onChange={(event) => {
              setEvidenceText(event.target.value);
              setFormError("");
            }}
          />
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
          {formError !== "" ? (
            <div className="form-error" role="alert">
              {formError}
            </div>
          ) : null}
        </form>
      ) : (
        <>
          <div className={`post-content-preview ${evidenceCollapsed ? "preview" : ""}`}>
            <div className={`post-evidence-layout ${hasCaption ? "has-caption" : ""}`}>
              <div className="post-evidence-column">
                {shouldShowPostFormat(post) ? (
                  <div className="post-format-meta">
                    {post.evidence_format.name} · v{post.evidence_format_version.version_number}
                    {post.evidence_format.archived_at !== undefined ? " · Archived" : ""}
                  </div>
                ) : null}
                <EvidenceCodeBlock
                  collapsed={evidenceCollapsed}
                  expanded={evidenceExpanded}
                  preview={evidencePreview}
                  onCollapse={() => {
                    setActionMenuOpen(false);
                    setEvidenceExpanded(false);
                  }}
                />
              </div>
              <div className="post-caption-column">
                <div className="post-caption-heading">
                  {byline}
                  {evidenceCollapsed ? null : postActions}
                </div>
                {hasCaption ? <div className="post-caption">{post.caption}</div> : null}
              </div>
            </div>
            {evidenceCollapsed ? (
              <button
                aria-expanded={false}
                aria-label="Expand evidence"
                className="post-content-expand-button"
                type="button"
                onClick={() => setEvidenceExpanded(true)}
              />
            ) : null}
          </div>
        </>
      )}
      {canJudge && !editing && judgedMetrics.length > 0 ? (
        <div className="post-judgment-list" aria-label={`Score ${post.author_display_name || post.author_username}`}>
          {judgedMetrics.map((metric) => (
            <MetricJudgmentForm
              disabled={judging || saving || deleting}
              key={metric.id}
              metric={metric}
              onSubmit={(payload) => onCreateMetricJudgment(metric.id, post.id, payload)}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PostActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="post-action-icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

function PostTagMenu({
  tags,
  selectedTagIds,
  disabled,
  onClose,
  onSelectionChange,
}: {
  tags: GroupPostTag[];
  selectedTagIds: string[];
  disabled: boolean;
  onClose: () => void;
  onSelectionChange: (selectedTagIds: string[]) => void;
}) {
  function toggleTag(tagId: string, checked: boolean) {
    if (checked) {
      onSelectionChange(selectedTagIds.includes(tagId) ? selectedTagIds : [...selectedTagIds, tagId]);
      return;
    }
    onSelectionChange(selectedTagIds.filter((selectedTagId) => selectedTagId !== tagId));
  }

  return (
    <div className="post-tag-menu" aria-label="Tag post">
      <fieldset className="post-tag-menu-options">
        <legend>Tags</legend>
        <div className="post-tag-menu-list">
          {tags.map((tag) => (
            <label className="post-tag-menu-option" key={tag.id}>
              <input
                checked={selectedTagIds.includes(tag.id)}
                disabled={disabled}
                name="post-tag-id"
                type="checkbox"
                value={tag.id}
                onChange={(event) => toggleTag(tag.id, event.currentTarget.checked)}
              />
              <span>{tag.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="post-tag-menu-actions">
        <button className="secondary" type="button" disabled={disabled} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function PostTagPills({ tags }: { tags: GroupPostTag[] }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="post-tag-list" aria-label="Post tags">
      {tags.map((tag) => {
        const archived = tag.archived_at !== undefined;
        return (
          <span
            aria-label={archived ? `${tag.name} archived` : tag.name}
            className={`post-tag-pill ${archived ? "archived" : ""}`}
            key={tag.id}
            title={archived ? "Archived tag" : undefined}
          >
            {tag.name}
          </span>
        );
      })}
    </div>
  );
}

function MetricJudgmentForm({
  metric,
  disabled,
  onSubmit,
}: {
  metric: FeedMetric;
  disabled: boolean;
  onSubmit: (payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">) => void;
}) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      setError("Score must be a non-negative number");
      return;
    }
    setError("");
    onSubmit({
      value: parsedValue,
      ...(note.trim() !== "" ? { note: note.trim() } : {}),
    });
  }

  return (
    <form className="metric-judgment-form" onSubmit={handleSubmit}>
      <div>
        <div className="title">{metric.display_name}</div>
        {metric.judgment_prompt !== undefined && metric.judgment_prompt !== "" ? (
          <div className="meta">{metric.judgment_prompt}</div>
        ) : null}
      </div>
      <div className="metric-judgment-grid">
        <label>
          Score
          <input
            min="0"
            step="any"
            type="number"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
          />
        </label>
        <label>
          Note
          <input
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError("");
            }}
          />
        </label>
        <button type="submit" disabled={disabled || value.trim() === ""}>
          Save
        </button>
      </div>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}

function prepareEvidencePreview(value: string) {
  const preparedCode = prepareCodeBlock(value);
  const lines = preparedCode.code.split(/\r?\n/);
  return {
    preparedCode,
    collapsedCode: lines.slice(0, EVIDENCE_PREVIEW_RENDER_LINE_LIMIT).join("\n"),
    hasPreview: lines.length > EVIDENCE_PREVIEW_LINE_LIMIT,
  };
}

function EvidenceCodeBlock({
  collapsed,
  expanded,
  preview,
  onCollapse,
}: {
  collapsed: boolean;
  expanded: boolean;
  preview: ReturnType<typeof prepareEvidencePreview>;
  onCollapse: () => void;
}) {
  const displayText = collapsed ? preview.collapsedCode : preview.preparedCode.code;
  const highlightedCode = highlightCodeBlock(displayText, preview.preparedCode.code, preview.preparedCode.languageHint);
  const codeClassName =
    highlightedCode === null ? undefined : `post-evidence-code-content language-${highlightedCode.language}`;
  const codeNode =
    highlightedCode === null ? (
      <code className="post-evidence-code-content">{displayText}</code>
    ) : (
      <code className={codeClassName} dangerouslySetInnerHTML={{ __html: highlightedCode.html }} />
    );

  return (
    <div className="post-evidence-code-wrap">
      <pre className="post-evidence-code">{codeNode}</pre>
      {preview.hasPreview && expanded ? (
        <div className="post-evidence-collapse-row">
          <button className="secondary" type="button" aria-label="Collapse evidence" onClick={onCollapse}>
            Collapse
          </button>
        </div>
      ) : null}
    </div>
  );
}
