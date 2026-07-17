import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import type {
  CatalogSource,
  DailyFeed,
  DailyFeedEvent,
  DailyFeedEventPreview,
  UpsertDailyFeedEventRequest,
} from "../../types";
import { CreateWizardDialog, CreateWizardStep } from "../CreateWizardDialog";
import { CatalogFiltersEditor } from "../dashboard/CatalogFiltersEditor";
import type { DraftFilter } from "../dashboard/feedDraft";
import { draftFilterToRequest } from "../dashboard/feedDraft";
import { firstNonEmpty, outputItemDisplayTitle } from "../dashboard/format";

type EventStep = "details" | "configuration" | "review";
type EventLifecycle = DailyFeedEvent["status"];

export function FeedEventsDialog({
  feed,
  sources,
  events,
  loading,
  busy,
  error,
  editorMode,
  editingEvent,
  preview,
  previewLoading,
  saving,
  onClose,
  onOpenCreate,
  onOpenEdit,
  onCloseEditor,
  onDraftChanged,
  onPreview,
  onSave,
  onDelete,
}: {
  feed: DailyFeed;
  sources: CatalogSource[];
  events: DailyFeedEvent[];
  loading: boolean;
  busy: boolean;
  error: string;
  editorMode: "create" | "edit" | null;
  editingEvent: DailyFeedEvent | null;
  preview: DailyFeedEventPreview | null;
  previewLoading: boolean;
  saving: boolean;
  onClose: () => void;
  onOpenCreate: () => void;
  onOpenEdit: (eventId: string) => void;
  onCloseEditor: () => void;
  onDraftChanged: () => void;
  onPreview: (payload: UpsertDailyFeedEventRequest) => void;
  onSave: (payload: UpsertDailyFeedEventRequest) => void;
  onDelete: (eventId: string) => void;
}) {
  if (editorMode !== null) {
    const editorSourceId = editingEvent?.source_id ?? feed.source_id;
    const editorSource = sources.find((source) => source.id === editorSourceId) ?? null;
    return (
      <FeedEventEditorDialog
        event={editingEvent}
        feed={feed}
        formError={error}
        preview={preview}
        previewLoading={previewLoading}
        saving={saving}
        source={editorSource}
        onClose={onCloseEditor}
        onDraftChanged={onDraftChanged}
        onPreview={onPreview}
        onSave={onSave}
      />
    );
  }

  return (
    <FeedEventManagerDialog
      busy={busy}
      error={error}
      events={events}
      feed={feed}
      loading={loading}
      sourceAvailable={sources.some((source) => source.id === feed.source_id)}
      onClose={onClose}
      onDelete={onDelete}
      onOpenCreate={onOpenCreate}
      onOpenEdit={onOpenEdit}
    />
  );
}

