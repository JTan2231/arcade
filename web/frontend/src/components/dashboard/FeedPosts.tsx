import { FormEvent, useEffect, useId, useState } from "react";

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
  publicLinksAvailable,
  judgedMetrics,
  canPost,
  canJudge,
  canManagePostTags,
  judgingPostId,
  onCreateFeedPost,
  onUpdateFeedPost,
  onCopyPublicPostLink,
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
  publicLinksAvailable: boolean;
  judgedMetrics: FeedMetric[];
  canPost: boolean;
  canJudge: boolean;
  canManagePostTags: boolean;
  judgingPostId: string | null;
  onCreateFeedPost: (payload: CreateFeedPostPayload) => void;
  onUpdateFeedPost: (postId: string, payload: UpdateFeedPostPayload) => void;
  onCopyPublicPostLink: (postId: string) => void;
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
              publicLinksAvailable={publicLinksAvailable}
              post={post}
              activePostTags={activePostTags}
              saving={updatingPostId === post.id}
              deleting={deletingPostId === post.id}
              judgedMetrics={judgedMetrics}
              canJudge={canJudge && currentUserId !== post.author_user_id}
              judging={judgingPostId === post.id}
              onUpdateFeedPost={onUpdateFeedPost}
              onCopyPublicPostLink={onCopyPublicPostLink}
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
  publicLinksAvailable,
  saving,
  deleting,
  judgedMetrics,
  canJudge,
  judging,
  onUpdateFeedPost,
  onCopyPublicPostLink,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  post: GroupFeedPost;
  activePostTags: GroupPostTag[];
  canTag: boolean;
  mine: boolean;
  publicLinksAvailable: boolean;
  saving: boolean;
  deleting: boolean;
  judgedMetrics: FeedMetric[];
  canJudge: boolean;
  judging: boolean;
  onUpdateFeedPost: (postId: string, payload: UpdateFeedPostPayload) => void;
  onCopyPublicPostLink: (postId: string) => void;
  onDeleteFeedPost: (postId: string) => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [evidenceText, setEvidenceText] = useState(post.evidence_text);
  const [caption, setCaption] = useState(post.caption ?? "");
  const [formError, setFormError] = useState("");
  const evidenceInputId = useId();
  const evidenceHintId = `${evidenceInputId}-hint`;
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() => selectedActivePostTagIDs(post, activePostTags));
  const [initialTagIds, setInitialTagIds] = useState<string[]>(() => selectedActivePostTagIDs(post, activePostTags));
  const [submittedUpdate, setSubmittedUpdate] = useState<{
    evidenceText: string;
    caption: string;
    seenSaving: boolean;
  } | null>(null);

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

  function beginEdit() {
    setEvidenceText(post.evidence_text);
    setCaption(post.caption ?? "");
    setFormError("");
    setTagMenuOpen(false);
    setEditing(true);
  }

  function beginTagging() {
    const nextTagIds = selectedActivePostTagIDs(post, activePostTags);
    setSelectedTagIds(nextTagIds);
    setInitialTagIds(nextTagIds);
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

    onDeleteFeedPost(post.id);
  }

  const taggable = canTag && activePostTags.length > 0;
  const postActionsVisible = taggable || mine || publicLinksAvailable;

  return (
    <article className="row feed-post-card">
      <div className="post-card-header">
        <div>
          <div className="title">{post.author_display_name || post.author_username}</div>
          <div className="meta">{formatDateTime(post.created_at)}</div>
        </div>
        {postActionsVisible && !editing ? (
          <div className="post-card-actions">
            {taggable ? (
              <button className="secondary" type="button" disabled={saving || deleting} onClick={toggleTagMenu}>
                Tag
              </button>
            ) : null}
            {publicLinksAvailable ? (
              <button
                className="secondary"
                type="button"
                disabled={saving || deleting}
                onClick={() => onCopyPublicPostLink(post.id)}
              >
                Copy link
              </button>
            ) : null}
            {mine ? (
              <>
                <button className="secondary" type="button" disabled={deleting} onClick={beginEdit}>
                  Edit
                </button>
                <button className="danger" type="button" disabled={deleting} onClick={handleDelete}>
                  Delete
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

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
          {shouldShowPostFormat(post) ? (
            <div className="post-format-meta">
              {post.evidence_format.name} · v{post.evidence_format_version.version_number}
              {post.evidence_format.archived_at !== undefined ? " · Archived" : ""}
            </div>
          ) : null}
          <EvidenceCodeBlock value={post.evidence_text} />
          {post.caption !== undefined && post.caption !== "" ? (
            <div className="post-caption">{post.caption}</div>
          ) : null}
          <PostTagPills tags={post.tags} />
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

function EvidenceCodeBlock({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const preparedCode = prepareCodeBlock(value);
  const lines = preparedCode.code.split(/\r?\n/);
  const hasPreview = lines.length > 3;
  const previewText = lines.slice(0, 3).join("\n");
  const displayText = hasPreview && !expanded ? previewText : preparedCode.code;
  const highlightedCode = highlightCodeBlock(displayText, preparedCode.code, preparedCode.languageHint);
  const codeClassName =
    highlightedCode === null ? undefined : `post-evidence-code-content language-${highlightedCode.language}`;
  const codeNode =
    highlightedCode === null ? (
      <code className="post-evidence-code-content">{displayText}</code>
    ) : (
      <code className={codeClassName} dangerouslySetInnerHTML={{ __html: highlightedCode.html }} />
    );

  return (
    <div className={`post-evidence-code-wrap ${hasPreview && !expanded ? "preview" : ""}`}>
      {hasPreview && !expanded ? (
        <button
          aria-expanded={expanded}
          aria-label="Expand evidence"
          className="post-evidence-code-button"
          type="button"
          onClick={() => setExpanded(true)}
        >
          <pre className="post-evidence-code">{codeNode}</pre>
        </button>
      ) : (
        <pre className="post-evidence-code">{codeNode}</pre>
      )}
      {hasPreview && expanded ? (
        <div className="post-evidence-collapse-row">
          <button className="secondary" type="button" aria-label="Collapse evidence" onClick={() => setExpanded(false)}>
            Collapse
          </button>
        </div>
      ) : null}
    </div>
  );
}
