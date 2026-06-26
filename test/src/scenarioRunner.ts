import {
  chromium,
  firefox,
  webkit,
  type BrowserType,
  type Dialog,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { click, fill, selectOption, setChecked, visit, wait } from "./actions";
import {
  expectAlert,
  expectDisabled,
  expectEnabled,
  expectHidden,
  expectPressed,
  expectStatus,
  expectValue,
  expectVisible,
} from "./assertions";
import {
  createPrimitiveContext,
  disposePrimitiveContext,
  type PrimitiveContext,
} from "./context";
import { initialVariables } from "./interpolation";
import { NetworkController } from "./networkControls";
import { executeRequestPrimitive } from "./primitives/request";
import {
  formatStepSnippet,
  type LoadedScenario,
  type ScenarioPhase,
  type ScenarioStep,
} from "./scenarioSchema";

export type ScenarioRunOptions = {
  baseURL: string;
  project: string;
  artifactsDir: string;
  appLogPath?: string;
};

export type ScenarioRunResult = {
  name: string;
  project: string;
  stepCount: number;
};

export class ScenarioRunError extends Error {
  readonly scenarioName: string;
  readonly scenarioFile: string;
  readonly project: string;
  readonly stepCount: number;
  readonly failedPhase: ScenarioPhase;
  readonly failedStepIndex: number;
  readonly failedStepID?: string;
  readonly stepSnippet: string;
  readonly tracePath: string;
  readonly screenshotPath: string;
  readonly appLogPath?: string;

  constructor(
    message: string,
    details: {
      scenarioName: string;
      scenarioFile: string;
      project: string;
      stepCount: number;
      failedPhase: ScenarioPhase;
      failedStepIndex: number;
      failedStepID?: string;
      stepSnippet: string;
      tracePath: string;
      screenshotPath: string;
      appLogPath?: string;
    },
  ) {
    super(message);
    this.name = "ScenarioRunError";
    this.scenarioName = details.scenarioName;
    this.scenarioFile = details.scenarioFile;
    this.project = details.project;
    this.stepCount = details.stepCount;
    this.failedPhase = details.failedPhase;
    this.failedStepIndex = details.failedStepIndex;
    this.failedStepID = details.failedStepID;
    this.stepSnippet = details.stepSnippet;
    this.tracePath = details.tracePath;
    this.screenshotPath = details.screenshotPath;
    this.appLogPath = details.appLogPath;
  }
}

export async function runScenario(
  loaded: LoadedScenario,
  options: ScenarioRunOptions,
): Promise<ScenarioRunResult> {
  const browserType = browserTypeForProject(options.project);
  const browser = await browserType.launch();
  const scenarioArtifactDir = path.join(
    options.artifactsDir,
    sanitizeFilePart(loaded.scenario.name),
    sanitizeFilePart(options.project),
  );
  await mkdir(scenarioArtifactDir, { recursive: true });

  const context = await browser.newContext({
    baseURL: options.baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const network = new NetworkController();
  const runtime = await createPrimitiveContext({
    baseURL: options.baseURL,
    page,
    variables: initialVariables(loaded.scenario.vars),
    network,
  });
  let tracingStopped = false;
  let primaryError: ScenarioRunError | undefined;

  try {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    await network.attach(page);

    try {
      await runPhase(runtime, "before", loaded.scenario.before ?? []);
      await runPhase(runtime, "steps", loaded.scenario.steps);
    } catch (error) {
      primaryError = await captureScenarioError({
        error,
        loaded,
        project: options.project,
        page: runtime.page,
        tracing: context.tracing,
        tracingStopped,
        scenarioArtifactDir,
        appLogPath: options.appLogPath,
      });
      tracingStopped = true;
    }

    try {
      await runPhase(runtime, "after", loaded.scenario.after ?? []);
    } catch (error) {
      if (primaryError === undefined) {
        primaryError = await captureScenarioError({
          error,
          loaded,
          project: options.project,
          page: runtime.page,
          tracing: context.tracing,
          tracingStopped,
          scenarioArtifactDir,
          appLogPath: options.appLogPath,
        });
        tracingStopped = true;
      }
    }

    if (primaryError !== undefined) {
      throw primaryError;
    }

    return {
      name: loaded.scenario.name,
      project: options.project,
      stepCount: totalStepCount(loaded),
    };
  } finally {
    await disposePrimitiveContext(runtime);
    await network.cleanup();
    if (!tracingStopped) {
      await context.tracing.stop().catch(() => undefined);
    }
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function runPhase(
  context: PrimitiveContext,
  phase: ScenarioPhase,
  steps: ScenarioStep[],
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    try {
      await runStep(context, step);
    } catch (error) {
      throw new PhaseStepError(phase, index, step, error);
    }
  }
}

async function runStep(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  const dialogExpectation = step.acceptDialog;
  const dialogState =
    dialogExpectation === undefined
      ? undefined
      : armDialogAcceptance(
          context.page,
          dialogExpectation.message,
          dialogExpectation.exact,
        );

  try {
    await runWithOptionalTimeout(runStepOperation(context, step), step.timeout);

    if (dialogState !== undefined) {
      await dialogState.assertHandled();
    }
  } finally {
    dialogState?.dispose();
  }
}

async function runStepOperation(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.request !== undefined) {
    await executeRequestPrimitive(context, step);
  } else if (step.visit !== undefined) {
    await visit(context, step.visit);
  } else if (step.click !== undefined) {
    await click(context, step);
  } else if (step.fill !== undefined) {
    await fill(context, step);
  } else if (step.select !== undefined) {
    await selectOption(context, step);
  } else if (step.check !== undefined) {
    await setChecked(context, step, true);
  } else if (step.uncheck !== undefined) {
    await setChecked(context, step, false);
  } else if (step.expectVisible !== undefined) {
    await expectVisible(context, step);
  } else if (step.expectHidden !== undefined) {
    await expectHidden(context, step);
  } else if (step.expectPressed !== undefined) {
    await expectPressed(context, step);
  } else if (step.expectDisabled !== undefined) {
    await expectDisabled(context, step);
  } else if (step.expectEnabled !== undefined) {
    await expectEnabled(context, step);
  } else if (step.expectValue !== undefined) {
    await expectValue(context, step);
  } else if (step.expectStatus !== undefined) {
    await expectStatus(context, step.expectStatus);
  } else if (step.expectAlert !== undefined) {
    await expectAlert(context, step.expectAlert);
  } else if (step.wait !== undefined) {
    await wait(context, step);
  } else if (step.holdRequest !== undefined) {
    context.network.holdRequest(step, context.variables);
  } else if (step.releaseRequest !== undefined) {
    await context.network.releaseRequest(step);
  } else if (step.fulfillRequest !== undefined) {
    context.network.fulfillRequest(step, context.variables);
  } else if (step.failRequest !== undefined) {
    context.network.failRequest(step, context.variables);
  } else if (step.expectRequest !== undefined) {
    await context.network.expectRequest(step, context.variables);
  } else {
    throw new Error("scenario step has no primitive operation");
  }
}

async function runWithOptionalTimeout(
  operation: Promise<void>,
  timeout: number | undefined,
): Promise<void> {
  if (timeout === undefined) {
    await operation;
    return;
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`step timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function armDialogAcceptance(
  page: PrimitiveContext["page"],
  expectedMessage: string | undefined,
  exact: boolean | undefined,
) {
  let handled = false;
  let failed: Error | null = null;

  const handler = (dialog: Dialog) => {
    handled = true;
    const actual = dialog.message();
    if (expectedMessage !== undefined) {
      const matches =
        exact === true
          ? actual === expectedMessage
          : actual.includes(expectedMessage);
      if (!matches) {
        failed = new Error(
          `dialog message "${actual}" did not match "${expectedMessage}"`,
        );
      }
    }
    void dialog.accept();
  };

  page.once("dialog", handler);

  return {
    async assertHandled() {
      await page.waitForTimeout(250);
      if (failed !== null) {
        throw failed;
      }
      if (!handled) {
        throw new Error("expected a browser dialog, but none opened");
      }
    },
    dispose() {
      page.off("dialog", handler);
    },
  };
}

class PhaseStepError extends Error {
  readonly phase: ScenarioPhase;
  readonly index: number;
  readonly step: ScenarioStep;
  readonly cause: unknown;

  constructor(
    phase: ScenarioPhase,
    index: number,
    step: ScenarioStep,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PhaseStepError";
    this.phase = phase;
    this.index = index;
    this.step = step;
    this.cause = cause;
  }
}

async function captureScenarioError(options: {
  error: unknown;
  loaded: LoadedScenario;
  project: string;
  page: PrimitiveContext["page"];
  tracing: Awaited<ReturnType<PrimitiveContext["page"]["context"]>>["tracing"];
  tracingStopped: boolean;
  scenarioArtifactDir: string;
  appLogPath?: string;
}): Promise<ScenarioRunError> {
  const phaseError =
    options.error instanceof PhaseStepError ? options.error : undefined;
  const phase = phaseError?.phase ?? "steps";
  const index = phaseError?.index ?? 0;
  const step = phaseError?.step ?? options.loaded.scenario.steps[0];
  const screenshotPath = path.join(
    options.scenarioArtifactDir,
    `${phase}-step-${index + 1}-failure.png`,
  );
  const tracePath = path.join(
    options.scenarioArtifactDir,
    `${phase}-step-${index + 1}-trace.zip`,
  );

  await options.page
    .screenshot({ path: screenshotPath, fullPage: true })
    .catch(() => undefined);
  if (!options.tracingStopped) {
    await options.tracing.stop({ path: tracePath }).catch(() => undefined);
  }

  return new ScenarioRunError(errorMessage(options.error), {
    scenarioName: options.loaded.scenario.name,
    scenarioFile: options.loaded.file,
    project: options.project,
    stepCount: totalStepCount(options.loaded),
    failedPhase: phase,
    failedStepIndex: index,
    failedStepID: step.id,
    stepSnippet: formatStepSnippet(step),
    tracePath,
    screenshotPath,
    appLogPath: options.appLogPath,
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof PhaseStepError) {
    return errorMessage(error.cause);
  }
  return error instanceof Error ? error.message : String(error);
}

function totalStepCount(loaded: LoadedScenario): number {
  return (
    (loaded.scenario.before?.length ?? 0) +
    loaded.scenario.steps.length +
    (loaded.scenario.after?.length ?? 0)
  );
}

function browserTypeForProject(project: string): BrowserType {
  switch (project) {
    case "chromium":
      return chromium;
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    default:
      throw new Error(`unsupported browser project: ${project}`);
  }
}

function sanitizeFilePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