function FeedEventManagerDialog({
  feed,
  events,
  loading,
  busy,
  error,
  sourceAvailable,
  onClose,
  onOpenCreate,
  onOpenEdit,
  onDelete,
}: {
  feed: DailyFeed;
  events: DailyFeedEvent[];
  loading: boolean;
  busy: boolean;
  error: string;
  sourceAvailable: boolean;
  onClose: () => void;
  onOpenCreate: () => void;
  onOpenEdit: (eventId: string) => void;
  onDelete: (eventId: string) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const grouped = groupEvents(events);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel feed-events-dialog" role="dialog" aria-modal="true" aria-label="Feed events">
        <div className="modal-header">
          <div>
            <h2>Events</h2>
            <div className="meta">{feed.name}</div>
          </div>
          <button className="secondary" disabled={busy} ref={closeButtonRef} type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="feed-events-toolbar">
          <div className="meta">Temporarily change item count and filters for a set of feed dates.</div>
          <button
            className="secondary"
            disabled={busy || loading || !sourceAvailable}
            type="button"
            onClick={onOpenCreate}
          >
            Add event
          </button>
        </div>

        {loading ? <div className="empty-state">Loading events...</div> : null}
        {!loading && !sourceAvailable ? (
          <div className="form-error" role="alert">
            This feed’s catalog source is unavailable.
          </div>
        ) : null}
        {error !== "" ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        {!loading && events.length === 0 && error === "" ? (
          <div className="empty-state">No events scheduled.</div>
        ) : null}

        {!loading ? (
          <div className="feed-events-groups">
            <EventGroup
              busy={busy}
              events={grouped.active}
              label="Active events"
              lifecycle="active"
              onDelete={onDelete}
              onOpenEdit={onOpenEdit}
            />
            <EventGroup
              busy={busy}
              events={grouped.upcoming}
              label="Upcoming events"
              lifecycle="upcoming"
              onDelete={onDelete}
              onOpenEdit={onOpenEdit}
            />
            <EventGroup
              busy={busy}
              events={grouped.ended}
              label="Past events"
              lifecycle="ended"
              onDelete={onDelete}
              onOpenEdit={onOpenEdit}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function EventGroup({
  label,
  lifecycle,
  events,
  busy,
  onOpenEdit,
  onDelete,
}: {
  label: string;
  lifecycle: EventLifecycle;
  events: DailyFeedEvent[];
  busy: boolean;
  onOpenEdit: (eventId: string) => void;
  onDelete: (eventId: string) => void;
}) {
  if (events.length === 0) {
    return null;
  }
  return (
    <section className="feed-events-group" aria-label={label}>
      <div className="section-title">{label.replace(" events", "")}</div>
      <div className="stack">
        {events.map((event) => (
          <div className="row feed-event-row" key={event.id}>
            <div>
              <div className="title">{event.name}</div>
              <div className="meta">{eventDateRange(event)}</div>
              {event.description !== undefined && event.description !== "" ? (
                <div className="meta">{event.description}</div>
              ) : null}
            </div>
            <div className="feed-event-row-actions">
              {lifecycle !== "ended" ? (
                <button className="secondary" disabled={busy} type="button" onClick={() => onOpenEdit(event.id)}>
                  {lifecycle === "active" ? "Edit end date" : "Edit"}
                </button>
              ) : null}
              {lifecycle === "upcoming" ? (
                <button
                  className="danger"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${event.name}?`)) {
                      onDelete(event.id);
                    }
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedEventEditorDialog({
  feed,
  source,
  event,
  preview,
  previewLoading,
  saving,
  formError,
  onClose,
  onDraftChanged,
  onPreview,
  onSave,
}: {
  feed: DailyFeed;
  source: CatalogSource | null;
  event: DailyFeedEvent | null;
  preview: DailyFeedEventPreview | null;
  previewLoading: boolean;
  saving: boolean;
  formError: string;
  onClose: () => void;
  onDraftChanged: () => void;
  onPreview: (payload: UpsertDailyFeedEventRequest) => void;
  onSave: (payload: UpsertDailyFeedEventRequest) => void;
}) {
  const stepLabelId = useId();
  const defaultDates = defaultEventDates(feed.schedule.timezone);
  const [name, setName] = useState(event?.name ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startsOn, setStartsOn] = useState(event?.starts_on ?? defaultDates.startsOn);
  const [endsOn, setEndsOn] = useState(event?.ends_on ?? defaultDates.endsOn);
  const [itemCount, setItemCount] = useState(String(event?.item_count ?? feed.item_count ?? 3));
  const [filters, setFilters] = useState<DraftFilter[]>(() => eventFiltersToDraft(event, feed));
  const [currentStep, setCurrentStep] = useState<EventStep>("details");
  const [revealedSteps, setRevealedSteps] = useState<EventStep[]>(["details"]);
  const [validationError, setValidationError] = useState("");
  const steps: EventStep[] = ["details", "configuration", "review"];
  const currentStepIndex = steps.indexOf(currentStep);
  const visibleSteps = steps.filter((step) => revealedSteps.includes(step));
  const activeEdit = event?.status === "active";
  const configurationLocked = activeEdit;
  const sourceFields = source?.fields ?? [];

  function markDraftChanged() {
    setValidationError("");
    onDraftChanged();
  }

  function activateStep(step: EventStep) {
    if (!saving && step !== currentStep) {
      setCurrentStep(step);
      setValidationError("");
    }
  }

  function revealStep(step: EventStep) {
    setRevealedSteps((current) => (current.includes(step) ? current : [...current, step]));
    setCurrentStep(step);
    setValidationError("");
  }

  function buildPayload(usePreviewToken: boolean): UpsertDailyFeedEventRequest {
    const trimmedName = name.trim();
    if (trimmedName === "") {
      throw new Error("Name is required");
    }
    if (startsOn === "" || endsOn === "") {
      throw new Error("Start and end dates are required");
    }
    if (endsOn < startsOn) {
      throw new Error("End date must be on or after start date");
    }
    const parsedItemCount = Number(itemCount);
    if (!Number.isInteger(parsedItemCount) || parsedItemCount < 1 || parsedItemCount > 50) {
      throw new Error("Item count must be between 1 and 50");
    }
    if (source === null) {
      throw new Error("Catalog source is unavailable");
    }
    const payload: UpsertDailyFeedEventRequest = {
      name: trimmedName,
      starts_on: startsOn,
      ends_on: endsOn,
      source_id: source.id,
      item_count: parsedItemCount,
      filters: filters.map((filter) => draftFilterToRequest(filter, sourceFields)),
    };
    const trimmedDescription = description.trim();
    if (trimmedDescription !== "") {
      payload.description = trimmedDescription;
    }
    const selectionToken = usePreviewToken
      ? (preview?.selection_token ?? event?.selection_token)
      : event?.selection_token;
    if (selectionToken !== undefined && selectionToken !== "") {
      payload.selection_token = selectionToken;
    }
    return payload;
  }

  function validateStep(step: EventStep): string {
    try {
      if (step === "details") {
        if (name.trim() === "") {
          return "Name is required";
        }
        if (startsOn === "" || endsOn === "") {
          return "Start and end dates are required";
        }
        if (endsOn < startsOn) {
          return "End date must be on or after start date";
        }
      }
      if (step === "configuration") {
        buildPayload(false);
      }
    } catch (error) {
      return error instanceof Error ? error.message : "Event configuration is invalid";
    }
    return "";
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const stepError = validateStep(currentStep);
    if (stepError !== "") {
      setValidationError(stepError);
      return;
    }
    const nextStep = steps[currentStepIndex + 1];
    if (nextStep !== undefined) {
      revealStep(nextStep);
      return;
    }
    try {
      onSave(buildPayload(true));
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Event configuration is invalid");
    }
  }

  function stepError(step: EventStep) {
    return currentStep === step && validationError !== "" ? (
      <div className="form-error create-wizard-step-error" role="alert">
        {validationError}
      </div>
    ) : null;
  }

  return (
    <CreateWizardDialog
      actionLabel={event === null ? "Add event" : "Save event"}
      busy={saving}
      busyLabel="Saving..."
      context={feed.name}
      currentStep={currentStep}
      currentStepIndex={currentStepIndex}
      error={formError}
      stepCount={steps.length}
      submitDisabled={previewLoading || source === null}
      title={event === null ? "Add feed event" : `Edit ${event.name}`}
      {...(currentStepIndex > 0 ? { onBack: () => revealStep(steps[currentStepIndex - 1]!) } : {})}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {visibleSteps.includes("details") ? (
        <CreateWizardStep
          current={currentStep === "details"}
          labelId={`${stepLabelId}-details`}
          number={1}
          step="details"
          title="Event details"
          onActivate={activateStep}
        >
          <div className="form-grid two-column">
            <label>
              Name
              <input
                disabled={saving || activeEdit}
                value={name}
                onChange={(inputEvent) => {
                  setName(inputEvent.target.value);
                  markDraftChanged();
                }}
              />
            </label>
            <label>
              Start date
              <input
                disabled={saving || activeEdit}
                type="date"
                value={startsOn}
                onChange={(inputEvent) => {
                  setStartsOn(inputEvent.target.value);
                  markDraftChanged();
                }}
              />
            </label>
            <label>
              End date
              <input
                disabled={saving}
                min={startsOn}
                type="date"
                value={endsOn}
                onChange={(inputEvent) => {
                  setEndsOn(inputEvent.target.value);
                  markDraftChanged();
                }}
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              disabled={saving || activeEdit}
              value={description}
              onChange={(inputEvent) => {
                setDescription(inputEvent.target.value);
                markDraftChanged();
              }}
            />
          </label>
          {activeEdit ? (
            <div className="field-hint">
              Only the end date can change, and it must keep the current feed date covered.
            </div>
          ) : null}
          {stepError("details")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("configuration") ? (
        <CreateWizardStep
          current={currentStep === "configuration"}
          labelId={`${stepLabelId}-configuration`}
          number={2}
          step="configuration"
          title="Event configuration"
          onActivate={activateStep}
        >
          <div className="form-grid two-column">
            <label>
              Source
              <input disabled value={source?.name ?? feed.source_name ?? "Unavailable"} />
            </label>
            <label>
              Item count
              <input
                disabled={saving || configurationLocked}
                max="50"
                min="1"
                step="1"
                type="number"
                value={itemCount}
                onChange={(inputEvent) => {
                  setItemCount(inputEvent.target.value);
                  markDraftChanged();
                }}
              />
            </label>
          </div>
          <CatalogFiltersEditor
            disabled={saving || configurationLocked}
            fields={sourceFields}
            filters={filters}
            onChange={(nextFilters) => {
              setFilters(nextFilters);
              markDraftChanged();
            }}
          />
          {stepError("configuration")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("review") ? (
        <CreateWizardStep
          current={currentStep === "review"}
          labelId={`${stepLabelId}-review`}
          number={3}
          step="review"
          title="Review and preview"
          onActivate={activateStep}
        >
          <div className="preview-panel">
            <div className="row-top">
              <div>
                <div className="title">{name.trim() || "Untitled event"}</div>
                <div className="meta">
                  {startsOn} through {endsOn} · {itemCount || "0"} items
                </div>
              </div>
              <button
                className="secondary"
                disabled={previewLoading || saving || source === null || activeEdit}
                type="button"
                onClick={() => {
                  try {
                    onPreview(buildPayload(false));
                  } catch (error) {
                    setValidationError(error instanceof Error ? error.message : "Event configuration is invalid");
                  }
                }}
              >
                {previewLoading ? "Previewing..." : "Preview"}
              </button>
            </div>
            {activeEdit ? (
              <div className="field-hint">The active configuration is fixed.</div>
            ) : preview === null ? (
              <div className="field-hint">Preview is optional before saving.</div>
            ) : null}
          </div>
          {preview !== null ? <EventPreview preview={preview} /> : null}
          {stepError("review")}
        </CreateWizardStep>
      ) : null}
    </CreateWizardDialog>
  );
}

function EventPreview({ preview }: { preview: DailyFeedEventPreview }) {
  return (
    <section className="preview-panel" aria-label="Event preview">
      <div className="row-top">
        <div>
          <div className="title">Event preview</div>
          <div className="meta">
            {preview.output.items.length} selected, {preview.eligible_item_count} eligible
          </div>
        </div>
        <div className="meta">{preview.output.date}</div>
      </div>
      <div className="stack preview-items">
        {preview.output.items.map((item) => (
          <div className="row preview-item" key={`${item.position}-${item.item.id}`}>
            <div className="title">{firstNonEmpty(outputItemDisplayTitle(item), "Untitled")}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function eventFiltersToDraft(event: DailyFeedEvent | null, feed: DailyFeed): DraftFilter[] {
  return (event?.filters ?? feed.filters).map((filter, index) => ({
    id: filter.id ?? `${event?.id ?? "event"}-${index}`,
    fieldId: filter.field_id,
    op: filter.op,
    textValue: (filter.text_values ?? []).join(", "),
    numberValue: filter.number_values?.[0] === undefined ? "" : String(filter.number_values[0]),
    numberMaxValue: filter.number_values?.[1] === undefined ? "" : String(filter.number_values[1]),
  }));
}

function groupEvents(events: DailyFeedEvent[]): Record<EventLifecycle, DailyFeedEvent[]> {
  const grouped: Record<EventLifecycle, DailyFeedEvent[]> = { upcoming: [], active: [], ended: [] };
  for (const event of [...events].sort((left, right) => left.starts_on.localeCompare(right.starts_on))) {
    grouped[event.status].push(event);
  }
  grouped.ended.reverse();
  return grouped;
}

function eventDateRange(event: DailyFeedEvent): string {
  return `${event.starts_on} through ${event.ends_on}`;
}

function defaultEventDates(timeZone: string): { startsOn: string; endsOn: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const today = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { startsOn: utcDateValue(start), endsOn: utcDateValue(end) };
}

function utcDateValue(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
