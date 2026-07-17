import { FormEvent, useId, useState } from "react";

import type { CreateGroupInviteLinkRequest } from "../../types";
import { CreateWizardDialog, CreateWizardStep } from "../CreateWizardDialog";

const DAY_MS = 24 * 60 * 60 * 1000;

type InviteLinkStep = "label" | "expiration" | "uses" | "review";
type UseLimit = "unlimited" | "limited";

const inviteLinkSteps: InviteLinkStep[] = ["label", "expiration", "uses", "review"];

export function CreateInviteLinkDialog({
  groupName,
  saving,
  submissionError,
  onClose,
  onCreate,
}: {
  groupName: string;
  saving: boolean;
  submissionError: string;
  onClose: () => void;
  onCreate: (payload: CreateGroupInviteLinkRequest) => void;
}) {
  const stepLabelId = useId();
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [useLimit, setUseLimit] = useState<UseLimit>("unlimited");
  const [maxUses, setMaxUses] = useState("");
  const [currentStep, setCurrentStep] = useState<InviteLinkStep>("label");
  const [revealedSteps, setRevealedSteps] = useState<InviteLinkStep[]>(["label"]);
  const [validationError, setValidationError] = useState("");
  const currentStepIndex = inviteLinkSteps.indexOf(currentStep);
  const visibleSteps = inviteLinkSteps.filter((step) => revealedSteps.includes(step));

  function activateStep(step: InviteLinkStep) {
    if (saving || step === currentStep) {
      return;
    }
    setValidationError("");
    setCurrentStep(step);
  }

  function revealStep(step: InviteLinkStep) {
    setRevealedSteps((current) => (current.includes(step) ? current : [...current, step]));
    setCurrentStep(step);
    setValidationError("");
  }

  function handleBack() {
    const previousStep = inviteLinkSteps[currentStepIndex - 1];
    if (!saving && previousStep !== undefined) {
      revealStep(previousStep);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateStep(currentStep, expiresInDays, useLimit, maxUses);
    if (error !== "") {
      setValidationError(error);
      return;
    }

    const nextStep = inviteLinkSteps[currentStepIndex + 1];
    if (nextStep !== undefined) {
      revealStep(nextStep);
      return;
    }

    const payload: CreateGroupInviteLinkRequest = {
      expires_at: new Date(Date.now() + Number.parseInt(expiresInDays, 10) * DAY_MS).toISOString(),
    };
    const trimmedLabel = label.trim();
    if (trimmedLabel !== "") {
      payload.label = trimmedLabel;
    }
    if (useLimit === "limited") {
      payload.max_uses = Number.parseInt(maxUses, 10);
    }
    onCreate(payload);
  }

  function stepError(step: InviteLinkStep) {
    return currentStep === step && validationError !== "" ? (
      <div className="form-error create-wizard-step-error" role="alert">
        {validationError}
      </div>
    ) : null;
  }

  return (
    <CreateWizardDialog
      actionLabel="Create link"
      busy={saving}
      busyLabel="Creating..."
      context={groupName}
      currentStep={currentStep}
      currentStepIndex={currentStepIndex}
      error={submissionError}
      stepCount={inviteLinkSteps.length}
      title="Create invite link"
      {...(currentStepIndex > 0 ? { onBack: handleBack } : {})}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {visibleSteps.includes("label") ? (
        <CreateWizardStep
          current={currentStep === "label"}
          labelId={`${stepLabelId}-label`}
          number={inviteLinkSteps.indexOf("label") + 1}
          step="label"
          title="Link label"
          onActivate={activateStep}
        >
          <input
            aria-label="Link label"
            disabled={saving}
            maxLength={120}
            placeholder="Summer cohort"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setValidationError("");
            }}
          />
          <div className="field-hint">Optional. Use a label to remember who this link is for.</div>
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("expiration") ? (
        <CreateWizardStep
          current={currentStep === "expiration"}
          labelId={`${stepLabelId}-expiration`}
          number={inviteLinkSteps.indexOf("expiration") + 1}
          step="expiration"
          title="Expiration"
          onActivate={activateStep}
        >
          <select
            aria-label="Expires after"
            disabled={saving}
            value={expiresInDays}
            onChange={(event) => {
              setExpiresInDays(event.target.value);
              setValidationError("");
            }}
          >
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
          {stepError("expiration")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("uses") ? (
        <CreateWizardStep
          current={currentStep === "uses"}
          labelId={`${stepLabelId}-uses`}
          number={inviteLinkSteps.indexOf("uses") + 1}
          step="uses"
          title="Usage limit"
          onActivate={activateStep}
        >
          <div aria-labelledby={`${stepLabelId}-uses`} className="create-wizard-choice-control" role="group">
            <button
              aria-pressed={useLimit === "unlimited"}
              className="create-wizard-choice-option"
              disabled={saving}
              type="button"
              onClick={() => {
                setUseLimit("unlimited");
                setValidationError("");
              }}
            >
              Unlimited
            </button>
            <button
              aria-pressed={useLimit === "limited"}
              className="create-wizard-choice-option"
              disabled={saving}
              type="button"
              onClick={() => {
                setUseLimit("limited");
                setValidationError("");
              }}
            >
              Limited
            </button>
          </div>
          {useLimit === "limited" ? (
            <label>
              Maximum uses
              <input
                disabled={saving}
                inputMode="numeric"
                min="1"
                type="number"
                value={maxUses}
                onChange={(event) => {
                  setMaxUses(event.target.value);
                  setValidationError("");
                }}
              />
            </label>
          ) : null}
          {stepError("uses")}
        </CreateWizardStep>
      ) : null}

      {visibleSteps.includes("review") ? (
        <CreateWizardStep
          current={currentStep === "review"}
          labelId={`${stepLabelId}-review`}
          number={inviteLinkSteps.indexOf("review") + 1}
          step="review"
          title="Review"
          onActivate={activateStep}
        >
          <div className="preview-panel">
            <div className="title">{label.trim() || "Invite link"}</div>
            <div className="meta">
              Expires after {expirationLabel(expiresInDays)} · {usageLimitLabel(useLimit, maxUses)}
            </div>
          </div>
          <div className="field-hint">The shareable link is shown once creation succeeds.</div>
        </CreateWizardStep>
      ) : null}
    </CreateWizardDialog>
  );
}

function validateStep(step: InviteLinkStep, expiresInDays: string, useLimit: UseLimit, maxUses: string): string {
  if (step === "expiration" && !["1", "7", "30"].includes(expiresInDays)) {
    return "Choose an expiration";
  }
  if (step === "uses" && useLimit === "limited") {
    const parsedMaxUses = Number(maxUses);
    if (!Number.isInteger(parsedMaxUses) || parsedMaxUses < 1) {
      return "Maximum uses must be a positive whole number";
    }
  }
  return "";
}

function expirationLabel(days: string): string {
  return days === "1" ? "1 day" : `${days} days`;
}

function usageLimitLabel(useLimit: UseLimit, maxUses: string): string {
  return useLimit === "unlimited" ? "Unlimited uses" : `${maxUses} use${maxUses === "1" ? "" : "s"}`;
}
