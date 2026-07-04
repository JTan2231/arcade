import type {
  CatalogSource,
  CreateDailyFeedRequest,
  CreateFeedMetricJudgmentRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedPreview,
  EvidenceFormat,
  FeedMetric,
  Group,
  GroupFeedPost,
  GroupPostTag,
  MetricLeaderboard,
} from "../types";

import { AddFeedDialog } from "./dashboard/AddFeedDialog";
import { FeedOutput, type LoadFeedOutputSummaries } from "./dashboard/FeedOutput";
import type { CreateFeedPostPayload, UpdateFeedPostPayload } from "./dashboard/FeedPosts";
import { MetricsSection } from "./dashboard/MetricsSection";

export type GroupDashboardProps = {
  group: Group | null;
  feeds: DailyFeed[];
  selectedFeedId: string | null;
  selectedFeedDate: string;
  output: DailyFeedOutput | null;
  outputLoading: boolean;
  outputError: string;
  posts: GroupFeedPost[];
  postTags: GroupPostTag[];
  postsLoading: boolean;
  postsError: string;
  metrics: FeedMetric[];
  selectedMetricId: string | null;
  metricLeaderboard: MetricLeaderboard | null;
  metricsLoading: boolean;
  leaderboardLoading: boolean;
  metricsError: string;
  postSubmitting: boolean;
  updatingPostId: string | null;
  deletingPostId: string | null;
  judgingPostId: string | null;
  currentUserId: string | null;
  addFeedOpen: boolean;
  addFeedSources: CatalogSource[];
  addFeedEvidenceFormats: EvidenceFormat[];
  addFeedSourcesLoading: boolean;
  addFeedPreview: DailyFeedPreview | null;
  addFeedPreviewLoading: boolean;
  addFeedSaving: boolean;
  addFeedError: string;
  loadFeedOutputSummaries: LoadFeedOutputSummaries | undefined;
  onChangeFeedDate: (date: string) => void;
  onCloseAddFeed: () => void;
  onAddFeedDraftChanged: () => void;
  onPreviewFeed: (payload: CreateDailyFeedRequest) => void;
  onCreateFeed: (payload: CreateDailyFeedRequest) => void;
  onCreateFeedPost: (payload: CreateFeedPostPayload) => void;
  onUpdateFeedPost: (postId: string, payload: UpdateFeedPostPayload) => void;
  onCopyPublicPostLink: (postId: string) => void;
  onDeleteFeedPost: (postId: string) => void;
  onSelectMetric: (metricId: string) => void;
  onAddMetric?: () => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
  readOnly?: boolean;
  standalone?: boolean;
  onSelectFeed?: (feedId: string) => void;
};

export function GroupDashboard({
  group,
  feeds,
  selectedFeedId,
  selectedFeedDate,
  output,
  outputLoading,
  outputError,
  posts,
  postTags,
  postsLoading,
  postsError,
  metrics,
  selectedMetricId,
  metricLeaderboard,
  metricsLoading,
  leaderboardLoading,
  metricsError,
  postSubmitting,
  updatingPostId,
  deletingPostId,
  judgingPostId,
  currentUserId,
  addFeedOpen,
  addFeedSources,
  addFeedEvidenceFormats,
  addFeedSourcesLoading,
  addFeedPreview,
  addFeedPreviewLoading,
  addFeedSaving,
  addFeedError,
  loadFeedOutputSummaries,
  onChangeFeedDate,
  onCloseAddFeed,
  onAddFeedDraftChanged,
  onPreviewFeed,
  onCreateFeed,
  onCreateFeedPost,
  onUpdateFeedPost,
  onCopyPublicPostLink,
  onDeleteFeedPost,
  onSelectMetric,
  onAddMetric,
  onCreateMetricJudgment,
  readOnly = false,
  standalone = false,
  onSelectFeed,
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

  const feed = feeds.find((candidate) => candidate.id === selectedFeedId) || null;
  const activeMember = group.my_status === "active";
  const canPost = !readOnly && activeMember;
  const canManageMetrics = !readOnly && activeMember && (group.my_role === "owner" || group.my_role === "admin");
  const canManagePostTags = !readOnly && activeMember && (group.my_role === "owner" || group.my_role === "admin");
  const publicLinksAvailable = group.visibility === "public";
  const judgedMetrics = metrics.filter((metric) => metric.system_key === "judged");

  return (
    <>
      <section className="panel group-dashboard-panel group-dashboard-feed-panel">
        <section className="dashboard-section feed-output-section" aria-label="Selected feed output">
          {standalone ? (
            <div className="feed-route-header">
              <div>
                <div className="section-title">{group.name}</div>
                <h2>{feed?.name ?? "No feed selected"}</h2>
                {feed?.description !== undefined && feed.description !== "" ? (
                  <p>{feed.description}</p>
                ) : group.description !== undefined && group.description !== "" ? (
                  <p>{group.description}</p>
                ) : null}
              </div>
              {feeds.length > 1 && onSelectFeed !== undefined ? (
                <label className="date-control feed-select-control">
                  Feed
                  <select value={selectedFeedId ?? ""} onChange={(event) => onSelectFeed(event.target.value)}>
                    {feeds.map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          <FeedOutput
            feed={feed}
            selectedFeedDate={selectedFeedDate}
            output={output}
            loading={outputLoading}
            error={outputError}
            posts={posts}
            postTags={postTags}
            postsLoading={postsLoading}
            postsError={postsError}
            postSubmitting={postSubmitting}
            updatingPostId={updatingPostId}
            deletingPostId={deletingPostId}
            currentUserId={currentUserId}
            publicLinksAvailable={publicLinksAvailable}
            judgedMetrics={judgedMetrics}
            canPost={canPost}
            canJudge={canManageMetrics}
            canManagePostTags={canManagePostTags}
            judgingPostId={judgingPostId}
            loadFeedOutputSummaries={loadFeedOutputSummaries}
            onChangeFeedDate={onChangeFeedDate}
            onCreateFeedPost={onCreateFeedPost}
            onUpdateFeedPost={onUpdateFeedPost}
            onCopyPublicPostLink={onCopyPublicPostLink}
            onDeleteFeedPost={onDeleteFeedPost}
            onCreateMetricJudgment={onCreateMetricJudgment}
          />
        </section>
        {addFeedOpen ? (
          <AddFeedDialog
            feeds={feeds}
            formError={addFeedError}
            evidenceFormats={addFeedEvidenceFormats}
            preview={addFeedPreview}
            previewLoading={addFeedPreviewLoading}
            saving={addFeedSaving}
            sources={addFeedSources}
            sourcesLoading={addFeedSourcesLoading}
            onClose={onCloseAddFeed}
            onCreateFeed={onCreateFeed}
            onDraftChanged={onAddFeedDraftChanged}
            onPreviewFeed={onPreviewFeed}
          />
        ) : null}
      </section>
      {!readOnly ? (
        <MetricsSection
          feed={feed}
          metrics={metrics}
          selectedMetricId={selectedMetricId}
          leaderboard={metricLeaderboard}
          metricsLoading={metricsLoading}
          leaderboardLoading={leaderboardLoading}
          error={metricsError}
          {...(canManageMetrics && onAddMetric !== undefined ? { onAddMetric } : {})}
          onSelectMetric={onSelectMetric}
        />
      ) : null}
    </>
  );
}
