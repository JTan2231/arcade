import { FormEvent, useId, useState } from "react";

import { CreateWizardDialog, CreateWizardStep } from "../CreateWizardDialog";
import type { CreateEvidenceFormatRequest, EvidenceFormat } from "../../types";
import {
  buildFormatEditPayloads,
  buildFormatPayload,
  evidenceFormatToDraft,
  emptyFormatDraft,
  type EvidenceFormatDraft,
  type EvidenceFormatEditPayloads,
  formatEditHasChanges,
  validateFormatIdentity,
  validateFormatLength,
  validateFormatLineLength,
  validateFormatLines,
} from "./evidenceFormatDraft";
import {
  EvidenceFormatLengthFields,
  EvidenceFormatLineFields,
  EvidenceFormatLineLengthFields,
} from "./EvidenceFormatConstraintFields";

type FormatStep = "details" | "length" | "lines" | "line-length";

const formatSteps: FormatStep[] = ["details", "length", "lines", "line-length"];

export function CreateEvidenceFormatDialog({
  groupName,
  saving,
  submissionError,
  onClose,
  onCreate,
  onDraftChanged,
}: {
  groupName: string;
  saving: boolean;
  submissionError: string;
  onClose: () => void;
  onCreate: (payload: CreateEvidenceFormatRequest) => void;
  onDraftChanged: () => void;
}) {
  return (
    <EvidenceFormatWizardDialog
      actionLabel={() => "Add format"}
      busyLabel="Adding..."
      context={groupName}
      initialDraft={emptyFormatDraft}
      saving={saving}
      submissionError={submissionError}
      submitDisabled={() => false}
      title="Add format"
      onClose={onClose}
      onDraftChanged={onDraftChanged}
      onSubmitDraft={(draft) => {
        const payload = buildFormatPayload(draft);
        if (typeof payload === "string") {
          return payload;
        }
        onCreate(payload);
        return undefined;
      }}
    />
  );
}

export function EditEvidenceFormatDialog({
  groupName,
  format,
  saving,
  submissionError,
  onClose,
  onSave,
  onDraftChanged,
}: {
  groupName: string;
  format: EvidenceFormat;
  saving: boolean;
  submissionError: string;
  onClose: () => void;
  onSave: (payloads: EvidenceFormatEditPayloads) => void;
  onDraftChanged: () => void;
}) {
  function payloadsFor(draft: EvidenceFormatDraft) {
    return buildFormatEditPayloads(format, draft);
  }

  return (
    <EvidenceFormatWizardDialog
      actionLabel={(draft) => {
        const payloads = payloadsFor(draft);
        return typeof payloads !== "string" && payloads.version !== undefined ? "Publish version" : "Save format";
      }}
      busyLabel="Saving..."
      context={`${groupName} · v${format.active_version.version_number}`}
      finalHint="Changing constraints publishes a new immutable version. Existing posts keep the version that validated them."
      initialDraft={evidenceFormatToDraft(format)}
      initiallyRevealAll
      lockSlug
      saving={saving}
      submissionError={submissionError}
      submitDisabled={(draft) => {
        const payloads = payloadsFor(draft);
        return typeof payloads !== "string" && !formatEditHasChanges(payloads);
      }}
      title={`Edit ${format.name}`}
      onClose={onClose}
      onDraftChanged={onDraftChanged}
      onSubmitDraft={(draft) => {
        const payloads = payloadsFor(draft);
        if (typeof payloads === "string") {
          return payloads;
        }
        if (formatEditHasChanges(payloads)) {
          onSave(payloads);
        }
        return undefined;
      }}
    />
  );
}

