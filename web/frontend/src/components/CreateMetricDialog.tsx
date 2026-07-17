import { FormEvent, useId, useState } from "react";

import type {
  CreateFeedMetricRequest,
  FeedMetric,
  MetricAggregation,
  PatchFeedMetricRequest,
  SystemMetricKey,
} from "../types";
import { CreateWizardDialog, CreateWizardStep } from "./CreateWizardDialog";
import {
  aggregationLabel,
  aggregationsForMetricKey,
  defaultAggregationForMetricKey,
  defaultMetricDisplayName,
  systemMetricOptionEntries,
} from "./metricLabels";

type MetricKind = "system" | "judged";
type MetricStep = "kind" | "metric" | "name" | "prompt" | "aggregation";

type CreateMetricDialogProps = {
  feedName: string;
  saving: boolean;
  submissionError: string;
  onClose: () => void;
  onCreate: (payload: CreateFeedMetricRequest) => void;
};

export function CreateMetricDialog({ feedName, saving, submissionError, onClose, onCreate }: CreateMetricDialogProps) {
  return (
    <MetricWizardDialog
      feedName={feedName}
      mode="create"
      saving={saving}
      submissionError={submissionError}
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}

type EditMetricDialogProps = {
  feedName: string;
  metric: FeedMetric;
  saving: boolean;
  submissionError: string;
  onClose: () => void;
  onUpdate: (payload: PatchFeedMetricRequest) => void;
};

export function EditMetricDialog({
  feedName,
  metric,
  saving,
  submissionError,
  onClose,
  onUpdate,
}: EditMetricDialogProps) {
  return (
    <MetricWizardDialog
      feedName={feedName}
      metric={metric}
      mode="edit"
      saving={saving}
      submissionError={submissionError}
      onClose={onClose}
      onUpdate={onUpdate}
    />
  );
}

type MetricWizardDialogProps = {
  feedName: string;
  saving: boolean;
  submissionError: string;
  onClose: () => void;
} & (
  | {
      mode: "create";
      onCreate: (payload: CreateFeedMetricRequest) => void;
    }
  | {
      metric: FeedMetric;
      mode: "edit";
      onUpdate: (payload: PatchFeedMetricRequest) => void;
    }
);

function MetricWizardDialog(props: MetricWizardDialogProps) {
  const { feedName, saving, submissionError, onClose } = props;
  const initialMetric = props.mode === "edit" ? props.metric : null;
  const initialKind: MetricKind | null =
    initialMetric === null ? null : initialMetric.system_key === "judged" ? "judged" : "system";
  const initialSystemKey: SystemMetricKey | null =
    initialMetric !== null && initialMetric.system_key !== "judged" ? initialMetric.system_key : null;
  const initialSteps = metricSteps(initialKind, initialSystemKey);
  const stepLabelId = useId();
  const [kind, setKind] = useState<MetricKind | null>(initialKind);
  const [systemKey, setSystemKey] = useState<SystemMetricKey | null>(initialSystemKey);
  const [systemDisplayName, setSystemDisplayName] = useState(
    initialMetric !== null && initialMetric.system_key !== "judged" ? initialMetric.display_name : "",
  );
  const [judgedDisplayName, setJudgedDisplayName] = useState(
    initialMetric?.system_key === "judged" ? initialMetric.display_name : "",
  );
  const [systemAggregation, setSystemAggregation] = useState<MetricAggregation>(
    initialMetric !== null && initialMetric.system_key !== "judged"
      ? initialMetric.aggregation
      : defaultAggregationForMetricKey("post_count"),
  );
  const [judgedAggregation, setJudgedAggregation] = useState<MetricAggregation>(
    initialMetric?.system_key === "judged" ? initialMetric.aggregation : defaultAggregationForMetricKey("judged"),
  );
  const [judgmentPrompt, setJudgmentPrompt] = useState(initialMetric?.judgment_prompt ?? "");
  const [currentStep, setCurrentStep] = useState<MetricStep>("kind");
  const [revealedSteps, setRevealedSteps] = useState<MetricStep[]>(props.mode === "edit" ? initialSteps : ["kind"]);
  const [validationError, setValidationError] = useState("");

  const steps = metricSteps(kind, systemKey);
  const currentStepIndex = steps.indexOf(currentStep);
  const visibleSteps = steps.filter((step) => revealedSteps.includes(step));
  const displayName = kind === "judged" ? judgedDisplayName : systemDisplayName;
  const aggregation = kind === "judged" ? judgedAggregation : systemAggregation;
  const allowedAggregations =
    kind === "judged"
      ? aggregationsForMetricKey("judged")
      : systemKey === null
        ? []
        : aggregationsForMetricKey(systemKey);
  const fixedAggregation = allowedAggregations.length === 1 ? (allowedAggregations[0] ?? null) : null;
  const finalStep = currentStepIndex === steps.length - 1;

  function chooseKind(nextKind: MetricKind) {
    setValidationError("");
    setCurrentStep("kind");
    if (nextKind !== kind) {
      setKind(nextKind);
      setRevealedSteps(["kind"]);
    }
  }

  function chooseSystemKey(nextKey: SystemMetricKey) {
    const previousDefault = systemKey === null ? "" : defaultMetricDisplayName(systemKey);
    setSystemKey(nextKey);
    setSystemAggregation(defaultAggregationForMetricKey(nextKey));
    if (systemDisplayName === "" || systemDisplayName === previousDefault) {
      setSystemDisplayName(defaultMetricDisplayName(nextKey));
    }
    setValidationError("");
    setCurrentStep("metric");
    setRevealedSteps(["kind", "metric"]);
  }

  function activateStep(step: MetricStep) {
    if (saving || step === currentStep) {
      return;
    }
    setValidationError("");
    setCurrentStep(step);
  }

  function revealStep(step: MetricStep) {
    setRevealedSteps((current) => (current.includes(step) ? current : [...current, step]));
    setCurrentStep(step);
    setValidationError("");
  }

  function handleBack() {
    if (currentStepIndex <= 0 || saving) {
      return;
    }
    const previousStep = steps[currentStepIndex - 1];
    if (previousStep !== undefined) {
      revealStep(previousStep);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateStep(currentStep, kind, systemKey, displayName, judgmentPrompt);
    if (error !== "") {
      setValidationError(error);
      return;
    }

    if (!finalStep) {
      const nextStep = steps[currentStepIndex + 1];
      if (nextStep !== undefined) {
        revealStep(nextStep);
      }
      return;
    }

    for (const step of steps) {
      const draftError = validateStep(step, kind, systemKey, displayName, judgmentPrompt);
      if (draftError !== "") {
        setCurrentStep(step);
        setValidationError(draftError);
        return;
      }
    }

    const metricKey = kind === "judged" ? "judged" : systemKey;
    if (metricKey === null) {
      return;
    }
    if (props.mode === "edit") {
      props.onUpdate({
        display_name: displayName.trim(),
        aggregation,
        ...(metricKey === "judged" ? { judgment_prompt: judgmentPrompt.trim() } : {}),
      });
      return;
    }

    props.onCreate({
      system_key: metricKey,
      display_name: displayName.trim(),
      aggregation,
      ...(metricKey === "judged" ? { judgment_prompt: judgmentPrompt.trim() } : {}),
    });
  }

  function stepError(step: MetricStep) {
    return currentStep === step && validationError !== "" ? (
      <div className="form-error create-wizard-step-error" role="alert">
        {validationError}
      </div>
    ) : null;
  }

  return (
    <CreateWizardDialog
      actionLabel={props.mode === "edit" ? "Save metric" : "Add metric"}
      busy={saving}
      busyLabel={props.mode === "edit" ? "Saving..." : "Adding..."}
      context={feedName}
      currentStep={currentStep}
      currentStepIndex={currentStepIndex}
      error={submissionError}
      stepCount={steps.length}
      title={props.mode === "edit" ? "Edit metric" : "Add metric"}
      onBack={handleBack}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {visibleSteps.includes("kind") ? (
        <CreateWizardStep
          current={currentStep === "kind"}
          labelId={`${stepLabelId}-kind`}
          number={steps.indexOf("kind") + 1}
          step="kind"
          title="Scoring method"
          onActivate={activateStep}
        >
          <div aria-labelledby={`${stepLabelId}-kind`} className="create-wizard-choice-control" role="group">
            <button
              aria-pressed={kind === "system"}
              className="create-wizard-choice-option"
              disabled={saving || props.mode === "edit"}
              type="button"
              onClick={() => chooseKind("system")}
            >
              Calculated
            </button>
            <button
              aria-pressed={kind === "judged"}
              className="create-wizard-choice-option"
              disabled={saving || props.mode === "edit"}
              type="button"
              onClick={() => chooseKind("judged")}
            >
              Judged
            </button>
          </div>
          {kind !== null ? (
            <div className="field-hint">
              {props.mode === "edit"
                ? "The scoring method cannot be changed after creation."
                : kind === "system"
                  ? "Calculated from feed activity."
                  : "Scored by group owners and admins."}
            </div>
          ) : null}
          {stepError("kind")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("metric") ? (
        <CreateWizardStep
          current={currentStep === "metric"}
          labelId={`${stepLabelId}-metric`}
          number={steps.indexOf("metric") + 1}
          step="metric"
          title="Calculation"
          onActivate={activateStep}
        >
          <select
            aria-label="Calculation"
            disabled={saving || props.mode === "edit"}
            value={systemKey ?? ""}
            onChange={(event) => chooseSystemKey(event.target.value as SystemMetricKey)}
          >
            <option disabled value="">
              Select calculation
            </option>
            {systemMetricOptionEntries().map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          {systemKey !== null && fixedAggregation !== null ? (
            <div className="metric-create-fixed-value">
              Combine values by <strong>{aggregationLabel(fixedAggregation)}</strong>
            </div>
          ) : null}
          {props.mode === "edit" ? (
            <div className="field-hint">The calculation cannot be changed after creation.</div>
          ) : null}
          {stepError("metric")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("name") ? (
        <CreateWizardStep
          current={currentStep === "name"}
          labelId={`${stepLabelId}-name`}
          number={steps.indexOf("name") + 1}
          step="name"
          title="Metric name"
          onActivate={activateStep}
        >
          <input
            aria-label="Metric name"
            disabled={saving}
            value={displayName}
            onChange={(event) => {
              if (kind === "judged") {
                setJudgedDisplayName(event.target.value);
              } else {
                setSystemDisplayName(event.target.value);
              }
              setValidationError("");
              activateStep("name");
            }}
          />
          {stepError("name")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("prompt") ? (
        <CreateWizardStep
          current={currentStep === "prompt"}
          labelId={`${stepLabelId}-prompt`}
          number={steps.indexOf("prompt") + 1}
          step="prompt"
          title="Judging prompt"
          onActivate={activateStep}
        >
          <textarea
            aria-label="Judging prompt"
            disabled={saving}
            value={judgmentPrompt}
            onChange={(event) => {
              setJudgmentPrompt(event.target.value);
              setValidationError("");
              activateStep("prompt");
            }}
          />
          {stepError("prompt")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("aggregation") ? (
        <CreateWizardStep
          current={currentStep === "aggregation"}
          labelId={`${stepLabelId}-aggregation`}
          number={steps.indexOf("aggregation") + 1}
          step="aggregation"
          title={kind === "judged" ? "Combine scores" : "Combine values"}
          onActivate={activateStep}
        >
          <select
            aria-label={kind === "judged" ? "Combine scores by" : "Combine values by"}
            disabled={saving}
            value={aggregation}
            onChange={(event) => {
              const nextAggregation = event.target.value as MetricAggregation;
              if (kind === "judged") {
                setJudgedAggregation(nextAggregation);
              } else {
                setSystemAggregation(nextAggregation);
              }
              setValidationError("");
              activateStep("aggregation");
            }}
          >
            {allowedAggregations.map((candidate) => (
              <option key={candidate} value={candidate}>
                {aggregationLabel(candidate)}
              </option>
            ))}
          </select>
          {stepError("aggregation")}
        </CreateWizardStep>
      ) : null}
    </CreateWizardDialog>
  );
}

function metricSteps(kind: MetricKind | null, systemKey: SystemMetricKey | null): MetricStep[] {
  if (kind === "judged") {
    return ["kind", "name", "prompt", "aggregation"];
  }
  if (kind === "system" && systemKey !== null && aggregationsForMetricKey(systemKey).length === 1) {
    return ["kind", "metric", "name"];
  }
  return ["kind", "metric", "name", "aggregation"];
}

function validateStep(
  step: MetricStep,
  kind: MetricKind | null,
  systemKey: SystemMetricKey | null,
  displayName: string,
  judgmentPrompt: string,
): string {
  if (step === "kind" && kind === null) {
    return "Choose a scoring method";
  }
  if (step === "metric" && systemKey === null) {
    return "Choose a calculation";
  }
  if (step === "name" && displayName.trim() === "") {
    return "Metric name is required";
  }
  if (step === "prompt" && judgmentPrompt.trim() === "") {
    return "Judging prompt is required";
  }
  return "";
}
