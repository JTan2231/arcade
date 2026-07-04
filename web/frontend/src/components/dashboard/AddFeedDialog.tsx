import { FormEvent, useEffect, useState } from "react";

import { formatDateLabel } from "../../dates";
import { errorMessage } from "../../errors";
import type {
  CatalogSource,
  CatalogSourceField,
  CreateDailyFeedRequest,
  DailyFeed,
  DailyFeedPreview,
  EvidenceFormat,
} from "../../types";
import { firstNonEmpty, primitiveDisplay } from "./format";
import type { DraftFilter, FeedKind } from "./feedDraft";
import {
  defaultOperatorForField,
  defaultStartsAtInput,
  defaultTimezone,
  draftFilterToRequest,
  localInputToISOString,
  operatorsForField,
} from "./feedDraft";

export function AddFeedDialog({
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
