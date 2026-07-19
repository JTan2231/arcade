import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import type {
  CatalogSource,
  CatalogSourceField,
  CycleConfiguration,
  CyclePreview,
  CycleSettings,
  DailyFeed,
  DailyFeedCycle,
  UpsertCycleSettingsRequest,
} from "../../types";
import { CreateWizardDialog, CreateWizardStep } from "../CreateWizardDialog";
import { CatalogFiltersEditor } from "../dashboard/CatalogFiltersEditor";
import type { DraftFilter } from "../dashboard/feedDraft";
import { draftFilterToRequest } from "../dashboard/feedDraft";
import { firstNonEmpty, outputItemDisplayTitle, primitiveDisplay } from "../dashboard/format";

type CycleStep = "cycle" | "configurations" | "review";

type ConfigurationDraft = {
  localId: string;
  key: string;
  name: string;
  description: string;
  filters: DraftFilter[];
  distinctFieldId: string;
  orderValue: string;
};

export function FeedCyclesDialog({
  feed,
  settings,
  cycles,
  sources,
  loading,
  busy,
  error,
  editorOpen,
  preview,
  previewLoading,
  saving,
  refreshingCycleId,
  onClose,
  onOpenEditor,
  onCloseEditor,
  onDraftChanged,
  onPreview,
  onSave,
  onDelete,
  onRefresh,
}: {
  feed: DailyFeed;
  settings: CycleSettings | null;
  cycles: DailyFeedCycle[];
  sources: CatalogSource[];
  loading: boolean;
  busy: boolean;
  error: string;
  editorOpen: boolean;
  preview: CyclePreview | null;
  previewLoading: boolean;
  saving: boolean;
  refreshingCycleId: string | null;
  onClose: () => void;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onDraftChanged: () => void;
  onPreview: (payload: UpsertCycleSettingsRequest) => void;
  onSave: (payload: UpsertCycleSettingsRequest) => void;
  onDelete: () => void;
  onRefresh: (cycleId: string) => void;
}) {
  const source = sources.find((candidate) => candidate.id === feed.source_id) ?? null;
  if (editorOpen) {
    return (
      <CycleSettingsEditor
        key={settings?.updated_at ?? `${feed.id}-new`}
        error={error}
        feed={feed}
        preview={preview}
        previewLoading={previewLoading}
        saving={saving}
        settings={settings}
        source={source}
        onClose={onCloseEditor}
        onDraftChanged={onDraftChanged}
        onPreview={onPreview}
        onSave={onSave}
      />
    );
  }

  return (
    <CycleSettingsManager
      busy={busy}
      cycles={cycles}
      error={error}
      feed={feed}
      loading={loading}
      refreshingCycleId={refreshingCycleId}
      settings={settings}
      onClose={onClose}
      onDelete={onDelete}
      onOpenEditor={onOpenEditor}
      onRefresh={onRefresh}
    />
  );
}

