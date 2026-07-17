import { type FormEventHandler, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export type CreateWizardDialogProps = {
  actionLabel: string;
  busy: boolean;
  busyLabel: string;
  children: ReactNode;
  context: ReactNode;
  currentStep: string;
  currentStepIndex: number;
  error?: string;
  nextLabel?: string;
  stepCount: number;
  submitDisabled?: boolean;
  title: string;
  onBack?: () => void;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export function CreateWizardDialog({
  actionLabel,
  busy,
  busyLabel,
  children,
  context,
  currentStep,
  currentStepIndex,
  error = "",
  nextLabel = "Next",
  stepCount,
  submitDisabled = false,
  title,
  onBack,
  onClose,
  onSubmit,
}: CreateWizardDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return undefined;
    }
    dialog.showModal();
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const steps = dialogRef.current?.querySelectorAll<HTMLElement>("[data-create-wizard-step]");
      const activeStep = Array.from(steps ?? []).find((step) => step.dataset["createWizardStep"] === currentStep);
      activeStep?.scrollIntoView({ block: "nearest" });
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeStep !== undefined && activeStep.contains(activeElement)) {
        return;
      }
      activeStep
        ?.querySelector<HTMLElement>(
          "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
        )
        ?.focus();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [currentStep]);

  useEffect(() => {
    if (error === "") {
      return undefined;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(".create-wizard-submission-error")?.scrollIntoView({
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [error]);

  const finalStep = currentStepIndex === stepCount - 1;
  const dialog = (
    <dialog
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-panel create-wizard-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
    >
      <form className="create-wizard-form" onSubmit={onSubmit}>
        <header className="create-wizard-header">
          <div className="create-wizard-title-row">
            <h2 id={titleId}>{title}</h2>
            <button
              aria-label="Close"
              className="icon-button create-wizard-close-button"
              disabled={busy}
              type="button"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="create-wizard-context">
            <span>{context}</span>
            <span>
              Step {currentStepIndex + 1} of {stepCount}
            </span>
          </div>
        </header>

        <div className="create-wizard-body">
          {children}
          {error !== "" ? (
            <div className="form-error create-wizard-submission-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="create-wizard-footer">
          {currentStepIndex > 0 && onBack !== undefined ? (
            <button className="secondary create-wizard-footer-button" disabled={busy} type="button" onClick={onBack}>
              Back
            </button>
          ) : (
            <span />
          )}
          <button className="create-wizard-footer-button" disabled={busy || submitDisabled} type="submit">
            {busy ? busyLabel : finalStep ? actionLabel : nextLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );

  return createPortal(dialog, document.body);
}

export type CreateWizardStepProps<Step extends string> = {
  children: ReactNode;
  current: boolean;
  labelId: string;
  number: number;
  step: Step;
  title: string;
  onActivate: (step: Step) => void;
};

export function CreateWizardStep<Step extends string>({
  children,
  current,
  labelId,
  number,
  step,
  title,
  onActivate,
}: CreateWizardStepProps<Step>) {
  return (
    <section
      aria-current={current ? "step" : undefined}
      aria-labelledby={labelId}
      className={`create-wizard-step ${current ? "create-wizard-step-current" : "create-wizard-step-complete"}`}
      data-create-wizard-step={step}
      onFocusCapture={() => onActivate(step)}
    >
      <div className="create-wizard-step-heading" id={labelId}>
        <span aria-hidden="true">{number}</span>
        <span>{title}</span>
      </div>
      <div className="create-wizard-step-control">{children}</div>
    </section>
  );
}
