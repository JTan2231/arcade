import { FormEvent, useEffect, useId, useRef, useState } from "react";

import { feedDateOptions, formatDateLabel } from "../dates";
import { errorMessage } from "../errors";
import { highlightCodeBlock, prepareCodeBlock } from "../syntaxHighlight";
import type {
  CatalogSource,
  CatalogSourceField,
  CreateDailyFeedRequest,
  CreateFeedMetricJudgmentRequest,
  DailyFeed,
  DailyFeedOutput,
  DailyFeedOutputItem,
  DailyFeedPreview,
  DailyFeedRuleFilter,
  EvidenceFormat,
  EvidenceFormatVersion,
  FeedMetric,
  Group,
  GroupFeedPost,
  GroupPostTag,
  MetricLeaderboard,
  MetricLeaderboardRow,
  PublicUser,
} from "../types";
import { metricKeyLabel } from "./metricLabels";

type CreateFeedPostPayload = {
  evidenceText: string;
  caption: string;
};

type UpdateFeedPostPayload = {
  evidenceText?: string;
  caption?: string;
  tagIds?: string[];
};

type GroupDashboardProps = {
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
      <section className="panel group-dashboard-panel">
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
  evidenceFormats,
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
  evidenceFormats: EvidenceFormat[];
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
  const [evidenceFormatId, setEvidenceFormatId] = useState("");
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

  useEffect(() => {
    const plainTextFormat = evidenceFormats.find((format) => format.slug === "plain-text");
    const firstFormatId = plainTextFormat?.id ?? evidenceFormats[0]?.id ?? "";
    if (evidenceFormatId === "") {
      setEvidenceFormatId(firstFormatId);
      return;
    }
    if (!evidenceFormats.some((format) => format.id === evidenceFormatId)) {
      setEvidenceFormatId(firstFormatId);
    }
  }, [evidenceFormatId, evidenceFormats]);

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
    if (evidenceFormatId !== "") {
      payload.evidence_format_id = evidenceFormatId;
    }
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
            Post format
            <select
              disabled={!evidenceFormats.length}
              value={evidenceFormatId}
              onChange={(event) => {
                setEvidenceFormatId(event.target.value);
                markDraftChanged();
              }}
            >
              {evidenceFormats.map((format) => (
                <option value={format.id} key={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
          </label>

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

function MetricsSection({
  feed,
  metrics,
  selectedMetricId,
  leaderboard,
  metricsLoading,
  leaderboardLoading,
  error,
  onAddMetric,
  onSelectMetric,
}: {
  feed: DailyFeed | null;
  metrics: FeedMetric[];
  selectedMetricId: string | null;
  leaderboard: MetricLeaderboard | null;
  metricsLoading: boolean;
  leaderboardLoading: boolean;
  error: string;
  onAddMetric?: () => void;
  onSelectMetric: (metricId: string) => void;
}) {
  const selectedMetric = metrics.find((metric) => metric.id === selectedMetricId) ?? null;
  const [metricMenuOpen, setMetricMenuOpen] = useState(false);
  const metricMenuRef = useRef<HTMLDivElement>(null);
  const canChooseMetric = metrics.length > 0 && !metricsLoading;
  const metricTitle = selectedMetric?.display_name ?? "Metrics";
  const selectedMetricPrompt = selectedMetric?.judgment_prompt ?? "";

  function selectNextMetric() {
    if (!canChooseMetric) {
      return;
    }

    const selectedIndex = metrics.findIndex((metric) => metric.id === selectedMetricId);
    const nextIndex = selectedIndex >= 0 ? (selectedIndex + 1) % metrics.length : 0;
    const nextMetric = metrics[nextIndex];
    if (nextMetric === undefined) {
      return;
    }

    if (nextMetric.id !== selectedMetricId) {
      onSelectMetric(nextMetric.id);
    }
  }

  useEffect(() => {
    if (!metricMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (metricMenuRef.current?.contains(event.target as Node) === true) {
        return;
      }
      setMetricMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMetricMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [metricMenuOpen]);

  useEffect(() => {
    setMetricMenuOpen(false);
  }, [feed?.id, selectedMetricId]);

  if (!feed) {
    return null;
  }

  return (
    <section className="metrics-section" aria-label="Metrics">
      <div className="panel-header groups-panel-header metric-rail-header">
        <div className="metric-title-menu" ref={metricMenuRef}>
          <h2>
            {canChooseMetric ? (
              <span className="metric-title-control">
                <button className="metric-title-button" type="button" onClick={selectNextMetric}>
                  <span className="metric-title-text">{metricTitle}</span>
                </button>
                <button
                  aria-expanded={metricMenuOpen}
                  aria-haspopup="true"
                  aria-label="Metric choices"
                  className="metric-title-caret-button"
                  type="button"
                  onClick={() => setMetricMenuOpen((current) => !current)}
                >
                  <span className="metric-title-caret" aria-hidden="true">
                    <span />
                    <span />
                  </span>
                </button>
              </span>
            ) : (
              <span className="metric-title-static">{metricTitle}</span>
            )}
          </h2>
          {metricMenuOpen ? (
            <div className="metric-title-menu-panel" aria-label="Metric choices">
              {metrics.map((metric) => (
                <button
                  aria-label={`Select ${metric.display_name}`}
                  aria-pressed={metric.id === selectedMetricId}
                  className="metric-title-menu-option"
                  key={metric.id}
                  type="button"
                  onClick={() => {
                    setMetricMenuOpen(false);
                    if (metric.id !== selectedMetricId) {
                      onSelectMetric(metric.id);
                    }
                  }}
                >
                  <span className="title">{metric.display_name}</span>
                  <span className="meta">{metricKeyLabel(metric.system_key)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {onAddMetric !== undefined ? (
          <button aria-label="Add metric" className="icon-button metric-add-button" type="button" onClick={onAddMetric}>
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
      </div>
      {selectedMetricPrompt !== "" ? <div className="meta metric-rail-summary">{selectedMetricPrompt}</div> : null}

      {metricsLoading ? <div className="meta">Loading metrics...</div> : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      {!metricsLoading && metrics.length === 0 && !error ? <div className="meta">No metrics configured.</div> : null}

      {metrics.length > 0 ? (
        <div className="metric-layout">
          <div className="leaderboard-panel">
            {leaderboardLoading ? <div className="meta">Loading leaderboard...</div> : null}
            {!leaderboardLoading && leaderboard ? <LeaderboardTable leaderboard={leaderboard} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LeaderboardTable({ leaderboard }: { leaderboard: MetricLeaderboard }) {
  if (leaderboard.rows.length === 0) {
    return <div className="meta">No active members.</div>;
  }
  const valueColumnLabel = leaderboardValueColumnLabel(leaderboard.metric);
  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Member</th>
          <th>{valueColumnLabel}</th>
        </tr>
      </thead>
      <tbody>
        {leaderboard.rows.map((row) => (
          <tr key={row.user.id}>
            <td>{leaderboardRankDisplay(row)}</td>
            <td>{publicUserDisplayName(row.user)}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function leaderboardValueColumnLabel(metric: FeedMetric): string {
  switch (metric.system_key) {
    case "post_count":
      return "Posts";
    case "average_post_length_words":
      if (metric.aggregation === "max") {
        return "Max words";
      }
      if (metric.aggregation === "min") {
        return "Min words";
      }
      return "Average words";
    case "missed_days":
      return "Missed days";
    case "current_streak":
      return "Streak days";
    case "typical_posting_window":
      return "Posting window";
    case "judged":
      return "Value";
  }
}

function leaderboardRankDisplay(row: MetricLeaderboardRow): string | number {
  return row.rank ?? "-";
}

function publicUserDisplayName(user: PublicUser): string {
  return user.display_name || user.username;
}

function FeedOutput({
  feed,
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
  feed: DailyFeed | null;
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
        evidenceFormat={feed.evidence_format}
        posts={posts}
        postTags={postTags}
        loading={postsLoading}
        error={postsError}
        submitting={postSubmitting}
        updatingPostId={updatingPostId}
        deletingPostId={deletingPostId}
        currentUserId={currentUserId}
        publicLinksAvailable={publicLinksAvailable}
        judgedMetrics={judgedMetrics}
        canPost={canPost}
        canJudge={canJudge}
        canManagePostTags={canManagePostTags}
        judgingPostId={judgingPostId}
        onCreateFeedPost={onCreateFeedPost}
        onUpdateFeedPost={onUpdateFeedPost}
        onCopyPublicPostLink={onCopyPublicPostLink}
        onDeleteFeedPost={onDeleteFeedPost}
        onCreateMetricJudgment={onCreateMetricJudgment}
      />
    </>
  );
}

function FeedPostSection({
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

function normalizeEvidenceText(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function validateEvidenceText(text: string, version: EvidenceFormatVersion): string {
  const charCount = Array.from(text).length;
  if (charCount < version.min_chars) {
    return version.min_chars === 1
      ? "Evidence is required"
      : `Evidence must be at least ${version.min_chars} characters`;
  }
  if (version.max_chars !== undefined && charCount > version.max_chars) {
    return `Evidence must be at most ${version.max_chars} characters`;
  }

  const lines = text.split("\n");
  if (version.exact_lines !== undefined && lines.length !== version.exact_lines) {
    return `Evidence must be exactly ${version.exact_lines} lines`;
  }
  if (version.min_lines !== undefined && lines.length < version.min_lines) {
    return `Evidence must be at least ${version.min_lines} lines`;
  }
  if (version.max_lines !== undefined && lines.length > version.max_lines) {
    return `Evidence must be at most ${version.max_lines} lines`;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (!version.allow_blank_lines) {
        return "Evidence cannot contain blank lines";
      }
      continue;
    }
    const lineChars = Array.from(trimmed).length;
    if (version.line_min_chars !== undefined && lineChars < version.line_min_chars) {
      return `Each non-blank line must be at least ${version.line_min_chars} characters`;
    }
    if (version.line_max_chars !== undefined && lineChars > version.line_max_chars) {
      return `Each non-blank line must be at most ${version.line_max_chars} characters`;
    }
  }

  return "";
}

function evidenceFormatConstraintSummary(version: EvidenceFormatVersion): string {
  const parts: string[] = [`v${version.version_number}`];
  if (version.max_chars !== undefined) {
    parts.push(`${version.min_chars}-${version.max_chars} chars`);
  } else if (version.min_chars > 1) {
    parts.push(`${version.min_chars}+ chars`);
  }
  if (version.exact_lines !== undefined) {
    parts.push(`${version.exact_lines} lines`);
  } else if (version.min_lines !== undefined || version.max_lines !== undefined) {
    parts.push(`${version.min_lines ?? 1}-${version.max_lines ?? "any"} lines`);
  }
  if (version.line_max_chars !== undefined) {
    parts.push(`line max ${version.line_max_chars}`);
  }
  if (!version.allow_blank_lines) {
    parts.push("no blank lines");
  }
  return parts.join(" · ");
}

function shouldShowPostFormat(post: GroupFeedPost): boolean {
  return (
    post.evidence_format.slug !== "plain-text" ||
    post.evidence_format.archived_at !== undefined ||
    post.evidence_format_version.version_number !== 1
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

function selectedActivePostTagIDs(post: GroupFeedPost, activeTags: GroupPostTag[]): string[] {
  const activeTagIds = new Set(activeTags.map((tag) => tag.id));
  return post.tags.filter((tag) => activeTagIds.has(tag.id)).map((tag) => tag.id);
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
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
