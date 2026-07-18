import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type TransitionEvent,
} from "react";

import { highlightCodeBlock, prepareCodeBlock } from "../../syntaxHighlight";
import { compileCardPalette } from "../../palette";
import {
  resolvePostFormatAppearance,
  useLivePostFormatAppearances,
  type PostFormatAppearance,
} from "../../postFormatAppearances";
import { resolvePostCardPalette, useLivePostCardPalettes } from "../../postCardPalettes";
import { useViewerTheme } from "../../theme";
import type {
  CreateFeedMetricJudgmentRequest,
  EvidenceFormat,
  FeedMetric,
  GroupFeedPost,
  GroupPostTag,
  PostCardPaletteSummary,
  PostContentTypeface,
} from "../../types";
import {
  evidenceFormatConstraintSummary,
  normalizeEvidenceText,
  shouldShowPostFormat,
  validateEvidenceText,
} from "./evidenceText";
import { useFeedSpotlightTarget } from "./feedSpotlightContext";
import { formatDateTime, sameStringSet, selectedActivePostTagIDs } from "./format";

const EVIDENCE_PREVIEW_LINE_LIMIT = 6;
const EVIDENCE_PREVIEW_FALLBACK_HEIGHT = 93;
const POST_COMPOSER_TRANSITION_MS = 1_260;
const POST_COMPOSER_CLOSE_FALLBACK_MS = POST_COMPOSER_TRANSITION_MS + 100;
const POST_COMPOSER_IDLE_SPOTLIGHT_STRENGTH = 0.3;

