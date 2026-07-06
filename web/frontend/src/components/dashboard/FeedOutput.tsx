import { useEffect, useRef, useState, type ReactNode } from "react";

import { feedDateOptions, formatDateLabel } from "../../dates";
import type {
  CreateFeedMetricJudgmentRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedOutputItem,
  DailyFeedOutputSummary,
  FeedMetric,
  GroupFeedPost,
  GroupPostTag,
} from "../../types";
import { FeedPostSection, type CreateFeedPostPayload, type UpdateFeedPostPayload } from "./FeedPosts";
import { feedOutputSummary, firstNonEmpty, outputItemDisplayTitle, primitiveDisplay } from "./format";

export type LoadFeedOutputSummaries = (selectedDate: string, signal: AbortSignal) => Promise<DailyFeedOutputSummary[]>;

export function FeedOutput({
  feed,
  selectedFeedDate,
  output,
  loading,
  error,
  posts,
  postTags,
  postsLoading,
  postsError,
  postSubmitting,
  updatingPostId,
  deletingPostId,
  currentUserId,
  judgedMetrics,
  canPost,
  canJudge,
  canManagePostTags,
  judgingPostId,
  loadFeedOutputSummaries,
  onChangeFeedDate,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  feed: DailyFeed | null;
  selectedFeedDate: string;
  output: DailyFeedOutput | null;
  loading: boolean;
  error: string;
  posts: GroupFeedPost[];
  postTags: GroupPostTag[];
  postsLoading: boolean;
  postsError: string;
  postSubmitting: boolean;
  updatingPostId: string | null;
  deletingPostId: string | null;
  currentUserId: string | null;
  judgedMetrics: FeedMetric[];
  canPost: boolean;
  canJudge: boolean;
  canManagePostTags: boolean;
  judgingPostId: string | null;
  loadFeedOutputSummaries: LoadFeedOutputSummaries | undefined;
  onChangeFeedDate: (date: string) => void;
  onCreateFeedPost: (payload: CreateFeedPostPayload) => void;
  onUpdateFeedPost: (postId: string, payload: UpdateFeedPostPayload) => void;
  onDeleteFeedPost: (postId: string) => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
}) {
  if (!feed) {
    return <div className="empty-state">Select a feed to view its daily output.</div>;
  }
  if (loading) {
    return (
      <FeedOutputStatus
        fallbackTitle="Loading output..."
        feed={feed}
        selectedFeedDate={selectedFeedDate}
        loadFeedOutputSummaries={loadFeedOutputSummaries}
        onChangeFeedDate={onChangeFeedDate}
      >
        <div className="empty-state">Loading output...</div>
      </FeedOutputStatus>
    );
  }
  if (error) {
    return (
      <FeedOutputStatus
        fallbackTitle="Output unavailable"
        feed={feed}
        selectedFeedDate={selectedFeedDate}
        loadFeedOutputSummaries={loadFeedOutputSummaries}
        onChangeFeedDate={onChangeFeedDate}
      >
        <div className="form-error" role="alert">
          {error}
        </div>
      </FeedOutputStatus>
    );
  }
  if (!output) {
    return (
      <FeedOutputStatus
        fallbackTitle="No output loaded"
        feed={feed}
        selectedFeedDate={selectedFeedDate}
        loadFeedOutputSummaries={loadFeedOutputSummaries}
        onChangeFeedDate={onChangeFeedDate}
      >
        <div className="empty-state">No output loaded.</div>
      </FeedOutputStatus>
    );
  }

  return (
    <LoadedFeedOutput
      feed={feed}
      selectedFeedDate={selectedFeedDate}
      output={output}
      posts={posts}
      postTags={postTags}
      postsLoading={postsLoading}
      postsError={postsError}
      postSubmitting={postSubmitting}
      updatingPostId={updatingPostId}
      deletingPostId={deletingPostId}
      currentUserId={currentUserId}
      judgedMetrics={judgedMetrics}
      canPost={canPost}
      canJudge={canJudge}
      canManagePostTags={canManagePostTags}
      judgingPostId={judgingPostId}
      loadFeedOutputSummaries={loadFeedOutputSummaries}
      onChangeFeedDate={onChangeFeedDate}
      onCreateFeedPost={onCreateFeedPost}
      onUpdateFeedPost={onUpdateFeedPost}
      onDeleteFeedPost={onDeleteFeedPost}
      onCreateMetricJudgment={onCreateMetricJudgment}
    />
  );
}