function CycleSettingsManager({
  feed,
  settings,
  cycles,
  loading,
  busy,
  error,
  refreshingCycleId,
  onClose,
  onOpenEditor,
  onDelete,
  onRefresh,
}: {
  feed: DailyFeed;
  settings: CycleSettings | null;
  cycles: DailyFeedCycle[];
  loading: boolean;
  busy: boolean;
  error: string;
  refreshingCycleId: string | null;
  onClose: () => void;
  onOpenEditor: () => void;
  onDelete: () => void;
  onRefresh: (cycleId: string) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const visibleCycles = [...cycles].sort((left, right) => right.starts_on.localeCompare(left.starts_on));

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
      <section className="modal-panel feed-cycles-dialog" role="dialog" aria-modal="true" aria-label="Feed cycles">
        <div className="modal-header">
          <div>
            <h2>Cycles</h2>
            <div className="meta">{feed.name}</div>
          </div>
          <button className="secondary" disabled={busy} ref={closeButtonRef} type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? <div className="empty-state">Loading cycles...</div> : null}
        {error !== "" ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}

        {!loading && settings === null && error === "" ? (
          <section className="cycle-settings-summary" aria-label="Cycle settings summary">
            <div>
              <div className="title">
                {feed.cycle_settings?.status === "ended" ? "Cycles have ended" : "Cycles are not configured"}
              </div>
              <div className="meta">
                {feed.schedule.interval_seconds < 86400
                  ? "Set cadence to daily or slower to configure new cycles; generated history remains available."
                  : feed.cycle_settings?.status === "ended"
                    ? "Configure new cycles or review generated history."
                    : "Create ordered configurations for complete generated cycles."}
              </div>
            </div>
            <button
              className="secondary"
              disabled={busy || feed.schedule.interval_seconds < 86400}
              type="button"
              onClick={onOpenEditor}
            >
              Configure cycles
            </button>
          </section>
        ) : null}

        {!loading && settings !== null ? (
          <>
            <section className="cycle-settings-summary" aria-label="Cycle settings summary">
              <div>
                <div className="title">{cycleStatusLabel(settings.status)}</div>
                <div className="meta">
                  {settings.output_count} outputs per cycle · {settings.configurations.length} configuration
                  {settings.configurations.length === 1 ? "" : "s"}
                </div>
                <div className="meta">Boundary {settings.effective_starts_on}</div>
                {settings.ends_before !== undefined ? (
                  <div className="meta">Ends before {settings.ends_before}</div>
                ) : settings.next_cycle_starts_on !== undefined ? (
                  <div className="meta">Next boundary {settings.next_cycle_starts_on}</div>
                ) : null}
              </div>
              <button
                className="secondary"
                disabled={busy || settings.status === "ending"}
                type="button"
                onClick={onOpenEditor}
              >
                Edit settings
              </button>
            </section>

            <section className="cycle-configuration-list" aria-label="Configurations">
              <div className="section-title">Configurations</div>
              {settings.configurations.map((configuration, index) => (
                <div className="row cycle-configuration-summary" key={configuration.id ?? configuration.key}>
                  <div>
                    <div className="title">
                      {index + 1}. {configuration.name}
                    </div>
                    <div className="meta">{configurationSummary(configuration)}</div>
                  </div>
                </div>
              ))}
            </section>

            <section className="cycle-delete-row" aria-label="Delete cycle settings">
              <div>
                <div className="section-title">
                  {settings.status === "ending" ? "Cycle settings will end" : "Delete cycle settings"}
                </div>
                <div className="meta">
                  {settings.status === "ending" && settings.ends_before !== undefined
                    ? `Cycles stop before ${settings.ends_before}.`
                    : "Historical generated cycles remain available."}
                </div>
              </div>
              {settings.status !== "ending" ? (
                <button
                  className="danger"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    if (window.confirm("Delete cycle settings?")) {
                      onDelete();
                    }
                  }}
                >
                  Delete
                </button>
              ) : null}
            </section>
          </>
        ) : null}

        {!loading && (settings !== null || visibleCycles.length > 0) ? (
          <GeneratedCyclesSection
            busy={busy}
            canRefresh={settings !== null && settings.status !== "ending"}
            cycles={visibleCycles}
            refreshingCycleId={refreshingCycleId}
            onRefresh={onRefresh}
          />
        ) : null}
      </section>
    </div>
  );
}