type PostComposerPhase = "closed" | "opening" | "open" | "closing";

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
  captionsEnabled,
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
  postAccessPrompt,
}: {
  disabled: boolean;
  captionsEnabled: boolean;
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
  postAccessPrompt?: ReactNode;
}) {
  const [formPhase, setFormPhase] = useState<PostComposerPhase>("closed");
  const [evidenceText, setEvidenceText] = useState("");
  const [caption, setCaption] = useState("");
  const [formError, setFormError] = useState("");
  const [contentFocused, setContentFocused] = useState(false);
  const [captionFocused, setCaptionFocused] = useState(false);
  const viewerTheme = useViewerTheme();
  const liveFormatAppearances = useLivePostFormatAppearances();
  const livePalettes = useLivePostCardPalettes();
  const postFormId = useId();
  const evidenceInputId = useId();
  const evidenceHintId = `${evidenceInputId}-hint`;
  const captionSpotlightTargetRef = useRef<HTMLTextAreaElement>(null);
  const handledOwnPostIdRef = useRef<string | null>(null);
  const postButtonRef = useRef<HTMLButtonElement>(null);
  const postFormSpotlightTargetRef = useRef<HTMLFormElement>(null);
  const postsSectionRef = useRef<HTMLElement>(null);
  const resetFormAfterCloseRef = useRef(false);
  const activePostTags = postTags.filter((tag) => tag.archived_at === undefined);
  const ownPost = currentUserId !== null ? (posts.find((post) => post.author_user_id === currentUserId) ?? null) : null;
  const postUnavailable = !canPost || disabled || loading || Boolean(ownPost);
  const postButtonTitle = !canPost ? "Active group membership required to post." : undefined;
  const contentHint = evidenceFormatConstraintSummary(evidenceFormat.active_version);
  const formMounted = formPhase !== "closed";
  const formOpen = formPhase === "opening" || formPhase === "open";
  const composerFormatAppearance = resolvePostFormatAppearance(evidenceFormat, liveFormatAppearances);
  const composerPalette = resolvePostCardPalette(composerFormatAppearance.contentCardPalette, livePalettes);
  const composerAppearanceStyle = postCardAppearanceStyle(composerPalette);
  const composerAppearanceKey = postCardAppearanceKey(composerPalette, viewerTheme.profileId);

  const finishPostFormClose = useCallback(() => {
    setFormPhase("closed");
    if (resetFormAfterCloseRef.current) {
      resetFormAfterCloseRef.current = false;
      setEvidenceText("");
      setCaption("");
      setFormError("");
    }
  }, []);

  useFeedSpotlightTarget(
    `post-form-${postFormId}`,
    postFormSpotlightTargetRef,
    formOpen && !captionFocused,
    "post",
    contentFocused ? 1 : POST_COMPOSER_IDLE_SPOTLIGHT_STRENGTH,
    composerAppearanceKey,
  );
  useFeedSpotlightTarget(
    `post-caption-${postFormId}`,
    captionSpotlightTargetRef,
    formOpen && captionsEnabled && captionFocused,
    "feed",
  );

  useEffect(() => {
    if (!captionsEnabled) {
      setCaptionFocused(false);
    }
  }, [captionsEnabled]);

  useEffect(() => {
    if (formPhase !== "opening") {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      setFormPhase((phase) => (phase === "opening" ? "open" : phase));
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [formPhase]);

  useEffect(() => {
    if (formPhase !== "closing") {
      return undefined;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        finishPostFormClose();
      }
    };
    const timer = window.setTimeout(finishPostFormClose, reducedMotion.matches ? 0 : POST_COMPOSER_CLOSE_FALLBACK_MS);
    reducedMotion.addEventListener("change", handleReducedMotionChange);
    return () => {
      window.clearTimeout(timer);
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
    };
  }, [finishPostFormClose, formPhase]);

  useEffect(() => {
    if (ownPost === null) {
      handledOwnPostIdRef.current = null;
      return;
    }
    if (submitting || handledOwnPostIdRef.current === ownPost.id) {
      return;
    }

    handledOwnPostIdRef.current = ownPost.id;
    resetFormAfterCloseRef.current = true;
    setContentFocused(false);
    setCaptionFocused(false);
    const activeElement = document.activeElement;
    if (activeElement !== null && postFormSpotlightTargetRef.current?.contains(activeElement) === true) {
      postsSectionRef.current?.focus({ preventScroll: true });
    }
    if (formMounted) {
      setFormPhase("closing");
    } else {
      finishPostFormClose();
    }
  }, [finishPostFormClose, formMounted, ownPost, submitting]);

  function togglePostForm() {
    setContentFocused(false);
    setCaptionFocused(false);
    if (formOpen) {
      setFormPhase("closing");
      return;
    }

    if (resetFormAfterCloseRef.current) {
      resetFormAfterCloseRef.current = false;
      setEvidenceText("");
      setCaption("");
      setFormError("");
    }
    setFormPhase(formPhase === "closed" ? "opening" : "open");
  }

  function closePostForm() {
    setContentFocused(false);
    setCaptionFocused(false);
    postButtonRef.current?.focus({ preventScroll: true });
    setFormPhase("closing");
  }

  function handlePostFormTransitionEnd(event: TransitionEvent<HTMLFormElement>) {
    if (event.currentTarget === event.target && event.propertyName === "opacity" && formPhase === "closing") {
      finishPostFormClose();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEvidence = normalizeEvidenceText(evidenceText);
    const validationMessage = validateEvidenceText(normalizedEvidence, evidenceFormat.active_version);
    if (validationMessage !== "" || postUnavailable) {
      setFormError(validationMessage);
      return;
    }

    setFormError("");
    onCreateFeedPost({ evidenceText: normalizedEvidence, caption: captionsEnabled ? caption : "" });
  }

  return (
    <section className="feed-posts-section" aria-label="Posts" ref={postsSectionRef} tabIndex={-1}>
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
              captionsEnabled={captionsEnabled}
              canTag={currentUserId === post.author_user_id || canManagePostTags}
              mine={currentUserId === post.author_user_id}
              post={post}
              activePostTags={activePostTags}
              saving={updatingPostId === post.id}
              deleting={deletingPostId === post.id}
              judgedMetrics={judgedMetrics}
              canJudge={canJudge && currentUserId !== post.author_user_id}
              judging={judgingPostId === post.id}
              liveFormatAppearances={liveFormatAppearances}
              livePalettes={livePalettes}
              themeProfileId={viewerTheme.profileId}
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

      {ownPost === null ? (
        <div className="feed-posts-header">
          {!canPost && postAccessPrompt !== undefined ? (
            postAccessPrompt
          ) : (
            <button
              aria-controls={postFormId}
              aria-expanded={formOpen}
              className="secondary feed-post-button"
              type="button"
              disabled={postUnavailable}
              ref={postButtonRef}
              title={postButtonTitle}
              onClick={togglePostForm}
            >
              Post
            </button>
          )}
        </div>
      ) : null}

      {formMounted ? (
        <form
          aria-hidden={formPhase !== "open"}
          className={`feed-post-form post-card-palette post-content-typeface-${composerFormatAppearance.contentTypeface} post-composer-form ${
            formPhase === "open" ? "post-composer-form-open" : ""
          }`}
          id={postFormId}
          inert={formPhase !== "open"}
          ref={postFormSpotlightTargetRef}
          style={composerAppearanceStyle}
          onSubmit={handleSubmit}
          onTransitionEnd={handlePostFormTransitionEnd}
        >
          <label htmlFor={evidenceInputId}>Content</label>
          {contentHint === "" ? null : (
            <span id={evidenceHintId} className="field-hint">
              {contentHint}
            </span>
          )}
          <textarea
            id={evidenceInputId}
            className="evidence-textarea"
            disabled={formPhase !== "open"}
            required
            aria-describedby={contentHint === "" ? undefined : evidenceHintId}
            value={evidenceText}
            onChange={(event) => {
              setEvidenceText(event.target.value);
              setFormError("");
            }}
            onBlur={() => setContentFocused(false)}
            onFocus={() => {
              setCaptionFocused(false);
              setContentFocused(true);
            }}
          />
          {captionsEnabled ? (
            <label>
              Caption
              <textarea
                className="caption-textarea"
                disabled={formPhase !== "open"}
                ref={captionSpotlightTargetRef}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                onBlur={() => setCaptionFocused(false)}
                onFocus={() => {
                  setContentFocused(false);
                  setCaptionFocused(true);
                }}
              />
            </label>
          ) : null}
          <div className="output-actions">
            <button className="secondary" type="button" onClick={closePostForm}>
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
  captionsEnabled,
  activePostTags,
  canTag,
  mine,
  saving,
  deleting,
  judgedMetrics,
  canJudge,
  judging,
  liveFormatAppearances,
  livePalettes,
  themeProfileId,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  post: GroupFeedPost;
  captionsEnabled: boolean;
  activePostTags: GroupPostTag[];
  canTag: boolean;
  mine: boolean;
  saving: boolean;
  deleting: boolean;
  judgedMetrics: FeedMetric[];
  canJudge: boolean;
  judging: boolean;
  liveFormatAppearances: ReadonlyMap<string, PostFormatAppearance>;
  livePalettes: ReadonlyMap<string, PostCardPaletteSummary>;
  themeProfileId: string;
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
  const [contentFocused, setContentFocused] = useState(false);
  const [captionFocused, setCaptionFocused] = useState(false);
  const [evidenceContentHeight, setEvidenceContentHeight] = useState<number | null>(null);
  const [evidencePreviewHeight, setEvidencePreviewHeight] = useState(EVIDENCE_PREVIEW_FALLBACK_HEIGHT);
  const evidenceInputId = useId();
  const evidenceHintId = `${evidenceInputId}-hint`;
  const evidenceContentId = useId();
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const captionSpotlightTargetRef = useRef<HTMLTextAreaElement>(null);
  const collapseEvidenceButtonRef = useRef<HTMLButtonElement>(null);
  const editSpotlightTargetRef = useRef<HTMLFormElement>(null);
  const evidenceLayoutRef = useRef<HTMLDivElement>(null);
  const evidenceRenderRef = useRef<HTMLElement>(null);
  const expandEvidenceButtonRef = useRef<HTMLButtonElement>(null);
  const pendingEvidenceFocusRef = useRef<"collapse" | "expand" | null>(null);
  const spotlightTargetRef = useRef<HTMLDivElement>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() => selectedActivePostTagIDs(post, activePostTags));
  const [initialTagIds, setInitialTagIds] = useState<string[]>(() => selectedActivePostTagIDs(post, activePostTags));
  const [submittedUpdate, setSubmittedUpdate] = useState<{
    evidenceText: string;
    caption: string;
    seenSaving: boolean;
  } | null>(null);
  const formatAppearance = resolvePostFormatAppearance(post.evidence_format, liveFormatAppearances);
  const evidencePreview = prepareEvidencePreview(post.evidence_text, formatAppearance.contentTypeface);
  const [evidenceHasPreview, setEvidenceHasPreview] = useState(evidencePreview.hasLogicalPreview);
  const evidenceCollapsed = evidenceHasPreview && !evidenceExpanded;
  const contentHint = evidenceFormatConstraintSummary(post.evidence_format_version);
  const evidenceRevealHeight = evidenceHasPreview
    ? evidenceCollapsed
      ? evidencePreviewHeight
      : (evidenceContentHeight ?? "auto")
    : "auto";
  const cardPalette = resolvePostCardPalette(formatAppearance.contentCardPalette, livePalettes);
  const appearanceStyle = postCardAppearanceStyle(cardPalette);
  const appearanceKey = postCardAppearanceKey(cardPalette, themeProfileId);

  useFeedSpotlightTarget(post.id, spotlightTargetRef, evidenceExpanded && !editing, "post", 1, appearanceKey);
  useFeedSpotlightTarget(
    `${post.id}-edit`,
    editSpotlightTargetRef,
    editing && contentFocused,
    "post",
    1,
    appearanceKey,
  );
  useFeedSpotlightTarget(
    `${post.id}-caption-edit`,
    captionSpotlightTargetRef,
    editing && captionsEnabled && captionFocused,
    "feed",
  );

  useEffect(() => {
    if (!captionsEnabled) {
      setCaptionFocused(false);
    }
  }, [captionsEnabled]);

  useLayoutEffect(() => {
    const content = evidenceLayoutRef.current;
    if (content === null) {
      return undefined;
    }

    // Pixel endpoints keep the height transition working in engines that
    // cannot interpolate between a fixed length and `auto`.
    const measure = () => {
      const nextHeight = content.getBoundingClientRect().height;
      setEvidenceContentHeight((currentHeight) =>
        currentHeight !== null && Math.abs(currentHeight - nextHeight) < 0.5 ? currentHeight : nextHeight,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [editing, evidenceExpanded, evidenceHasPreview, post.caption, post.evidence_text]);

  useLayoutEffect(() => {
    const content = evidenceRenderRef.current;
    if (content === null) {
      return undefined;
    }

    const measure = () => {
      const style = getComputedStyle(content);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const verticalChrome =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom) +
        Number.parseFloat(style.borderTopWidth) +
        Number.parseFloat(style.borderBottomWidth);
      const previewThreshold =
        (Number.isFinite(lineHeight) ? lineHeight : 19) * EVIDENCE_PREVIEW_LINE_LIMIT +
        (Number.isFinite(verticalChrome) ? verticalChrome : 0);
      const layout = evidenceLayoutRef.current;
      const contentOffset =
        layout === null ? 0 : Math.max(0, content.getBoundingClientRect().top - layout.getBoundingClientRect().top);
      const nextPreviewHeight = Math.ceil(contentOffset + previewThreshold);
      const nextHasPreview = content.scrollHeight > previewThreshold + 0.5;
      setEvidencePreviewHeight((current) => (current === nextPreviewHeight ? current : nextPreviewHeight));
      setEvidenceHasPreview((current) => (current === nextHasPreview ? current : nextHasPreview));
      if (!nextHasPreview) {
        setEvidenceExpanded(false);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [formatAppearance.contentTypeface, post.evidence_text]);

  useLayoutEffect(() => {
    const pendingFocus = pendingEvidenceFocusRef.current;
    if (pendingFocus === null) {
      return;
    }

    const target = pendingFocus === "collapse" ? collapseEvidenceButtonRef.current : expandEvidenceButtonRef.current;
    target?.focus({ preventScroll: true });
    pendingEvidenceFocusRef.current = null;
  }, [evidenceExpanded]);

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
      setContentFocused(false);
      setCaptionFocused(false);
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
    setContentFocused(false);
    setCaptionFocused(false);
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

    const trimmedCaption = captionsEnabled ? caption.trim() : (post.caption ?? "");
    setFormError("");
    setSubmittedUpdate({ evidenceText: normalizedEvidence, caption: trimmedCaption, seenSaving: false });
    onUpdateFeedPost(post.id, {
      evidenceText: normalizedEvidence,
      ...(captionsEnabled ? { caption: trimmedCaption } : {}),
    });
  }

  function handleDelete() {
    if (saving || deleting || !window.confirm("Delete this post?")) {
      return;
    }

    setActionMenuOpen(false);
    onDeleteFeedPost(post.id);
  }

  function expandEvidence() {
    pendingEvidenceFocusRef.current = "collapse";
    setEvidenceExpanded(true);
  }

  function collapseEvidence() {
    setActionMenuOpen(false);
    pendingEvidenceFocusRef.current = "expand";
    setEvidenceExpanded(false);
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
    <article
      className={`row feed-post-card post-card-palette post-content-typeface-${formatAppearance.contentTypeface}`}
      style={appearanceStyle}
    >
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
        <form className="feed-post-form edit-post-form" ref={editSpotlightTargetRef} onSubmit={handleUpdate}>
          <label htmlFor={evidenceInputId}>Content</label>
          {contentHint === "" ? null : (
            <span id={evidenceHintId} className="field-hint">
              {contentHint}
            </span>
          )}
          <textarea
            id={evidenceInputId}
            className="evidence-textarea"
            required
            aria-describedby={contentHint === "" ? undefined : evidenceHintId}
            value={evidenceText}
            onChange={(event) => {
              setEvidenceText(event.target.value);
              setFormError("");
            }}
            onBlur={() => setContentFocused(false)}
            onFocus={() => {
              setCaptionFocused(false);
              setContentFocused(true);
            }}
          />
          {captionsEnabled ? (
            <label>
              Caption
              <textarea
                className="caption-textarea"
                ref={captionSpotlightTargetRef}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                onBlur={() => setCaptionFocused(false)}
                onFocus={() => {
                  setContentFocused(false);
                  setCaptionFocused(true);
                }}
              />
            </label>
          ) : null}
          <div className="output-actions">
            <button
              className="secondary"
              type="button"
              disabled={saving}
              onClick={() => {
                setContentFocused(false);
                setCaptionFocused(false);
                setEditing(false);
              }}
            >
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
          <div className={`post-content-preview ${evidenceCollapsed ? "preview" : ""}`} ref={spotlightTargetRef}>
            <div className="post-content-preview-body" id={evidenceContentId} style={{ height: evidenceRevealHeight }}>
              <div className={`post-evidence-layout ${hasCaption ? "has-caption" : ""}`} ref={evidenceLayoutRef}>
                <div className="post-evidence-column">
                  {shouldShowPostFormat(post) ? (
                    <div className="post-format-meta">
                      {post.evidence_format.name} · v{post.evidence_format_version.version_number}
                      {post.evidence_format.archived_at !== undefined ? " · Archived" : ""}
                    </div>
                  ) : null}
                  <EvidenceCodeBlock
                    collapsed={evidenceCollapsed}
                    collapseButtonRef={collapseEvidenceButtonRef}
                    contentId={evidenceContentId}
                    expanded={evidenceExpanded}
                    hasPreview={evidenceHasPreview}
                    preview={evidencePreview}
                    renderRef={evidenceRenderRef}
                    typeface={formatAppearance.contentTypeface}
                    onCollapse={collapseEvidence}
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
            </div>
            {evidenceCollapsed ? (
              <button
                aria-expanded={false}
                aria-controls={evidenceContentId}
                aria-label="Expand content"
                className="post-content-expand-button"
                ref={expandEvidenceButtonRef}
                type="button"
                onClick={expandEvidence}
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

function prepareEvidencePreview(value: string, typeface: PostContentTypeface) {
  const preparedCode =
    typeface === "monospace"
      ? prepareCodeBlock(value)
      : {
          code: value,
          languageHint: null,
        };
  const lines = preparedCode.code.split(/\r?\n/);
  return {
    preparedCode,
    collapsedCode: lines.slice(0, EVIDENCE_PREVIEW_LINE_LIMIT).join("\n"),
    hasLogicalPreview: lines.length > EVIDENCE_PREVIEW_LINE_LIMIT,
  };
}

function postCardAppearanceStyle(palette: PostCardPaletteSummary): CSSProperties {
  return compileCardPalette(palette.material_intent).tokens as CSSProperties;
}

function postCardAppearanceKey(palette: PostCardPaletteSummary, themeProfileId: string): string {
  return `${themeProfileId}:${palette.id}:${palette.revision}`;
}

function EvidenceCodeBlock({
  collapsed,
  collapseButtonRef,
  contentId,
  expanded,
  hasPreview,
  preview,
  renderRef,
  typeface,
  onCollapse,
}: {
  collapsed: boolean;
  collapseButtonRef: RefObject<HTMLButtonElement | null>;
  contentId: string;
  expanded: boolean;
  hasPreview: boolean;
  preview: ReturnType<typeof prepareEvidencePreview>;
  renderRef: RefObject<HTMLElement | null>;
  typeface: PostContentTypeface;
  onCollapse: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const controlsVisible = !collapsed;
  const displayText = preview.preparedCode.code;
  const highlightedCode =
    typeface === "monospace"
      ? highlightCodeBlock(displayText, preview.preparedCode.code, preview.preparedCode.languageHint)
      : null;
  const codeClassName =
    highlightedCode === null ? undefined : `post-evidence-code-content language-${highlightedCode.language}`;
  const codeNode =
    highlightedCode === null ? (
      <code className="post-evidence-code-content">{displayText}</code>
    ) : (
      <code className={codeClassName} dangerouslySetInnerHTML={{ __html: highlightedCode.html }} />
    );
  const contentNode =
    typeface === "monospace" ? (
      <pre
        className={controlsVisible ? "post-evidence-code has-controls" : "post-evidence-code"}
        ref={renderRef as RefObject<HTMLPreElement | null>}
      >
        <span aria-hidden={collapsed ? true : undefined}>{codeNode}</span>
        {collapsed ? <code className="visually-hidden">{preview.collapsedCode}</code> : null}
      </pre>
    ) : (
      <div
        className={
          controlsVisible
            ? "post-evidence-code post-evidence-text has-controls"
            : "post-evidence-code post-evidence-text"
        }
        ref={renderRef as RefObject<HTMLDivElement | null>}
      >
        <span aria-hidden={collapsed ? true : undefined} className="post-evidence-text-content">
          {displayText}
        </span>
        {collapsed ? <span className="visually-hidden">{preview.collapsedCode}</span> : null}
      </div>
    );

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyEvidence() {
    if (navigator.clipboard !== undefined) {
      try {
        await navigator.clipboard.writeText(preview.preparedCode.code);
        setCopied(true);
        return;
      } catch {
        // Fall through for browsers or contexts that deny Clipboard API access.
      }
    }

    setCopied(copyTextWithSelection(preview.preparedCode.code));
  }

  return (
    <div className="post-evidence-code-wrap">
      {contentNode}
      {controlsVisible ? (
        <div className={`post-evidence-controls ${hasPreview && expanded ? "post-evidence-controls-revealed" : ""}`}>
          {hasPreview && expanded ? (
            <button
              aria-controls={contentId}
              aria-expanded={true}
              aria-label="Collapse content"
              className="icon-button post-evidence-control"
              ref={collapseButtonRef}
              title="Collapse content"
              type="button"
              onClick={onCollapse}
            >
              <PostActionIcon>
                <path d="m18 15-6-6-6 6" />
              </PostActionIcon>
            </button>
          ) : null}
          <button
            aria-label={copied ? "Content copied" : "Copy content"}
            className="icon-button post-evidence-control"
            title={copied ? "Content copied" : "Copy content"}
            type="button"
            onClick={() => {
              void copyEvidence();
            }}
          >
            <PostActionIcon>
              {copied ? (
                <path d="m5 12 4 4L19 6" />
              ) : (
                <>
                  <rect height="13" rx="2" width="13" x="9" y="9" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </>
              )}
            </PostActionIcon>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function copyTextWithSelection(value: string): boolean {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
    previouslyFocused?.focus();
  }
}