function FeedOutputStatus({
  feed,
  selectedFeedDate,
  fallbackTitle,
  loadFeedOutputSummaries,
  onChangeFeedDate,
  children,
}: {
  feed: DailyFeed;
  selectedFeedDate: string;
  fallbackTitle: string;
  loadFeedOutputSummaries: LoadFeedOutputSummaries | undefined;
  onChangeFeedDate: (date: string) => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="feed-output-title-row">
        <FeedOutputTitleMenu
          fallbackTitle={fallbackTitle}
          feed={feed}
          output={null}
          selectedFeedDate={selectedFeedDate}
          loadFeedOutputSummaries={loadFeedOutputSummaries}
          onChangeFeedDate={onChangeFeedDate}
        />
      </div>
      {children}
    </>
  );
}

function LoadedFeedOutput({
  feed,
  selectedFeedDate,
  output,
  posts,
  postTags,
  postsLoading,
  postsError,
  postSubmitting,
  updatingPostId,
  deletingPostId,
  currentUserId,
  judgedMetrics,
  canPost,
  canJudge,
  canManagePostTags,
  judgingPostId,
  loadFeedOutputSummaries,
  onChangeFeedDate,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  feed: DailyFeed;
  selectedFeedDate: string;
  output: DailyFeedOutput;
  posts: GroupFeedPost[];
  postTags: GroupPostTag[];
  postsLoading: boolean;
  postsError: string;
  postSubmitting: boolean;
  updatingPostId: string | null;
  deletingPostId: string | null;
  currentUserId: string | null;
  judgedMetrics: FeedMetric[];
  canPost: boolean;
  canJudge: boolean;
  canManagePostTags: boolean;
  judgingPostId: string | null;
  loadFeedOutputSummaries: LoadFeedOutputSummaries | undefined;
  onChangeFeedDate: (date: string) => void;
  onCreateFeedPost: (payload: CreateFeedPostPayload) => void;
  onUpdateFeedPost: (postId: string, payload: UpdateFeedPostPayload) => void;
  onDeleteFeedPost: (postId: string) => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
}) {
  const items = output.items;
  const isDailyThread = feed.kind === "daily_thread";
  const titleMenu = (
    <FeedOutputTitleMenu
      feed={feed}
      output={output}
      selectedFeedDate={selectedFeedDate}
      loadFeedOutputSummaries={loadFeedOutputSummaries}
      onChangeFeedDate={onChangeFeedDate}
    />
  );

  return (
    <>
      {items.length !== 1 ? <div className="feed-output-title-row">{titleMenu}</div> : null}
      {items.length ? (
        <div className="stack output-items">
          {items.map((item) => {
            const titleControl = items.length === 1 ? titleMenu : undefined;
            return (
              <OutputItem
                item={item}
                key={`${item.position}-${firstNonEmpty(item.item.id, item.role)}`}
                titleControl={titleControl}
              />
            );
          })}
        </div>
      ) : !isDailyThread ? (
        <div className="empty-state">No generated items for {output.date}.</div>
      ) : null}
      <FeedPostSection
        key={`${feed.id}-${output.date}`}
        disabled={!feed.enabled}
        evidenceFormat={feed.evidence_format}
        posts={posts}
        postTags={postTags}
        loading={postsLoading}
        error={postsError}
        submitting={postSubmitting}
        updatingPostId={updatingPostId}
        deletingPostId={deletingPostId}
        currentUserId={currentUserId}
        judgedMetrics={judgedMetrics}
        canPost={canPost}
        canJudge={canJudge}
        canManagePostTags={canManagePostTags}
        judgingPostId={judgingPostId}
        onCreateFeedPost={onCreateFeedPost}
        onUpdateFeedPost={onUpdateFeedPost}
        onDeleteFeedPost={onDeleteFeedPost}
        onCreateMetricJudgment={onCreateMetricJudgment}
      />
    </>
  );
}