function CycleSettingsEditor({
  feed,
  source,
  settings,
  preview,
  previewLoading,
  saving,
  error,
  onClose,
  onDraftChanged,
  onPreview,
  onSave,
}: {
  feed: DailyFeed;
  source: CatalogSource | null;
  settings: CycleSettings | null;
  preview: CyclePreview | null;
  previewLoading: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onDraftChanged: () => void;
  onPreview: (payload: UpsertCycleSettingsRequest) => void;
  onSave: (payload: UpsertCycleSettingsRequest) => void;
}) {
  const stepLabelId = useId();
  const [startsOn, setStartsOn] = useState(
    settings?.next_cycle_starts_on ?? settings?.starts_on ?? currentScheduledDate(feed),
  );
  const [outputCount, setOutputCount] = useState(String(settings?.output_count ?? 14));
  const [configurations, setConfigurations] = useState<ConfigurationDraft[]>(() =>
    initialConfigurationDrafts(settings, feed),
  );
  const [currentStep, setCurrentStep] = useState<CycleStep>("cycle");
  const [revealedSteps, setRevealedSteps] = useState<CycleStep[]>(["cycle"]);
  const [validationError, setValidationError] = useState("");
  const steps: CycleStep[] = ["cycle", "configurations", "review"];
  const currentStepIndex = steps.indexOf(currentStep);
  const visibleSteps = steps.filter((step) => revealedSteps.includes(step));
  const scalarFields = useMemo(() => source?.fields.filter((field) => !field.is_array) ?? [], [source]);

  function markDraftChanged() {
    setValidationError("");
    onDraftChanged();
  }

  function activateStep(step: CycleStep) {
    if (!saving && step !== currentStep) {
      setCurrentStep(step);
      setValidationError("");
    }
  }

  function revealStep(step: CycleStep) {
    setRevealedSteps((current) => (current.includes(step) ? current : [...current, step]));
    setCurrentStep(step);
    setValidationError("");
  }

  function updateConfiguration(localId: string, patch: Partial<ConfigurationDraft>) {
    setConfigurations((current) =>
      current.map((configuration) =>
        configuration.localId === localId ? { ...configuration, ...patch } : configuration,
      ),
    );
    markDraftChanged();
  }

  function moveConfiguration(index: number, offset: -1 | 1) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= configurations.length) {
      return;
    }
    setConfigurations((current) => {
      const next = [...current];
      const [configuration] = next.splice(index, 1);
      if (configuration !== undefined) {
        next.splice(nextIndex, 0, configuration);
      }
      return next;
    });
    markDraftChanged();
  }

  function buildPayload(usePreviewToken: boolean): UpsertCycleSettingsRequest {
    if (startsOn === "") {
      throw new Error("Start boundary is required");
    }
    const parsedOutputCount = Number(outputCount);
    if (!Number.isInteger(parsedOutputCount) || parsedOutputCount < 1 || parsedOutputCount > 50) {
      throw new Error("Outputs per cycle must be between 1 and 50");
    }
    if (source === null) {
      throw new Error("Catalog source is unavailable");
    }
    if (configurations.length === 0) {
      throw new Error("Add at least one configuration");
    }
    const keys = new Set<string>();
    const payloadConfigurations = configurations.map((configuration, index) => {
      const key = configuration.key.trim();
      const name = configuration.name.trim();
      if (key === "") {
        throw new Error(`Configuration ${index + 1} key is required`);
      }
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) {
        throw new Error(
          `Configuration ${index + 1} key must start with a lowercase letter or number and use at most 64 lowercase letters, numbers, underscores, or hyphens`,
        );
      }
      if (keys.has(key)) {
        throw new Error(`Configuration key ${key} is duplicated`);
      }
      keys.add(key);
      if (name === "") {
        throw new Error(`Configuration ${index + 1} name is required`);
      }
      const distinct =
        configuration.distinctFieldId === ""
          ? ({ kind: "none" } as const)
          : ({ kind: "field", field_id: requireScalarField(scalarFields, configuration.distinctFieldId).id } as const);
      const order = cycleOrderFromValue(configuration.orderValue, scalarFields);
      return {
        key,
        name,
        ...(configuration.description.trim() !== "" ? { description: configuration.description.trim() } : {}),
        filters: configuration.filters.map((filter) => draftFilterToRequest(filter, source.fields)),
        distinct,
        order,
      } satisfies CycleConfiguration;
    });
    const payload: UpsertCycleSettingsRequest = {
      starts_on: startsOn,
      output_count: parsedOutputCount,
      configurations: payloadConfigurations,
    };
    if (usePreviewToken && preview?.selection_token !== undefined && preview.selection_token !== "") {
      payload.selection_token = preview.selection_token;
    }
    return payload;
  }

  function validateStep(step: CycleStep): string {
    try {
      if (step === "cycle") {
        if (startsOn === "") {
          return "Start boundary is required";
        }
        const count = Number(outputCount);
        if (!Number.isInteger(count) || count < 1 || count > 50) {
          return "Outputs per cycle must be between 1 and 50";
        }
      }
      if (step === "configurations") {
        buildPayload(false);
      }
      if (step === "review") {
        if (preview === null) {
          return "Preview the complete cycle before saving";
        }
        if (preview.counts.selected_item_count !== preview.counts.requested_item_count) {
          return `Only ${preview.counts.selected_item_count} of ${preview.counts.requested_item_count} problems could be selected`;
        }
      }
    } catch (caught) {
      return caught instanceof Error ? caught.message : "Cycle settings are invalid";
    }
    return "";
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    onSave(buildPayload(true));
  }

  const stepError = (step: CycleStep) =>
    currentStep === step && validationError !== "" ? (
      <div className="form-error create-wizard-step-error" role="alert">
        {validationError}
      </div>
    ) : null;

  return (
    <CreateWizardDialog
      actionLabel="Save settings"
      busy={saving}
      busyLabel="Saving..."
      context={feed.name}
      currentStep={currentStep}
      currentStepIndex={currentStepIndex}
      error={error}
      stepCount={steps.length}
      submitDisabled={previewLoading || source === null || (currentStep === "review" && preview === null)}
      title="Cycle settings"
      {...(currentStepIndex > 0 ? { onBack: () => revealStep(steps[currentStepIndex - 1]!) } : {})}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {visibleSteps.includes("cycle") ? (
        <CreateWizardStep
          current={currentStep === "cycle"}
          labelId={`${stepLabelId}-cycle`}
          number={1}
          step="cycle"
          title="Cycle"
          onActivate={activateStep}
        >
          <div className="form-grid two-column">
            <label>
              Start boundary
              <input
                disabled={saving || settings !== null}
                min={currentScheduledDate(feed)}
                type="date"
                value={startsOn}
                onChange={(event) => {
                  setStartsOn(event.target.value);
                  markDraftChanged();
                }}
              />
            </label>
            <label>
              Outputs per cycle
              <input
                disabled={saving}
                max="50"
                min="1"
                step="1"
                type="number"
                value={outputCount}
                onChange={(event) => {
                  setOutputCount(event.target.value);
                  markDraftChanged();
                }}
              />
            </label>
          </div>
          <div className="field-hint">One problem is assigned to each scheduled output.</div>
          {settings !== null ? (
            <div className="field-hint">Changes take effect at the next complete cycle boundary.</div>
          ) : null}
          {stepError("cycle")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("configurations") ? (
        <CreateWizardStep
          current={currentStep === "configurations"}
          labelId={`${stepLabelId}-configurations`}
          number={2}
          step="configurations"
          title="Configurations"
          onActivate={activateStep}
        >
          <div className="configuration-editor-list">
            {configurations.map((configuration, index) => (
              <ConfigurationEditor
                configuration={configuration}
                index={index}
                key={configuration.localId}
                scalarFields={scalarFields}
                saving={saving}
                sourceFields={source?.fields ?? []}
                total={configurations.length}
                onMove={(offset) => moveConfiguration(index, offset)}
                onRemove={() => {
                  setConfigurations((current) =>
                    current.filter((candidate) => candidate.localId !== configuration.localId),
                  );
                  markDraftChanged();
                }}
                onUpdate={(patch) => updateConfiguration(configuration.localId, patch)}
              />
            ))}
          </div>
          <button
            className="secondary"
            disabled={saving || source === null}
            type="button"
            onClick={() => {
              setConfigurations((current) => [
                ...current,
                emptyConfigurationDraft(nextConfigurationNumber(current), []),
              ]);
              markDraftChanged();
            }}
          >
            Add configuration
          </button>
          {stepError("configurations")}
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
                <div className="title">Complete cycle preview</div>
                <div className="meta">
                  {outputCount || "0"} outputs · {configurations.length} configuration
                  {configurations.length === 1 ? "" : "s"}
                </div>
              </div>
              <button
                className="secondary"
                disabled={previewLoading || saving || source === null}
                type="button"
                onClick={() => {
                  try {
                    onPreview(buildPayload(false));
                  } catch (caught) {
                    setValidationError(caught instanceof Error ? caught.message : "Cycle settings are invalid");
                  }
                }}
              >
                {previewLoading ? "Previewing..." : "Preview"}
              </button>
            </div>
            {preview === null ? <div className="field-hint">Preview is required before saving.</div> : null}
          </div>
          {preview !== null ? <CyclePreviewPanel preview={preview} /> : null}
          {stepError("review")}
        </CreateWizardStep>
      ) : null}
    </CreateWizardDialog>
  );
}

function ConfigurationEditor({
  configuration,
  index,
  total,
  sourceFields,
  scalarFields,
  saving,
  onUpdate,
  onMove,
  onRemove,
}: {
  configuration: ConfigurationDraft;
  index: number;
  total: number;
  sourceFields: CatalogSourceField[];
  scalarFields: CatalogSourceField[];
  saving: boolean;
  onUpdate: (patch: Partial<ConfigurationDraft>) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = configuration.name.trim() || `Configuration ${index + 1}`;
  return (
    <section className="configuration-editor" aria-label={`Configuration ${index + 1}: ${label}`}>
      <div className="configuration-editor-header">
        <div className="section-title">Configuration {index + 1}</div>
        <div className="configuration-editor-actions">
          <button
            aria-label={`Move ${label} up`}
            className="secondary"
            disabled={saving || index === 0}
            type="button"
            onClick={() => onMove(-1)}
          >
            Up
          </button>
          <button
            aria-label={`Move ${label} down`}
            className="secondary"
            disabled={saving || index === total - 1}
            type="button"
            onClick={() => onMove(1)}
          >
            Down
          </button>
          <button className="secondary" disabled={saving || total === 1} type="button" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      <div className="form-grid two-column">
        <label>
          Configuration name
          <input
            disabled={saving}
            value={configuration.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
          />
        </label>
        <label>
          Configuration key
          <input
            disabled={saving}
            value={configuration.key}
            onChange={(event) => onUpdate({ key: event.target.value })}
          />
        </label>
      </div>
      <label>
        Description
        <textarea
          disabled={saving}
          value={configuration.description}
          onChange={(event) => onUpdate({ description: event.target.value })}
        />
      </label>
      <CatalogFiltersEditor
        disabled={saving}
        fields={sourceFields}
        filters={configuration.filters}
        label={`Filters for ${label}`}
        onChange={(filters) => onUpdate({ filters })}
      />
      <div className="form-grid two-column">
        <label>
          Distinct values
          <select
            aria-label="Distinct values"
            disabled={saving}
            value={configuration.distinctFieldId}
            onChange={(event) => onUpdate({ distinctFieldId: event.target.value })}
          >
            <option value="">None</option>
            {scalarFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Order
          <select
            aria-label="Order"
            disabled={saving}
            value={configuration.orderValue}
            onChange={(event) => onUpdate({ orderValue: event.target.value })}
          >
            <option value="seeded_shuffle">Seeded shuffle</option>
            {scalarFields.flatMap((field) => [
              <option key={`${field.id}:asc`} value={`field:${field.id}:asc`}>
                {field.label} — Ascending
              </option>,
              <option key={`${field.id}:desc`} value={`field:${field.id}:desc`}>
                {field.label} — Descending
              </option>,
            ])}
          </select>
        </label>
      </div>
      <div className="field-hint">
        Distinct values limit selection to one problem per value. Order is applied after membership is selected.
      </div>
    </section>
  );
}

function GeneratedCyclesSection({
  cycles,
  canRefresh,
  busy,
  refreshingCycleId,
  onRefresh,
}: {
  cycles: DailyFeedCycle[];
  canRefresh: boolean;
  busy: boolean;
  refreshingCycleId: string | null;
  onRefresh: (cycleId: string) => void;
}) {
  return (
    <section className="cycle-list" aria-label="Generated cycles">
      <div className="section-title">Generated cycles</div>
      {cycles.length === 0 ? <div className="empty-state">No cycles generated yet.</div> : null}
      {cycles.map((cycle) => (
        <div className="row cycle-row" key={cycle.id}>
          <div>
            <div className="title">{cycle.name}</div>
            <div className="meta">
              {cycle.starts_on} through {cycle.ends_on} · {cycleStatusLabel(cycle.status)} · generation{" "}
              {cycle.generation}
            </div>
            <div className="meta">{cycleSummary(cycle.summary)}</div>
          </div>
          {canRefresh && cycle.status !== "ended" ? (
            <button
              className="secondary"
              disabled={busy}
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `Refresh ${cycle.name}? This replaces every problem in the cycle unless posts already exist.`,
                  )
                ) {
                  onRefresh(cycle.id);
                }
              }}
            >
              {refreshingCycleId === cycle.id ? "Refreshing..." : "Refresh cycle"}
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function CyclePreviewPanel({ preview }: { preview: CyclePreview }) {
  const incomplete = preview.counts.selected_item_count !== preview.counts.requested_item_count;
  const showRating = preview.outputs.some((output) => primitiveDisplay(output.items[0]?.item.data["rating"]) !== "");
  return (
    <section className="cycle-preview" aria-label="Cycle preview">
      <div className="row-top">
        <div>
          <div className="title">{preview.cycle.name}</div>
          <div className="meta">
            {preview.cycle.starts_on} through {preview.cycle.ends_on}
          </div>
        </div>
        <div className="meta">{preview.cycle.position_count} outputs</div>
      </div>
      <div className="cycle-preview-counts">
        <span className="cycle-preview-count">{preview.counts.candidate_item_count} candidates</span>
        <span className="cycle-preview-count">{preview.counts.matching_item_count} matching</span>
        {preview.counts.distinct_value_count !== undefined ? (
          <span className="cycle-preview-count">{preview.counts.distinct_value_count} distinct values</span>
        ) : null}
        <span className="cycle-preview-count">
          {preview.counts.selected_item_count} of {preview.counts.requested_item_count} selected
        </span>
      </div>
      {incomplete ? (
        <div className="form-error" role="alert">
          Only {preview.counts.selected_item_count} of {preview.counts.requested_item_count} problems could be selected.
        </div>
      ) : null}
      <div className="cycle-preview-table-wrap">
        <table className="cycle-preview-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Date</th>
              <th scope="col">Problem</th>
              {showRating ? <th scope="col">Rating</th> : null}
            </tr>
          </thead>
          <tbody>
            {preview.outputs.map((output, index) => {
              const item = output.items[0];
              return (
                <tr key={`${output.date}-${item?.item.id ?? index}`}>
                  <td>{output.cycle?.position ?? index + 1}</td>
                  <td>{output.date}</td>
                  <td>
                    {item === undefined
                      ? "No problem selected"
                      : firstNonEmpty(outputItemDisplayTitle(item), "Untitled")}
                  </td>
                  {showRating ? (
                    <td>{item === undefined ? "—" : firstNonEmpty(primitiveDisplay(item.item.data["rating"]), "—")}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function initialConfigurationDrafts(settings: CycleSettings | null, feed: DailyFeed): ConfigurationDraft[] {
  if (settings === null || settings.configurations.length === 0) {
    return [emptyConfigurationDraft(1, feed.filters)];
  }
  return settings.configurations.map((configuration) => ({
    localId: configuration.id ?? globalThis.crypto.randomUUID(),
    key: configuration.key,
    name: configuration.name,
    description: configuration.description ?? "",
    filters: configuration.filters.map((filter, filterIndex) => ({
      id: filter.id ?? `${configuration.key}-${filterIndex}`,
      fieldId: filter.field_id,
      op: filter.op,
      textValue: (filter.text_values ?? []).join(", "),
      numberValue: filter.number_values?.[0] === undefined ? "" : String(filter.number_values[0]),
      numberMaxValue: filter.number_values?.[1] === undefined ? "" : String(filter.number_values[1]),
    })),
    distinctFieldId: configuration.distinct.kind === "field" ? configuration.distinct.field_id : "",
    orderValue:
      configuration.order.kind === "field"
        ? `field:${configuration.order.field_id}:${configuration.order.direction}`
        : "seeded_shuffle",
  }));
}

function emptyConfigurationDraft(number: number, filters: DailyFeed["filters"]): ConfigurationDraft {
  return {
    localId: globalThis.crypto.randomUUID(),
    key: `configuration-${number}`,
    name: `Configuration ${number}`,
    description: "",
    filters: filters.map((filter, index) => ({
      id: filter.id ?? `configuration-${number}-${index}`,
      fieldId: filter.field_id,
      op: filter.op,
      textValue: (filter.text_values ?? []).join(", "),
      numberValue: filter.number_values?.[0] === undefined ? "" : String(filter.number_values[0]),
      numberMaxValue: filter.number_values?.[1] === undefined ? "" : String(filter.number_values[1]),
    })),
    distinctFieldId: "",
    orderValue: "seeded_shuffle",
  };
}

function nextConfigurationNumber(configurations: ConfigurationDraft[]): number {
  const keys = new Set(configurations.map((configuration) => configuration.key));
  let number = configurations.length + 1;
  while (keys.has(`configuration-${number}`)) {
    number += 1;
  }
  return number;
}

function cycleOrderFromValue(value: string, fields: CatalogSourceField[]): CycleConfiguration["order"] {
  if (value === "seeded_shuffle") {
    return { kind: "seeded_shuffle" };
  }
  const [, fieldId, direction] = value.split(":");
  if (fieldId === undefined || (direction !== "asc" && direction !== "desc")) {
    throw new Error("Configuration order is invalid");
  }
  return { kind: "field", field_id: requireScalarField(fields, fieldId).id, direction };
}

function requireScalarField(fields: CatalogSourceField[], fieldId: string): CatalogSourceField {
  const field = fields.find((candidate) => candidate.id === fieldId && !candidate.is_array);
  if (field === undefined) {
    throw new Error("Configuration field is invalid");
  }
  return field;
}

function configurationSummary(configuration: CycleConfiguration): string {
  const distinct =
    configuration.distinct.kind === "field"
      ? `Distinct ${configuration.distinct.field_label ?? "field"}`
      : "No distinct field";
  const order =
    configuration.order.kind === "field"
      ? `${configuration.order.field_label ?? "Field"} ${configuration.order.direction === "asc" ? "ascending" : "descending"}`
      : "Seeded shuffle";
  return `${configuration.filters.length} filter${configuration.filters.length === 1 ? "" : "s"} · ${distinct} · ${order}`;
}

function cycleSummary(summary: DailyFeedCycle["summary"]): string {
  return [...summary.filters, summary.distinct, summary.order].filter((value) => value !== "").join(" · ");
}

function cycleStatusLabel(status: CycleSettings["status"] | DailyFeedCycle["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function currentScheduledDate(feed: DailyFeed): string {
  const startsAt = new Date(feed.schedule.starts_at).getTime();
  const intervalMs = feed.schedule.interval_seconds * 1000;
  const now = Date.now();
  if (!Number.isFinite(startsAt) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return dateInTimezone(new Date(), feed.schedule.timezone);
  }
  if (startsAt > now) {
    return dateInTimezone(new Date(startsAt), feed.schedule.timezone);
  }
  const boundary = new Date(startsAt + Math.floor((now - startsAt) / intervalMs) * intervalMs);
  return dateInTimezone(boundary, feed.schedule.timezone);
}

function dateInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