function EvidenceFormatWizardDialog({
  actionLabel,
  busyLabel,
  context,
  finalHint,
  initialDraft,
  initiallyRevealAll = false,
  lockSlug = false,
  saving,
  submissionError,
  submitDisabled,
  title,
  onClose,
  onDraftChanged,
  onSubmitDraft,
}: {
  actionLabel: (draft: EvidenceFormatDraft) => string;
  busyLabel: string;
  context: string;
  finalHint?: string;
  initialDraft: EvidenceFormatDraft;
  initiallyRevealAll?: boolean;
  lockSlug?: boolean;
  saving: boolean;
  submissionError: string;
  submitDisabled: (draft: EvidenceFormatDraft) => boolean;
  title: string;
  onClose: () => void;
  onDraftChanged: () => void;
  onSubmitDraft: (draft: EvidenceFormatDraft) => string | undefined;
}) {
  const stepLabelId = useId();
  const [draft, setDraft] = useState<EvidenceFormatDraft>(() => initialDraft);
  const [currentStep, setCurrentStep] = useState<FormatStep>("details");
  const [revealedSteps, setRevealedSteps] = useState<FormatStep[]>(initiallyRevealAll ? formatSteps : ["details"]);
  const [validationError, setValidationError] = useState("");
  const currentStepIndex = formatSteps.indexOf(currentStep);
  const visibleSteps = formatSteps.filter((step) => revealedSteps.includes(step));

  function updateDraft(patch: Partial<EvidenceFormatDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setValidationError("");
    onDraftChanged();
  }

  function activateStep(step: FormatStep) {
    if (saving || step === currentStep) {
      return;
    }
    setValidationError("");
    setCurrentStep(step);
  }

  function revealStep(step: FormatStep) {
    setRevealedSteps((current) => (current.includes(step) ? current : [...current, step]));
    setCurrentStep(step);
    setValidationError("");
  }

  function handleBack() {
    const previousStep = formatSteps[currentStepIndex - 1];
    if (!saving && previousStep !== undefined) {
      revealStep(previousStep);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateStep(currentStep, draft);
    if (error !== "") {
      setValidationError(error);
      return;
    }

    const nextStep = formatSteps[currentStepIndex + 1];
    if (nextStep !== undefined) {
      revealStep(nextStep);
      return;
    }

    const submitError = onSubmitDraft(draft);
    if (submitError !== undefined) {
      const invalidStep = firstInvalidStep(draft);
      setCurrentStep(invalidStep);
      setValidationError(submitError);
    }
  }

  function stepError(step: FormatStep) {
    return currentStep === step && validationError !== "" ? (
      <div className="form-error create-wizard-step-error" role="alert">
        {validationError}
      </div>
    ) : null;
  }

  return (
    <CreateWizardDialog
      actionLabel={actionLabel(draft)}
      busy={saving}
      busyLabel={busyLabel}
      context={context}
      currentStep={currentStep}
      currentStepIndex={currentStepIndex}
      error={submissionError}
      stepCount={formatSteps.length}
      submitDisabled={currentStepIndex === formatSteps.length - 1 && submitDisabled(draft)}
      title={title}
      {...(currentStepIndex > 0 ? { onBack: handleBack } : {})}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {visibleSteps.includes("details") ? (
        <CreateWizardStep
          current={currentStep === "details"}
          labelId={`${stepLabelId}-details`}
          number={formatSteps.indexOf("details") + 1}
          step="details"
          title="Format details"
          onActivate={activateStep}
        >
          <div className="form-grid two-column">
            <label>
              Name
              <input
                disabled={saving}
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </label>
            <label>
              Slug
              <input
                disabled={saving || lockSlug}
                placeholder="daily-update"
                value={draft.slug}
                onChange={(event) => updateDraft({ slug: event.target.value })}
              />
            </label>
          </div>
          {lockSlug ? <div className="field-hint">Slugs stay fixed after format creation.</div> : null}
          <label>
            Description
            <textarea
              aria-label="Description"
              disabled={saving}
              value={draft.description}
              onChange={(event) => updateDraft({ description: event.target.value })}
            />
          </label>
          {stepError("details")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("length") ? (
        <CreateWizardStep
          current={currentStep === "length"}
          labelId={`${stepLabelId}-length`}
          number={formatSteps.indexOf("length") + 1}
          step="length"
          title="Overall length"
          onActivate={activateStep}
        >
          <EvidenceFormatLengthFields disabled={saving} draft={draft} onChange={updateDraft} />
          <div className="field-hint">Leave the maximum blank when the format has no upper limit.</div>
          {stepError("length")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("lines") ? (
        <CreateWizardStep
          current={currentStep === "lines"}
          labelId={`${stepLabelId}-lines`}
          number={formatSteps.indexOf("lines") + 1}
          step="lines"
          title="Line rules"
          onActivate={activateStep}
        >
          <EvidenceFormatLineFields
            disabled={saving}
            draft={draft}
            lineModeLabel="Line count mode"
            onChange={updateDraft}
          />
          {stepError("lines")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("line-length") ? (
        <CreateWizardStep
          current={currentStep === "line-length"}
          labelId={`${stepLabelId}-line-length`}
          number={formatSteps.indexOf("line-length") + 1}
          step="line-length"
          title="Per-line length"
          onActivate={activateStep}
        >
          <EvidenceFormatLineLengthFields disabled={saving} draft={draft} onChange={updateDraft} />
          <div className="field-hint">Both per-line limits are optional.</div>
          {finalHint !== undefined ? <div className="field-hint">{finalHint}</div> : null}
          {stepError("line-length")}
        </CreateWizardStep>
      ) : null}
    </CreateWizardDialog>
  );
}

function validateStep(step: FormatStep, draft: EvidenceFormatDraft): string {
  if (step === "details") {
    return validateFormatIdentity(draft);
  }
  if (step === "length") {
    return validateFormatLength(draft);
  }
  if (step === "lines") {
    return validateFormatLines(draft);
  }
  return validateFormatLineLength(draft);
}

function firstInvalidStep(draft: EvidenceFormatDraft): FormatStep {
  return formatSteps.find((step) => validateStep(step, draft) !== "") ?? "line-length";
}
