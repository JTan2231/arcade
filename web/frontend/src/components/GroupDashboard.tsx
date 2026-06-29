import { FormEvent, useEffect, useState } from "react";

import { feedDateOptions, formatDateLabel } from "../dates";
import { errorMessage } from "../errors";
import type {
  CatalogSource,
  CatalogSourceField,
  CreateDailyFeedRequest,
  CreateFeedMetricJudgmentRequest,
  CreateFeedMetricRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedOutputItem,
  DailyFeedPreview,
  DailyFeedRuleFilter,
  FeedMetric,
  FeedMetricKey,
  Group,
  GroupFeedPost,
  GroupInviteCandidate,
  MetricAggregation,
  MetricLeaderboard,
  MetricLeaderboardRow,
  PatchFeedMetricRequest,
  PublicUser,
  SystemMetricKey,
} from "../types";

type GroupDashboardProps = {
  group: Group | null;
  feeds: DailyFeed[];
  selectedFeedId: string | null;
  selectedFeedDate: string;
  output: DailyFeedOutput | null;
  outputLoading: boolean;
  outputError: string;
  posts: GroupFeedPost[];
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
  metricSubmitting: boolean;
  updatingMetricId: string | null;
  deletingMetricId: string | null;
  judgingPostId: string | null;
  currentUserId: string | null;
  addFeedOpen: boolean;
  addFeedSources: CatalogSource[];
  addFeedSourcesLoading: boolean;
  addFeedPreview: DailyFeedPreview | null;
  addFeedPreviewLoading: boolean;
  addFeedSaving: boolean;
  addFeedError: string;
  inviteCandidates: GroupInviteCandidate[];
  inviteCandidatesLoading: boolean;
  invitingUserId: string | null;
  onChangeFeedDate: (date: string) => void;
  onCloseAddFeed: () => void;
  onAddFeedDraftChanged: () => void;
  onPreviewFeed: (payload: CreateDailyFeedRequest) => void;
  onCreateFeed: (payload: CreateDailyFeedRequest) => void;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => void;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
  onDeleteFeedPost: (postId: string) => void;
  onSelectMetric: (metricId: string) => void;
  onCreateMetric: (payload: CreateFeedMetricRequest) => void;
  onUpdateMetric: (metricId: string, payload: PatchFeedMetricRequest) => void;
  onDeleteMetric: (metricId: string) => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
  onInviteFriend: (userId: string) => void;
  onCancelGroupInvite: (userId: string) => void;
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
  metricSubmitting,
  updatingMetricId,
  deletingMetricId,
  judgingPostId,
  currentUserId,
  addFeedOpen,
  addFeedSources,
  addFeedSourcesLoading,
  addFeedPreview,
  addFeedPreviewLoading,
  addFeedSaving,
  addFeedError,
  inviteCandidates,
  inviteCandidatesLoading,
  invitingUserId,
  onChangeFeedDate,
  onCloseAddFeed,
  onAddFeedDraftChanged,
  onPreviewFeed,
  onCreateFeed,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onSelectMetric,
  onCreateMetric,
  onUpdateMetric,
  onDeleteMetric,
  onCreateMetricJudgment,
  onInviteFriend,
  onCancelGroupInvite,
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
  const canManageMetrics = group.my_role === "owner" || group.my_role === "admin";
  const judgedMetrics = metrics.filter((metric) => metric.system_key === "judged");

  return (
    <section className="panel group-dashboard-panel">
      <div className={`feed-card-grid ${group.my_status !== "active" ? "without-friends-rail" : ""}`}>
        <section className="dashboard-section feed-output-section" aria-label="Selected feed output">
          {feed ? (
            <div className="feed-card-header">
              <label className="date-control feed-date-control">
                Date
                <select value={selectedFeedDate} onChange={(event) => onChangeFeedDate(event.target.value)}>
                  {feedDateOptions(selectedFeedDate, feed.created_at).map((option) => (
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
            updatingPostId={updatingPostId}
            deletingPostId={deletingPostId}
            currentUserId={currentUserId}
            judgedMetrics={judgedMetrics}
            canJudge={canManageMetrics}
            judgingPostId={judgingPostId}
            onCreateFeedPost={onCreateFeedPost}
            onUpdateFeedPost={onUpdateFeedPost}
            onDeleteFeedPost={onDeleteFeedPost}
            onCreateMetricJudgment={onCreateMetricJudgment}
          />
          <MetricsSection
            feed={feed}
            metrics={metrics}
            selectedMetricId={selectedMetricId}
            leaderboard={metricLeaderboard}
            metricsLoading={metricsLoading}
            leaderboardLoading={leaderboardLoading}
            error={metricsError}
            canManage={canManageMetrics}
            metricSubmitting={metricSubmitting}
            updatingMetricId={updatingMetricId}
            deletingMetricId={deletingMetricId}
            onSelectMetric={onSelectMetric}
            onCreateMetric={onCreateMetric}
            onUpdateMetric={onUpdateMetric}
            onDeleteMetric={onDeleteMetric}
          />
        </section>
        {group.my_status === "active" ? (
          <aside className="feed-friends-rail">
            <InviteFriends
              candidates={inviteCandidates}
              loading={inviteCandidatesLoading}
              invitingUserId={invitingUserId}
              onInviteFriend={onInviteFriend}
              onCancelGroupInvite={onCancelGroupInvite}
            />
          </aside>
        ) : null}
      </div>
      {addFeedOpen ? (
        <AddFeedDialog
          feeds={feeds}
          formError={addFeedError}
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
  );
}

function InviteFriends({
  candidates,
  loading,
  invitingUserId,
  onInviteFriend,
  onCancelGroupInvite,
}: {
  candidates: GroupInviteCandidate[];
  loading: boolean;
  invitingUserId: string | null;
  onInviteFriend: (userId: string) => void;
  onCancelGroupInvite: (userId: string) => void;
}) {
  return (
    <section className="invite-friends-section" aria-label="Invite friends">
      <div className="section-title">Invite friends</div>
      <div className="stack">
        {loading ? <div className="meta">Loading friends...</div> : null}
        {!loading && !candidates.length ? <div className="meta">No eligible friends</div> : null}
        {candidates.map((candidate) => {
          const pending = candidate.membership_status === "invited";
          return (
            <div className="row social-row" key={candidate.user.id}>
              <div>
                <div className="title">{candidate.user.display_name || candidate.user.username}</div>
                <div className="meta">@{candidate.user.username}</div>
              </div>
              <button
                className={pending ? "secondary" : undefined}
                type="button"
                disabled={invitingUserId === candidate.user.id}
                onClick={() => {
                  if (pending) {
                    onCancelGroupInvite(candidate.user.id);
                    return;
                  }
                  onInviteFriend(candidate.user.id);
                }}
              >
                {pending ? "Cancel" : "Invite"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type FeedKind = "catalog_daily" | "daily_thread";

type DraftFilter = {
  id: string;
  fieldId: string;
  op: string;
  textValue: string;
  numberValue: string;
  numberMaxValue: string;
};

function AddFeedDialog({
  feeds,
  formError,
  preview,
  previewLoading,
  saving,
  sources,
  sourcesLoading,
  onClose,
  onDraftChanged,
  onPreviewFeed,
  onCreateFeed,
}: {
  feeds: DailyFeed[];
  formError: string;
  preview: DailyFeedPreview | null;
  previewLoading: boolean;
  saving: boolean;
  sources: CatalogSource[];
  sourcesLoading: boolean;
  onClose: () => void;
  onDraftChanged: () => void;
  onPreviewFeed: (payload: CreateDailyFeedRequest) => void;
  onCreateFeed: (payload: CreateDailyFeedRequest) => void;
}) {
  const canCreateDailyThread = !feeds.some((feed) => feed.kind === "daily_thread");
  const [kind, setKind] = useState<FeedKind>("catalog_daily");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [sourceId, setSourceId] = useState("");
  const [itemCount, setItemCount] = useState("3");
  const [startsAt, setStartsAt] = useState(defaultStartsAtInput);
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [intervalSeconds, setIntervalSeconds] = useState("86400");
  const [filters, setFilters] = useState<DraftFilter[]>([]);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    const firstSourceId = sources[0]?.id ?? "";
    if (sourceId === "") {
      setSourceId(firstSourceId);
      return;
    }
    if (!sources.some((source) => source.id === sourceId)) {
      setSourceId(firstSourceId);
    }
  }, [sourceId, sources]);

  const selectedSource = sources.find((source) => source.id === sourceId) || null;
  const sourceFields = selectedSource?.fields || [];
  const practice = kind === "catalog_daily";
  const visibleError = validationError || formError;

  function markDraftChanged() {
    setValidationError("");
    onDraftChanged();
  }

  function handleKindChange(nextKind: FeedKind) {
    setKind(nextKind);
    markDraftChanged();
    if (nextKind === "daily_thread") {
      setFilters([]);
    }
  }

  function handleSourceChange(nextSourceId: string) {
    setSourceId(nextSourceId);
    setFilters([]);
    markDraftChanged();
  }

  function handleAddFilter() {
    const field = sourceFields[0];
    if (!field) {
      return;
    }
    setFilters((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        fieldId: field.id,
        op: defaultOperatorForField(field),
        textValue: "",
        numberValue: "",
        numberMaxValue: "",
      },
    ]);
    markDraftChanged();
  }

  function updateFilter(id: string, patch: Partial<DraftFilter>) {
    setFilters((current) => current.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)));
    markDraftChanged();
  }

  function removeFilter(id: string) {
    setFilters((current) => current.filter((filter) => filter.id !== id));
    markDraftChanged();
  }

  function buildPayload(): CreateDailyFeedRequest {
    const trimmedName = name.trim() || (kind === "daily_thread" ? "Daily Thread" : "");
    if (!trimmedName) {
      throw new Error("Name is required");
    }
    const schedule = {
      starts_at: localInputToISOString(startsAt),
      timezone: timezone.trim() || "UTC",
      interval_seconds: Number(intervalSeconds),
    };
    if (!Number.isFinite(schedule.interval_seconds) || schedule.interval_seconds < 1) {
      throw new Error("Repeat interval is invalid");
    }

    const payload: CreateDailyFeedRequest = {
      name: trimmedName,
      kind,
      enabled,
      schedule,
    };
    const trimmedDescription = description.trim();
    if (trimmedDescription) {
      payload.description = trimmedDescription;
    }

    if (kind === "daily_thread") {
      return payload;
    }
    if (!sourceId) {
      throw new Error("Source is required");
    }
    const parsedItemCount = Number(itemCount);
    if (!Number.isInteger(parsedItemCount) || parsedItemCount < 1) {
      throw new Error("Item count is invalid");
    }
    payload.source_id = sourceId;
    payload.item_count = parsedItemCount;
    payload.filters = filters.map((filter) => draftFilterToRequest(filter, sourceFields));
    return payload;
  }

  function handlePreview() {
    setValidationError("");
    let payload: CreateDailyFeedRequest;
    try {
      payload = buildPayload();
    } catch (error) {
      setValidationError(errorMessage(error));
      return;
    }
    if (payload.kind !== "catalog_daily") {
      return;
    }

    onPreviewFeed(payload);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError("");
    let payload: CreateDailyFeedRequest;
    try {
      payload = buildPayload();
    } catch (error) {
      setValidationError(errorMessage(error));
      return;
    }

    onCreateFeed(payload);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel add-feed-dialog" role="dialog" aria-modal="true" aria-labelledby="add-feed-title">
        <form className="add-feed-form" onSubmit={handleSubmit}>
          <div className="modal-header">
            <div>
              <h2 id="add-feed-title">Add feed</h2>
              <div className="meta">{practice ? "Practice feed" : "Daily thread"}</div>
            </div>
            <button className="secondary" type="button" onClick={onClose}>
              Close
            </button>
          </div>

          {canCreateDailyThread ? (
            <label>
              Type
              <select value={kind} onChange={(event) => handleKindChange(event.target.value as FeedKind)}>
                <option value="catalog_daily">Practice feed</option>
                <option value="daily_thread">Daily thread</option>
              </select>
            </label>
          ) : null}

          <div className="form-grid two-column">
            <label>
              Name
              <input
                value={name}
                placeholder={practice ? "Daily Practice" : "Daily Thread"}
                onChange={(event) => {
                  setName(event.target.value);
                  markDraftChanged();
                }}
              />
            </label>
            <label className="checkbox-row status-checkbox">
              <input
                checked={enabled}
                type="checkbox"
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  markDraftChanged();
                }}
              />
              Active
            </label>
          </div>

          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                markDraftChanged();
              }}
            />
          </label>

          {practice ? (
            <>
              <div className="form-grid two-column">
                <label>
                  Source
                  <select
                    disabled={sourcesLoading || !sources.length}
                    value={sourceId}
                    onChange={(event) => handleSourceChange(event.target.value)}
                  >
                    {sources.map((source) => (
                      <option value={source.id} key={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Item count
                  <input
                    min="1"
                    step="1"
                    type="number"
                    value={itemCount}
                    onChange={(event) => {
                      setItemCount(event.target.value);
                      markDraftChanged();
                    }}
                  />
                </label>
              </div>
              {!sourcesLoading && !sources.length ? (
                <div className="empty-state">No catalog sources available.</div>
              ) : null}
            </>
          ) : null}

          <div className="form-grid three-column">
            <label>
              Start time
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                  markDraftChanged();
                }}
              />
            </label>
            <label>
              Timezone
              <input
                value={timezone}
                onChange={(event) => {
                  setTimezone(event.target.value);
                  markDraftChanged();
                }}
              />
            </label>
            <label>
              Repeat
              <select
                value={intervalSeconds}
                onChange={(event) => {
                  setIntervalSeconds(event.target.value);
                  markDraftChanged();
                }}
              >
                <option value="86400">Daily</option>
                <option value="604800">Weekly</option>
                <option value="3600">Hourly</option>
              </select>
            </label>
          </div>

          {practice ? (
            <section className="feed-filters-section" aria-label="Filters">
              <div className="section-header-row">
                <div className="title">Filters</div>
                <button className="secondary" type="button" disabled={!sourceFields.length} onClick={handleAddFilter}>
                  Add filter
                </button>
              </div>
              {filters.length ? (
                <div className="stack">
                  {filters.map((filter) => (
                    <FilterEditor
                      fields={sourceFields}
                      filter={filter}
                      key={filter.id}
                      onChange={(patch) => updateFilter(filter.id, patch)}
                      onRemove={() => removeFilter(filter.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">No filters.</div>
              )}
            </section>
          ) : null}

          {preview ? <PreviewPanel preview={preview} /> : null}

          {visibleError ? (
            <div className="form-error" role="alert">
              {visibleError}
            </div>
          ) : null}

          <div className="output-actions">
            {practice ? (
              <button className="secondary" type="button" disabled={previewLoading || saving} onClick={handlePreview}>
                {previewLoading ? "Previewing..." : "Preview"}
              </button>
            ) : null}
            <button className="secondary" type="button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving || (practice && !sourceId)}>
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FilterEditor({
  fields,
  filter,
  onChange,
  onRemove,
}: {
  fields: CatalogSourceField[];
  filter: DraftFilter;
  onChange: (patch: Partial<DraftFilter>) => void;
  onRemove: () => void;
}) {
  const field = fields.find((candidate) => candidate.id === filter.fieldId) || fields[0] || null;
  const operators = field ? operatorsForField(field) : [];
  const currentOp = operators.some((operator) => operator.value === filter.op)
    ? filter.op
    : (operators[0]?.value ?? "");

  function handleFieldChange(fieldId: string) {
    const nextField = fields.find((candidate) => candidate.id === fieldId);
    onChange({
      fieldId,
      op: nextField ? defaultOperatorForField(nextField) : "",
      textValue: "",
      numberValue: "",
      numberMaxValue: "",
    });
  }

  return (
    <div className="filter-row">
      <label>
        Field
        <select value={filter.fieldId} onChange={(event) => handleFieldChange(event.target.value)}>
          {fields.map((candidate) => (
            <option value={candidate.id} key={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Operator
        <select value={currentOp} onChange={(event) => onChange({ op: event.target.value })}>
          {operators.map((operator) => (
            <option value={operator.value} key={operator.value}>
              {operator.label}
            </option>
          ))}
        </select>
      </label>
      <FilterValueInput field={field} filter={{ ...filter, op: currentOp }} onChange={onChange} />
      <button className="secondary filter-remove-button" type="button" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function FilterValueInput({
  field,
  filter,
  onChange,
}: {
  field: CatalogSourceField | null;
  filter: DraftFilter;
  onChange: (patch: Partial<DraftFilter>) => void;
}) {
  if (!field) {
    return <div />;
  }
  if (field.value_type === "number") {
    if (filter.op === "between") {
      return (
        <div className="filter-between-inputs">
          <label>
            Min
            <input
              type="number"
              value={filter.numberValue}
              onChange={(event) => onChange({ numberValue: event.target.value })}
            />
          </label>
          <label>
            Max
            <input
              type="number"
              value={filter.numberMaxValue}
              onChange={(event) => onChange({ numberMaxValue: event.target.value })}
            />
          </label>
        </div>
      );
    }
    return (
      <label>
        Value
        <input
          type="number"
          value={filter.numberValue}
          onChange={(event) => onChange({ numberValue: event.target.value })}
        />
      </label>
    );
  }

  return (
    <label>
      Value
      <input value={filter.textValue} onChange={(event) => onChange({ textValue: event.target.value })} />
    </label>
  );
}

function PreviewPanel({ preview }: { preview: DailyFeedPreview }) {
  const items = preview.output.items;
  return (
    <section className="preview-panel" aria-label="Preview">
      <div className="row-top">
        <div>
          <div className="title">Preview</div>
          <div className="meta">
            {items.length} selected, {preview.eligible_item_count} eligible
          </div>
        </div>
        <div className="meta">{formatDateLabel(preview.output.date)}</div>
      </div>
      {items.length ? (
        <div className="stack preview-items">
          {items.map((item) => (
            <div className="row preview-item" key={`${item.position}-${item.item.id}`}>
              <div className="title">
                {firstNonEmpty(item.item.title, primitiveDisplay(item.item.data["name"]), "Untitled")}
              </div>
              <div className="meta">{firstNonEmpty(item.action.url, item.action.text)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No matching items.</div>
      )}
      {preview.ineligible_item_count ? (
        <div className="meta">{preview.ineligible_item_count} items missing template fields.</div>
      ) : null}
    </section>
  );
}

const systemMetricOptions: Array<{
  key: SystemMetricKey;
  label: string;
  aggregations: MetricAggregation[];
  defaultAggregation: MetricAggregation;
}> = [
  { key: "post_count", label: "Post count", aggregations: ["count", "sum"], defaultAggregation: "count" },
  {
    key: "average_post_length_words",
    label: "Average post length",
    aggregations: ["average", "max", "min"],
    defaultAggregation: "average",
  },
  { key: "missed_days", label: "Missed days", aggregations: ["count", "sum"], defaultAggregation: "count" },
  { key: "current_streak", label: "Current streak", aggregations: ["latest", "max"], defaultAggregation: "latest" },
  {
    key: "typical_posting_window",
    label: "Typical posting window",
    aggregations: ["latest"],
    defaultAggregation: "latest",
  },
];

const judgedAggregations: MetricAggregation[] = ["average", "sum", "latest", "count", "max", "min"];

function MetricsSection({
  feed,
  metrics,
  selectedMetricId,
  leaderboard,
  metricsLoading,
  leaderboardLoading,
  error,
  canManage,
  metricSubmitting,
  updatingMetricId,
  deletingMetricId,
  onSelectMetric,
  onCreateMetric,
  onUpdateMetric,
  onDeleteMetric,
}: {
  feed: DailyFeed | null;
  metrics: FeedMetric[];
  selectedMetricId: string | null;
  leaderboard: MetricLeaderboard | null;
  metricsLoading: boolean;
  leaderboardLoading: boolean;
  error: string;
  canManage: boolean;
  metricSubmitting: boolean;
  updatingMetricId: string | null;
  deletingMetricId: string | null;
  onSelectMetric: (metricId: string) => void;
  onCreateMetric: (payload: CreateFeedMetricRequest) => void;
  onUpdateMetric: (metricId: string, payload: PatchFeedMetricRequest) => void;
  onDeleteMetric: (metricId: string) => void;
}) {
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const selectedMetric = metrics.find((metric) => metric.id === selectedMetricId) ?? null;
  const editingMetric = dialogMode === "edit" ? selectedMetric : null;

  if (!feed) {
    return null;
  }

  function handleDeleteMetric(metric: FeedMetric) {
    if (deletingMetricId !== null || !window.confirm(`Delete ${metric.display_name}?`)) {
      return;
    }
    onDeleteMetric(metric.id);
  }

  return (
    <section className="metrics-section" aria-label="Metrics">
      <div className="section-header-row">
        <div>
          <div className="section-title">Metrics</div>
          {selectedMetric ? (
            <div className="meta">
              {metricKeyLabel(selectedMetric.system_key)} · {aggregationLabel(selectedMetric.aggregation)}
            </div>
          ) : null}
        </div>
        {canManage ? (
          <button
            className="secondary"
            type="button"
            disabled={metricSubmitting}
            onClick={() => setDialogMode("create")}
          >
            Add metric
          </button>
        ) : null}
      </div>

      {metricsLoading ? <div className="empty-state">Loading metrics...</div> : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      {!metricsLoading && metrics.length === 0 && !error ? (
        <div className="empty-state">No metrics configured.</div>
      ) : null}

      {metrics.length > 0 ? (
        <div className="metric-layout">
          <div className="metric-list" aria-label="Configured metrics">
            {metrics.map((metric) => (
              <button
                className={`metric-select-button ${metric.id === selectedMetricId ? "selected-row" : ""}`}
                key={metric.id}
                type="button"
                onClick={() => onSelectMetric(metric.id)}
              >
                <span className="title">{metric.display_name}</span>
                <span className="meta">{metricKeyLabel(metric.system_key)}</span>
              </button>
            ))}
          </div>

          <div className="leaderboard-panel">
            {selectedMetric ? (
              <div className="leaderboard-header">
                <div>
                  <div className="title">{selectedMetric.display_name}</div>
                  {selectedMetric.judgment_prompt !== undefined && selectedMetric.judgment_prompt !== "" ? (
                    <div className="meta">{selectedMetric.judgment_prompt}</div>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="compact-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={updatingMetricId === selectedMetric.id}
                      onClick={() => setDialogMode("edit")}
                    >
                      Edit
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={deletingMetricId === selectedMetric.id}
                      onClick={() => handleDeleteMetric(selectedMetric)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {leaderboardLoading ? <div className="empty-state">Loading leaderboard...</div> : null}
            {!leaderboardLoading && leaderboard ? <LeaderboardTable leaderboard={leaderboard} /> : null}
          </div>
        </div>
      ) : null}

      {dialogMode ? (
        <MetricDialog
          mode={dialogMode}
          metric={editingMetric}
          saving={dialogMode === "create" ? metricSubmitting : updatingMetricId === editingMetric?.id}
          onClose={() => setDialogMode(null)}
          onCreate={(payload) => {
            onCreateMetric(payload);
            setDialogMode(null);
          }}
          onUpdate={(metricId, payload) => {
            onUpdateMetric(metricId, payload);
            setDialogMode(null);
          }}
        />
      ) : null}
    </section>
  );
}

function LeaderboardTable({ leaderboard }: { leaderboard: MetricLeaderboard }) {
  if (leaderboard.rows.length === 0) {
    return <div className="empty-state">No active members.</div>;
  }
  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Member</th>
          <th>Value</th>
          <th>Samples</th>
        </tr>
      </thead>
      <tbody>
        {leaderboard.rows.map((row) => (
          <tr key={row.user.id}>
            <td>{leaderboardRankDisplay(row)}</td>
            <td>{publicUserDisplayName(row.user)}</td>
            <td>{row.value}</td>
            <td>{row.sample_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function leaderboardRankDisplay(row: MetricLeaderboardRow): string | number {
  return row.rank ?? "-";
}

function publicUserDisplayName(user: PublicUser): string {
  return user.display_name || user.username;
}

function MetricDialog({
  mode,
  metric,
  saving,
  onClose,
  onCreate,
  onUpdate,
}: {
  mode: "create" | "edit";
  metric: FeedMetric | null;
  saving: boolean;
  onClose: () => void;
  onCreate: (payload: CreateFeedMetricRequest) => void;
  onUpdate: (metricId: string, payload: PatchFeedMetricRequest) => void;
}) {
  const editing = mode === "edit" && metric !== null;
  const initialKind = metric?.system_key === "judged" ? "judged" : "system";
  const initialSystemKey =
    metric?.system_key !== undefined && metric.system_key !== "judged" ? metric.system_key : "post_count";
  const [kind, setKind] = useState<"system" | "judged">(initialKind);
  const [systemKey, setSystemKey] = useState<SystemMetricKey>(initialSystemKey);
  const [displayName, setDisplayName] = useState(metric?.display_name ?? defaultMetricDisplayName(initialSystemKey));
  const [aggregation, setAggregation] = useState<MetricAggregation>(
    metric?.aggregation ?? defaultAggregationForMetricKey(initialSystemKey),
  );
  const [judgmentPrompt, setJudgmentPrompt] = useState(metric?.judgment_prompt ?? "");
  const [validationError, setValidationError] = useState("");

  const metricKey: FeedMetricKey = editing ? metric.system_key : kind === "judged" ? "judged" : systemKey;
  const allowedAggregations = aggregationsForMetricKey(metricKey);

  useEffect(() => {
    if (!allowedAggregations.includes(aggregation)) {
      setAggregation(defaultAggregationForMetricKey(metricKey));
    }
  }, [aggregation, allowedAggregations, metricKey]);

  function handleSystemKeyChange(nextKey: SystemMetricKey) {
    setSystemKey(nextKey);
    setAggregation(defaultAggregationForMetricKey(nextKey));
    if (mode === "create") {
      setDisplayName(defaultMetricDisplayName(nextKey));
    }
  }

  function handleKindChange(nextKind: "system" | "judged") {
    setKind(nextKind);
    const nextKey: FeedMetricKey = nextKind === "judged" ? "judged" : systemKey;
    setAggregation(defaultAggregationForMetricKey(nextKey));
    if (mode === "create") {
      setDisplayName(nextKind === "judged" ? "" : defaultMetricDisplayName(systemKey));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDisplayName = displayName.trim();
    const trimmedPrompt = judgmentPrompt.trim();
    if (trimmedDisplayName === "") {
      setValidationError("Name is required");
      return;
    }
    if (metricKey === "judged" && trimmedPrompt === "") {
      setValidationError("Prompt is required");
      return;
    }
    setValidationError("");

    if (editing) {
      onUpdate(metric.id, {
        display_name: trimmedDisplayName,
        aggregation,
        ...(metricKey === "judged" ? { judgment_prompt: trimmedPrompt } : {}),
      });
      return;
    }

    onCreate({
      system_key: metricKey,
      display_name: trimmedDisplayName,
      aggregation,
      ...(metricKey === "judged" ? { judgment_prompt: trimmedPrompt } : {}),
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel metric-dialog" role="dialog" aria-modal="true" aria-labelledby="metric-dialog-title">
        <form className="metric-form" onSubmit={handleSubmit}>
          <div className="modal-header">
            <div>
              <h2 id="metric-dialog-title">{editing ? "Edit metric" : "Add metric"}</h2>
              <div className="meta">{metricKeyLabel(metricKey)}</div>
            </div>
            <button className="secondary" type="button" onClick={onClose}>
              Close
            </button>
          </div>

          {!editing ? (
            <label>
              Type
              <select value={kind} onChange={(event) => handleKindChange(event.target.value as "system" | "judged")}>
                <option value="system">Calculated</option>
                <option value="judged">Judged</option>
              </select>
            </label>
          ) : null}

          {kind === "system" && !editing ? (
            <label>
              Metric
              <select
                value={systemKey}
                onChange={(event) => handleSystemKeyChange(event.target.value as SystemMetricKey)}
              >
                {systemMetricOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="form-grid two-column">
            <label>
              Name
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setValidationError("");
                }}
              />
            </label>
            <label>
              Aggregation
              <select value={aggregation} onChange={(event) => setAggregation(event.target.value as MetricAggregation)}>
                {allowedAggregations.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {aggregationLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {metricKey === "judged" ? (
            <label>
              Prompt
              <textarea
                value={judgmentPrompt}
                onChange={(event) => {
                  setJudgmentPrompt(event.target.value);
                  setValidationError("");
                }}
              />
            </label>
          ) : null}

          {validationError ? (
            <div className="form-error" role="alert">
              {validationError}
            </div>
          ) : null}

          <div className="output-actions">
            <button className="secondary" type="button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function metricKeyLabel(key: FeedMetricKey): string {
  if (key === "judged") {
    return "Judged";
  }
  return systemMetricOptions.find((option) => option.key === key)?.label ?? key;
}

function aggregationLabel(aggregation: MetricAggregation): string {
  switch (aggregation) {
    case "sum":
      return "Sum";
    case "average":
      return "Average";
    case "latest":
      return "Latest";
    case "count":
      return "Count";
    case "max":
      return "Max";
    case "min":
      return "Min";
  }
}

function aggregationsForMetricKey(key: FeedMetricKey): MetricAggregation[] {
  if (key === "judged") {
    return judgedAggregations;
  }
  return systemMetricOptions.find((option) => option.key === key)?.aggregations ?? ["average"];
}

function defaultAggregationForMetricKey(key: FeedMetricKey): MetricAggregation {
  if (key === "judged") {
    return "average";
  }
  return systemMetricOptions.find((option) => option.key === key)?.defaultAggregation ?? "average";
}

function defaultMetricDisplayName(key: SystemMetricKey): string {
  return systemMetricOptions.find((option) => option.key === key)?.label ?? "";
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
  updatingPostId,
  deletingPostId,
  currentUserId,
  judgedMetrics,
  canJudge,
  judgingPostId,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  feed: DailyFeed | null;
  output: DailyFeedOutput | null;
  loading: boolean;
  error: string;
  posts: GroupFeedPost[];
  postsLoading: boolean;
  postsError: string;
  postSubmitting: boolean;
  updatingPostId: string | null;
  deletingPostId: string | null;
  currentUserId: string | null;
  judgedMetrics: FeedMetric[];
  canJudge: boolean;
  judgingPostId: string | null;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => void;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
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
  const items = output.items;
  const isDailyThread = feed.kind === "daily_thread";

  return (
    <>
      {items.length ? (
        <div className="stack output-items">
          {items.map((item) => (
            <OutputItem item={item} key={`${item.position}-${firstNonEmpty(item.item.id, item.role)}`} />
          ))}
        </div>
      ) : !isDailyThread ? (
        <div className="empty-state">No generated items for {output.date}.</div>
      ) : null}
      <FeedPostSection
        key={`${feed.id}-${output.date}`}
        disabled={!feed.enabled}
        posts={posts}
        loading={postsLoading}
        error={postsError}
        submitting={postSubmitting}
        updatingPostId={updatingPostId}
        deletingPostId={deletingPostId}
        currentUserId={currentUserId}
        judgedMetrics={judgedMetrics}
        canJudge={canJudge}
        judgingPostId={judgingPostId}
        onCreateFeedPost={onCreateFeedPost}
        onUpdateFeedPost={onUpdateFeedPost}
        onDeleteFeedPost={onDeleteFeedPost}
        onCreateMetricJudgment={onCreateMetricJudgment}
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
  updatingPostId,
  deletingPostId,
  currentUserId,
  judgedMetrics,
  canJudge,
  judgingPostId,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
  onCreateMetricJudgment,
}: {
  disabled: boolean;
  posts: GroupFeedPost[];
  loading: boolean;
  error: string;
  submitting: boolean;
  updatingPostId: string | null;
  deletingPostId: string | null;
  currentUserId: string | null;
  judgedMetrics: FeedMetric[];
  canJudge: boolean;
  judgingPostId: string | null;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => void;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
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
  const ownPost = currentUserId !== null ? (posts.find((post) => post.author_user_id === currentUserId) ?? null) : null;
  const postUnavailable = disabled || loading || Boolean(ownPost);

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
    const trimmedEvidence = evidenceText.trim();
    if (!trimmedEvidence || postUnavailable) {
      return;
    }

    onCreateFeedPost({ evidenceText: trimmedEvidence, caption });
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
              mine={currentUserId === post.author_user_id}
              post={post}
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
      {!loading && error === "" && posts.length === 0 ? <div className="empty-state">No posts yet.</div> : null}
    </section>
  );
}

function FeedPostCard({
  post,
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
  mine: boolean;
  saving: boolean;
  deleting: boolean;
  judgedMetrics: FeedMetric[];
  canJudge: boolean;
  judging: boolean;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
  onDeleteFeedPost: (postId: string) => void;
  onCreateMetricJudgment: (
    metricId: string,
    postId: string,
    payload: Omit<CreateFeedMetricJudgmentRequest, "post_id">,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [evidenceText, setEvidenceText] = useState(post.evidence_text);
  const [caption, setCaption] = useState(post.caption ?? "");
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
    setEditing(true);
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEvidence = evidenceText.trim();
    if (!trimmedEvidence || saving || deleting) {
      return;
    }

    const trimmedCaption = caption.trim();
    setSubmittedUpdate({ evidenceText: trimmedEvidence, caption: trimmedCaption, seenSaving: false });
    onUpdateFeedPost(post.id, { evidenceText: trimmedEvidence, caption: trimmedCaption });
  }

  function handleDelete() {
    if (saving || deleting || !window.confirm("Delete this post?")) {
      return;
    }

    onDeleteFeedPost(post.id);
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
          {post.caption !== undefined && post.caption !== "" ? (
            <div className="post-caption">{post.caption}</div>
          ) : null}
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
  const lines = value.split(/\r?\n/);
  const hasPreview = lines.length > 3;
  const previewText = lines.slice(0, 3).join("\n");
  const displayText = hasPreview && !expanded ? previewText : value;

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
          <pre className="post-evidence-code">{displayText}</pre>
        </button>
      ) : (
        <pre className="post-evidence-code">{displayText}</pre>
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

function OutputItem({ item }: { item: DailyFeedOutputItem }) {
  const catalogItem = item.item;
  const data = catalogItem.data;
  const rating = primitiveDisplay(data["rating"]);
  const rawTags = data["tags"];
  const tags = Array.isArray(rawTags)
    ? rawTags
        .filter((tag): tag is string => typeof tag === "string")
        .slice(0, 4)
        .join(", ")
    : "";
  const details = [rating !== "" ? `Rating ${rating}` : "", tags].filter((detail): detail is string => detail !== "");
  const displayTitle = firstNonEmpty(
    catalogItem.title,
    primitiveDisplay(data["name"]),
    primitiveDisplay(data["title"]),
    "Untitled",
  );

  return (
    <div className="output-item">
      <div className="output-item-main">
        <div className="item-position">{item.position}</div>
        <div>
          <OutputItemTitle item={item} title={displayTitle} />
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

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function defaultStartsAtInput(): string {
  const date = new Date();
  date.setHours(8, 0, 0, 0);
  if (date.getTime() < Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return datetimeLocalValue(date);
}

function datetimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function localInputToISOString(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Start time is invalid");
  }
  return date.toISOString();
}

function operatorsForField(field: CatalogSourceField): Array<{ value: string; label: string }> {
  if (field.value_type === "number" && !field.is_array) {
    return [
      { value: "eq", label: "=" },
      { value: "gte", label: ">=" },
      { value: "lte", label: "<=" },
      { value: "gt", label: ">" },
      { value: "lt", label: "<" },
      { value: "between", label: "Between" },
    ];
  }
  if (field.value_type === "string" && field.is_array) {
    return [
      { value: "contains", label: "Contains" },
      { value: "contains_any", label: "Contains any" },
      { value: "contains_all", label: "Contains all" },
    ];
  }
  return [
    { value: "eq", label: "=" },
    { value: "contains", label: "Contains" },
    { value: "like", label: "Like" },
  ];
}

function defaultOperatorForField(field: CatalogSourceField): string {
  return operatorsForField(field)[0]?.value ?? "";
}

function draftFilterToRequest(filter: DraftFilter, fields: CatalogSourceField[]): DailyFeedRuleFilter {
  const field = fields.find((candidate) => candidate.id === filter.fieldId);
  if (!field) {
    throw new Error("Filter field is invalid");
  }
  const op = filter.op || defaultOperatorForField(field);
  const request: DailyFeedRuleFilter = {
    field_id: field.id,
    op,
  };

  if (field.value_type === "number") {
    const first = Number(filter.numberValue);
    if (!Number.isFinite(first)) {
      throw new Error(`${field.label} value is invalid`);
    }
    if (op === "between") {
      const second = Number(filter.numberMaxValue);
      if (!Number.isFinite(second)) {
        throw new Error(`${field.label} range is invalid`);
      }
      request.number_values = [first, second];
    } else {
      request.number_values = [first];
    }
    return request;
  }

  const textValues =
    field.is_array && op !== "contains"
      ? filter.textValue
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [filter.textValue.trim()].filter(Boolean);
  if (!textValues.length) {
    throw new Error(`${field.label} value is required`);
  }
  request.text_values = textValues;
  return request;
}

function primitiveDisplay(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value): value is string => value !== undefined && value !== null && value !== "") ?? "";
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
