import { FormEvent, useEffect, useState } from "react";

import { feedDateOptions, formatDateLabel } from "../dates";
import { errorMessage } from "../errors";
import type {
  CatalogSource,
  CatalogSourceField,
  CreateDailyFeedRequest,
  DailyFeed,
  DailyFeedAction,
  DailyFeedOutput,
  DailyFeedOutputItem,
  DailyFeedPreview,
  DailyFeedRuleFilter,
  Group,
  GroupFeedPost,
  GroupInviteCandidate,
} from "../types";
import { RowActionMenu, type RowAction } from "./RowActionMenu";

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
  updatingPostId: string | null;
  deletingPostId: string | null;
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
  pendingToggleFeedId: string | null;
  pendingDeleteFeedId: string | null;
  onSelectFeed: (id: string) => void;
  onChangeFeedDate: (date: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onDeleteFeed: (id: string) => void;
  onOpenAddFeed: () => void;
  onCloseAddFeed: () => void;
  onAddFeedDraftChanged: () => void;
  onPreviewFeed: (payload: CreateDailyFeedRequest) => void;
  onCreateFeed: (payload: CreateDailyFeedRequest) => void;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => void;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
  onDeleteFeedPost: (postId: string) => void;
  onInviteFriend: (userId: string) => void;
  onCancelGroupInvite: (userId: string) => void;
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
  updatingPostId,
  deletingPostId,
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
  pendingToggleFeedId,
  pendingDeleteFeedId,
  onSelectFeed,
  onChangeFeedDate,
  onToggleFeedEnabled,
  onDeleteFeed,
  onOpenAddFeed,
  onCloseAddFeed,
  onAddFeedDraftChanged,
  onPreviewFeed,
  onCreateFeed,
  onCreateFeedPost,
  onUpdateFeedPost,
  onDeleteFeedPost,
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
            pendingToggleFeedId={pendingToggleFeedId}
            pendingDeleteFeedId={pendingDeleteFeedId}
            onSelectFeed={onSelectFeed}
            onToggleFeedEnabled={onToggleFeedEnabled}
            onDeleteFeed={onDeleteFeed}
            onAddFeed={onOpenAddFeed}
          />
          {group.my_status === "active" ? (
            <InviteFriends
              candidates={inviteCandidates}
              loading={inviteCandidatesLoading}
              invitingUserId={invitingUserId}
              onInviteFriend={onInviteFriend}
              onCancelGroupInvite={onCancelGroupInvite}
            />
          ) : null}
        </section>

        <section className="dashboard-section feed-output-section" aria-label="Selected feed output">
          {feed ? (
            <div className="output-actions feed-output-toolbar">
              <label className="date-control">
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
            onCreateFeedPost={onCreateFeedPost}
            onUpdateFeedPost={onUpdateFeedPost}
            onDeleteFeedPost={onDeleteFeedPost}
          />
        </section>
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
    <div className="invite-friends-section" aria-label="Invite friends">
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
    </div>
  );
}

function FeedList({
  feeds,
  loading,
  error,
  manage,
  selectedFeedId,
  pendingToggleFeedId,
  pendingDeleteFeedId,
  onSelectFeed,
  onToggleFeedEnabled,
  onDeleteFeed,
  onAddFeed,
}: {
  feeds: DailyFeed[];
  loading: boolean;
  error: string;
  manage: boolean;
  selectedFeedId: string | null;
  pendingToggleFeedId: string | null;
  pendingDeleteFeedId: string | null;
  onSelectFeed: (id: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onDeleteFeed: (id: string) => void;
  onAddFeed: () => void;
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
  return (
    <div className="stack">
      {!feeds.length ? (
        <div className="empty-state">{manage ? "No feeds yet." : "No feeds are available for this group."}</div>
      ) : null}
      {feeds.map((feed) => {
        const selected = feed.id === selectedFeedId;
        const mutating = pendingToggleFeedId === feed.id || pendingDeleteFeedId === feed.id;
        const actions: RowAction[] = manage
          ? [
              {
                label: feed.enabled ? "Disable" : "Enable",
                disabled: mutating,
                onSelect: () => onToggleFeedEnabled(feed.id),
              },
              {
                label: "Delete",
                danger: true,
                disabled: mutating,
                onSelect: () => onDeleteFeed(feed.id),
              },
            ]
          : [
              {
                label: "Delete",
                danger: true,
                disabled: true,
                onSelect: () => onDeleteFeed(feed.id),
              },
            ];

        return (
          <div className={`row action-row feed-row ${selected ? "selected-row" : ""}`} key={feed.id}>
            <button
              aria-pressed={selected}
              className="row-select-button"
              type="button"
              aria-label={feed.name}
              onClick={() => onSelectFeed(feed.id)}
            >
              <div className="title">{feed.name}</div>
              {!feed.enabled ? <div className="meta">Disabled</div> : null}
            </button>
            <RowActionMenu label={`Feed settings for ${feed.name}`} actions={actions} />
          </div>
        );
      })}
      {manage ? (
        <button className="secondary add-feed-button" type="button" onClick={onAddFeed}>
          Add feed
        </button>
      ) : null}
    </div>
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
  updatingPostId: string | null;
  deletingPostId: string | null;
  currentUserId: string | null;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => void;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
  onDeleteFeedPost: (postId: string) => void;
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
      <div className="output-summary">
        <div className="title">{output.title}</div>
        <div className="meta">{formatDateLabel(output.date)}</div>
      </div>
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
  updatingPostId,
  deletingPostId,
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
  updatingPostId: string | null;
  deletingPostId: string | null;
  currentUserId: string | null;
  onCreateFeedPost: (payload: { evidenceText: string; caption: string }) => void;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
  onDeleteFeedPost: (postId: string) => void;
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
              onUpdateFeedPost={onUpdateFeedPost}
              onDeleteFeedPost={onDeleteFeedPost}
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
  onUpdateFeedPost,
  onDeleteFeedPost,
}: {
  post: GroupFeedPost;
  mine: boolean;
  saving: boolean;
  deleting: boolean;
  onUpdateFeedPost: (postId: string, payload: { evidenceText: string; caption: string }) => void;
  onDeleteFeedPost: (postId: string) => void;
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
    </article>
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
  const details = [catalogItem.source_name, rating !== "" ? `Rating ${rating}` : "", tags].filter(
    (detail): detail is string => detail !== "",
  );
  const displayTitle = firstNonEmpty(
    catalogItem.title,
    primitiveDisplay(data["name"]),
    primitiveDisplay(data["title"]),
    "Untitled",
  );

  return (
    <div className="row output-item">
      <div className="output-item-main">
        <div className="item-position">{item.position}</div>
        <div>
          <div className="title">{displayTitle}</div>
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
  if (action?.type === "external_url" && action.url !== undefined && action.url !== "") {
    return (
      <a className="button-link" href={action.url} target="_blank" rel="noreferrer">
        {firstNonEmpty(action.label, "Open")}
      </a>
    );
  }

  if (action?.type === "text" && action.text !== undefined && action.text !== "") {
    return (
      <details className="prompt-details">
        <summary>{firstNonEmpty(action.label, "Prompt")}</summary>
        <pre>{action.text}</pre>
      </details>
    );
  }

  return null;
}

function canManageGroup(group: Group | null): boolean {
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
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