function FeedOutputTitleMenu({
  feed,
  output,
  fallbackTitle,
  selectedFeedDate,
  loadFeedOutputSummaries,
  onChangeFeedDate,
}: {
  feed: DailyFeed;
  output: DailyFeedOutput | null;
  fallbackTitle?: string;
  selectedFeedDate: string;
  loadFeedOutputSummaries: LoadFeedOutputSummaries | undefined;
  onChangeFeedDate: (date: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [summariesByDate, setSummariesByDate] = useState<Record<string, DailyFeedOutputSummary>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fallbackDateOptions = feedDateOptions(selectedFeedDate, feed.created_at);
  const summaryDateOptions = Object.values(summariesByDate)
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((summary) => ({ value: summary.date, label: formatDateLabel(summary.date) }));
  const dateOptions = historyLoaded && summaryDateOptions.length > 0 ? summaryDateOptions : fallbackDateOptions;
  const selectedDateInOptions = dateOptions.some((option) => option.value === selectedFeedDate);
  const visibleDateOptions = selectedDateInOptions
    ? dateOptions
    : [
        { value: selectedFeedDate, label: formatDateLabel(selectedFeedDate) },
        ...dateOptions.filter((option) => option.value !== selectedFeedDate),
      ];
  const currentSummary =
    output !== null
      ? feedOutputSummary(output)
      : {
          feed_id: feed.id,
          date: selectedFeedDate,
          title: fallbackTitle ?? "Output",
          subtitle: selectedFeedDate,
        };
  const currentItem = output !== null && output.items.length === 1 ? output.items[0]! : null;

  useEffect(() => {
    setSummariesByDate({});
    setHistoryLoaded(false);
  }, [feed.id]);

  useEffect(() => {
    if (output === null) {
      return;
    }
    const summary = feedOutputSummary(output);
    setSummariesByDate((current) => ({
      ...current,
      [summary.date]: summary,
    }));
  }, [output]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node) === true) {
        return;
      }
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [feed.id, currentSummary.date]);

  useEffect(() => {
    if (!menuOpen || loadFeedOutputSummaries === undefined) {
      setHistoryLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setHistoryLoading(true);
    void loadFeedOutputSummaries(selectedFeedDate, controller.signal)
      .then((summaries) => {
        if (controller.signal.aborted) {
          return;
        }
        setSummariesByDate((current) => {
          const next = { ...current };
          for (const summary of summaries) {
            if (summary.feed_id === feed.id) {
              next[summary.date] = summary;
            }
          }
          return next;
        });
        setHistoryLoaded(true);
        setHistoryLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHistoryLoading(false);
        }
      });

    return () => controller.abort();
  }, [feed.id, loadFeedOutputSummaries, menuOpen, selectedFeedDate]);

  const titleNode =
    currentItem !== null ? (
      <OutputItemTitle item={currentItem} title={currentSummary.title} />
    ) : (
      <span className="title feed-output-title-text">{currentSummary.title}</span>
    );

  return (
    <div className="feed-output-title-menu" ref={menuRef}>
      <span className="feed-output-title-control">
        <span className="feed-output-title-label">{titleNode}</span>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="true"
          aria-label="Feed output choices"
          className="metric-title-caret-button feed-output-title-caret-button"
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span className="metric-title-caret" aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </span>
      {menuOpen ? (
        <div
          aria-busy={historyLoading}
          aria-label="Feed output choices"
          className="metric-title-menu-panel feed-output-title-menu-panel"
        >
          {visibleDateOptions.map((option) => {
            const summary = summariesByDate[option.value] ?? null;
            const optionTitle = summary?.title ?? option.label;
            const optionSubtitle = summary?.subtitle;
            return (
              <button
                aria-label={`Select ${optionTitle} (${option.value})`}
                aria-pressed={option.value === currentSummary.date}
                className="metric-title-menu-option"
                key={option.value}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (option.value !== currentSummary.date) {
                    onChangeFeedDate(option.value);
                  }
                }}
              >
                <span className="title">{optionTitle}</span>
                {optionSubtitle !== undefined ? <span className="meta">{optionSubtitle}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function OutputItem({ item, titleControl }: { item: DailyFeedOutputItem; titleControl?: ReactNode }) {
  const catalogItem = item.item;
  const data = catalogItem.data;
  const rating = primitiveDisplay(data["rating"]);
  const details = rating !== "" ? [`Rating ${rating}`] : [];
  const displayTitle = outputItemDisplayTitle(item);

  return (
    <div className="output-item">
      <div className="output-item-main">
        <div>
          {titleControl ?? <OutputItemTitle item={item} title={displayTitle} />}
          {details.map((detail) => (
            <div className="meta" key={detail}>
              {detail}
            </div>
          ))}
          {item.action?.type === "text" && item.action.text !== undefined && item.action.text !== "" ? (
            <details className="prompt-details">
              <summary>{firstNonEmpty(item.action.label, "Prompt")}</summary>
              <pre>{item.action.text}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OutputItemTitle({ item, title }: { item: DailyFeedOutputItem; title: string }) {
  const action = item.action;
  if (action?.type === "external_url" && action.url !== undefined && action.url !== "") {
    return (
      <a className="output-item-title-link" href={action.url} target="_blank" rel="noreferrer">
        {title}
      </a>
    );
  }

  return <div className="title">{title}</div>;
}
