import { FormEvent, useEffect, useId, useState } from "react";

import { CreateWizardDialog, CreateWizardStep } from "../CreateWizardDialog";
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
import { CatalogFiltersEditor } from "./CatalogFiltersEditor";
import { firstNonEmpty, primitiveDisplay } from "./format";
import type { DraftFilter, FeedKind } from "./feedDraft";
import { defaultStartsAtInput, defaultTimezone, draftFilterToRequest, localInputToISOString } from "./feedDraft";

type FeedStep = "type" | "details" | "format" | "catalog" | "schedule" | "review";

export function AddFeedDialog({
  groupName,
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
  groupName: string;
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
  const initialKind: FeedKind | null = canCreateDailyThread ? null : "catalog_daily";
  const initialStep: FeedStep = canCreateDailyThread ? "type" : "details";
  const stepLabelId = useId();
  const [kind, setKind] = useState<FeedKind | null>(initialKind);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [sourceId, setSourceId] = useState("");
  const [evidenceFormatId, setEvidenceFormatId] = useState("");
  const [itemCount, setItemCount] = useState("3");
  const [startsAt, setStartsAt] = useState(defaultStartsAtInput);
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [intervalSeconds, setIntervalSeconds] = useState("86400");
  const [filters, setFilters] = useState<DraftFilter[]>([]);
  const [currentStep, setCurrentStep] = useState<FeedStep>(initialStep);
  const [revealedSteps, setRevealedSteps] = useState<FeedStep[]>([initialStep]);
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

  const steps = feedSteps(kind, canCreateDailyThread);
  const currentStepIndex = steps.indexOf(currentStep);
  const visibleSteps = steps.filter((step) => revealedSteps.includes(step));
  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const sourceFields = selectedSource?.fields ?? [];
  const practice = kind === "catalog_daily";
  const finalStep = currentStepIndex === steps.length - 1;
  const submitDisabled =
    (currentStep === "catalog" && (sourcesLoading || sourceId === "")) ||
    (finalStep && (sourcesLoading || previewLoading));

  function markDraftChanged() {
    setValidationError("");
    onDraftChanged();
  }

  function chooseKind(nextKind: FeedKind) {
    const changed = nextKind !== kind;
    setKind(nextKind);
    setCurrentStep("type");
    setValidationError("");
    if (changed) {
      setRevealedSteps(["type"]);
      if (nextKind === "daily_thread") {
        setFilters([]);
      }
      onDraftChanged();
    }
  }

  function handleSourceChange(nextSourceId: string) {
    const changed = nextSourceId !== sourceId;
    setSourceId(nextSourceId);
    setFilters([]);
    markDraftChanged();
    if (changed) {
      const catalogStepIndex = steps.indexOf("catalog");
      setRevealedSteps(steps.slice(0, catalogStepIndex + 1));
      setCurrentStep("catalog");
    }
  }

  function activateStep(step: FeedStep) {
    if (saving || step === currentStep) {
      return;
    }
    setValidationError("");
    setCurrentStep(step);
  }

  function revealStep(step: FeedStep) {
    setRevealedSteps((current) => (current.includes(step) ? current : [...current, step]));
    setCurrentStep(step);
    setValidationError("");
  }

  function handleBack() {
    const previousStep = steps[currentStepIndex - 1];
    if (!saving && previousStep !== undefined) {
      revealStep(previousStep);
    }
  }

  function buildPayload(): CreateDailyFeedRequest {
    if (kind === null) {
      throw new Error("Choose a feed type");
    }
    const trimmedName = name.trim() || (kind === "daily_thread" ? "Daily Thread" : "");
    if (trimmedName === "") {
      throw new Error("Name is required");
    }
    const schedule = {
      starts_at: localInputToISOString(startsAt),
      timezone: timezone.trim() || "UTC",
      interval_seconds: Number(intervalSeconds),
    };
    if (!Number.isInteger(schedule.interval_seconds) || schedule.interval_seconds < 1) {
      throw new Error("Repeat interval is invalid");
    }

    const payload: CreateDailyFeedRequest = {
      name: trimmedName,
      kind,
      enabled,
      captions_enabled: captionsEnabled,
      schedule,
    };
    if (evidenceFormatId !== "") {
      payload.evidence_format_id = evidenceFormatId;
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription !== "") {
      payload.description = trimmedDescription;
    }

    if (kind === "daily_thread") {
      return payload;
    }
    if (sourceId === "") {
      throw new Error("Source is required");
    }
    const parsedItemCount = Number(itemCount);
    if (!Number.isInteger(parsedItemCount) || parsedItemCount < 1 || parsedItemCount > 50) {
      throw new Error("Item count must be between 1 and 50");
    }
    payload.source_id = sourceId;
    payload.item_count = parsedItemCount;
    payload.filters = filters.map((filter) => draftFilterToRequest(filter, sourceFields));
    return payload;
  }

  function validateCurrentStep(): string {
    return validateFeedStep(currentStep, {
      filters,
      intervalSeconds,
      itemCount,
      kind,
      name,
      sourceFields,
      sourceId,
      startsAt,
    });
  }

  function handlePreview() {
    setValidationError("");
    let payload: CreateDailyFeedRequest;
    try {
      payload = buildPayload();
    } catch (error) {
      const message = errorMessage(error);
      const invalidStep = firstInvalidFeedStep(steps, {
        filters,
        intervalSeconds,
        itemCount,
        kind,
        name,
        sourceFields,
        sourceId,
        startsAt,
      });
      setCurrentStep(invalidStep);
      setValidationError(message);
      return;
    }
    if (payload.kind === "catalog_daily") {
      onPreviewFeed(payload);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateCurrentStep();
    if (error !== "") {
      setValidationError(error);
      return;
    }

    const nextStep = steps[currentStepIndex + 1];
    if (nextStep !== undefined) {
      revealStep(nextStep);
      return;
    }

    let payload: CreateDailyFeedRequest;
    try {
      payload = buildPayload();
    } catch (buildError) {
      const invalidStep = firstInvalidFeedStep(steps, {
        filters,
        intervalSeconds,
        itemCount,
        kind,
        name,
        sourceFields,
        sourceId,
        startsAt,
      });
      setCurrentStep(invalidStep);
      setValidationError(errorMessage(buildError));
      return;
    }
    onCreateFeed(payload);
  }

  function stepError(step: FeedStep) {
    return currentStep === step && validationError !== "" ? (
      <div className="form-error create-wizard-step-error" role="alert">
        {validationError}
      </div>
    ) : null;
  }

  return (
    <CreateWizardDialog
      actionLabel="Add feed"
      busy={saving}
      busyLabel="Adding..."
      context={groupName}
      currentStep={currentStep}
      currentStepIndex={currentStepIndex}
      error={formError}
      stepCount={steps.length}
      submitDisabled={submitDisabled}
      title="Add feed"
      {...(currentStepIndex > 0 ? { onBack: handleBack } : {})}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {visibleSteps.includes("type") ? (
        <CreateWizardStep
          current={currentStep === "type"}
          labelId={`${stepLabelId}-type`}
          number={steps.indexOf("type") + 1}
          step="type"
          title="Feed type"
          onActivate={activateStep}
        >
          <div aria-labelledby={`${stepLabelId}-type`} className="create-wizard-choice-control" role="group">
            <button
              aria-pressed={kind === "catalog_daily"}
              className="create-wizard-choice-option"
              disabled={saving}
              type="button"
              onClick={() => chooseKind("catalog_daily")}
            >
              Practice feed
            </button>
            <button
              aria-pressed={kind === "daily_thread"}
              className="create-wizard-choice-option"
              disabled={saving}
              type="button"
              onClick={() => chooseKind("daily_thread")}
            >
              Daily thread
            </button>
          </div>
          {kind !== null ? (
            <div className="field-hint">
              {practice ? "Selects scheduled items from a catalog." : "A shared recurring space without catalog items."}
            </div>
          ) : null}
          {stepError("type")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("details") ? (
        <CreateWizardStep
          current={currentStep === "details"}
          labelId={`${stepLabelId}-details`}
          number={steps.indexOf("details") + 1}
          step="details"
          title="Feed details"
          onActivate={activateStep}
        >
          <div className="form-grid two-column">
            <label>
              Name
              <input
                disabled={saving}
                placeholder={practice ? "Daily Practice" : "Daily Thread"}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  markDraftChanged();
                }}
              />
            </label>
            <label className="checkbox-row status-checkbox">
              <input
                checked={enabled}
                disabled={saving}
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
              disabled={saving}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                markDraftChanged();
              }}
            />
          </label>
          {stepError("details")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("format") ? (
        <CreateWizardStep
          current={currentStep === "format"}
          labelId={`${stepLabelId}-format`}
          number={steps.indexOf("format") + 1}
          step="format"
          title="Post format"
          onActivate={activateStep}
        >
          <label>
            Post format
            <select
              disabled={saving || evidenceFormats.length === 0}
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
          <label className="checkbox-row">
            <input
              checked={captionsEnabled}
              disabled={saving}
              type="checkbox"
              onChange={(event) => {
                setCaptionsEnabled(event.target.checked);
                markDraftChanged();
              }}
            />
            Allow captions
          </label>
          {sourcesLoading ? (
            <div className="field-hint">Loading post formats...</div>
          ) : evidenceFormats.length === 0 ? (
            <div className="field-hint">The group default will be used.</div>
          ) : (
            <div className="field-hint">Controls the text rules for member posts.</div>
          )}
          {stepError("format")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("catalog") ? (
        <CreateWizardStep
          current={currentStep === "catalog"}
          labelId={`${stepLabelId}-catalog`}
          number={steps.indexOf("catalog") + 1}
          step="catalog"
          title="Catalog setup"
          onActivate={activateStep}
        >
          <div className="form-grid two-column">
            <label>
              Source
              <select
                disabled={saving || sourcesLoading || sources.length === 0}
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
                disabled={saving}
                max="50"
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
          {sourcesLoading ? <div className="empty-state">Loading catalog sources...</div> : null}
          {!sourcesLoading && sources.length === 0 ? (
            <div className="empty-state">No catalog sources available.</div>
          ) : null}
          <CatalogFiltersEditor
            disabled={saving}
            fields={sourceFields}
            filters={filters}
            onChange={(nextFilters) => {
              setFilters(nextFilters);
              markDraftChanged();
            }}
          />
          {stepError("catalog")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("schedule") ? (
        <CreateWizardStep
          current={currentStep === "schedule"}
          labelId={`${stepLabelId}-schedule`}
          number={steps.indexOf("schedule") + 1}
          step="schedule"
          title="Schedule"
          onActivate={activateStep}
        >
          <div className="form-grid three-column">
            <label>
              Start time
              <input
                disabled={saving}
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
                disabled={saving}
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
                disabled={saving}
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
          {stepError("schedule")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("review") ? (
        <CreateWizardStep
          current={currentStep === "review"}
          labelId={`${stepLabelId}-review`}
          number={steps.indexOf("review") + 1}
          step="review"
          title="Review and preview"
          onActivate={activateStep}
        >
          <div className="preview-panel">
            <div className="row-top">
              <div>
                <div className="title">{name.trim() || "Untitled practice feed"}</div>
                <div className="meta">
                  {selectedSource?.name ?? "No source"} · {itemCount || "0"} items
                </div>
              </div>
              <button
                className="secondary"
                type="button"
                disabled={previewLoading || saving || sourcesLoading || sourceId === ""}
                onClick={handlePreview}
              >
                {previewLoading ? "Previewing..." : "Preview"}
              </button>
            </div>
            {preview === null ? <div className="field-hint">Preview is optional before adding the feed.</div> : null}
          </div>
          {preview !== null ? <PreviewPanel preview={preview} /> : null}
          {stepError("review")}
        </CreateWizardStep>
      ) : null}
    </CreateWizardDialog>
  );
}

type FeedValidationDraft = {
  filters: DraftFilter[];
  intervalSeconds: string;
  itemCount: string;
  kind: FeedKind | null;
  name: string;
  sourceFields: CatalogSourceField[];
  sourceId: string;
  startsAt: string;
};

function feedSteps(kind: FeedKind | null, canCreateDailyThread: boolean): FeedStep[] {
  const steps: FeedStep[] = [];
  if (canCreateDailyThread) {
    steps.push("type");
  }
  steps.push("details", "format");
  if (kind !== "daily_thread") {
    steps.push("catalog");
  }
  steps.push("schedule");
  if (kind !== "daily_thread") {
    steps.push("review");
  }
  return steps;
}

function validateFeedStep(step: FeedStep, draft: FeedValidationDraft): string {
  if (step === "type" && draft.kind === null) {
    return "Choose a feed type";
  }
  if (step === "details" && draft.kind === "catalog_daily" && draft.name.trim() === "") {
    return "Name is required";
  }
  if (step === "catalog") {
    if (draft.sourceId === "") {
      return "Source is required";
    }
    const parsedItemCount = Number(draft.itemCount);
    if (!Number.isInteger(parsedItemCount) || parsedItemCount < 1 || parsedItemCount > 50) {
      return "Item count must be between 1 and 50";
    }
    try {
      draft.filters.forEach((filter) => draftFilterToRequest(filter, draft.sourceFields));
    } catch (error) {
      return errorMessage(error);
    }
  }
  if (step === "schedule") {
    try {
      localInputToISOString(draft.startsAt);
    } catch (error) {
      return errorMessage(error);
    }
    const parsedInterval = Number(draft.intervalSeconds);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1) {
      return "Repeat interval is invalid";
    }
  }
  return "";
}

function firstInvalidFeedStep(steps: FeedStep[], draft: FeedValidationDraft): FeedStep {
  return steps.find((step) => validateFeedStep(step, draft) !== "") ?? steps[steps.length - 1] ?? "details";
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
      {items.length > 0 ? (
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
