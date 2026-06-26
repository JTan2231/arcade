import {
  chromium,
  firefox,
  webkit,
  type BrowserType,
  type Dialog,
  type Page,
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
import { applyScenarioSetup } from "./fixtures";
import { NetworkController } from "./networkControls";
import {
  formatStepSnippet,
  type LoadedScenario,
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
  readonly project: string;
  readonly stepCount: number;
  readonly failedStepIndex: number;
  readonly stepSnippet: string;
  readonly tracePath: string;
  readonly screenshotPath: string;
  readonly appLogPath?: string;

  constructor(
    message: string,
    details: {
      scenarioName: string;
      project: string;
      stepCount: number;
      failedStepIndex: number;
      stepSnippet: string;
      tracePath: string;
      screenshotPath: string;
      appLogPath?: string;
    },
  ) {
    super(message);
    this.name = "ScenarioRunError";
    this.scenarioName = details.scenarioName;
    this.project = details.project;
    this.stepCount = details.stepCount;
    this.failedStepIndex = details.failedStepIndex;
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
  let tracingStopped = false;

  try {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    await network.attach(page);
    await applyScenarioSetup(page, loaded.scenario.setup, options.baseURL);

    for (const [index, step] of loaded.scenario.steps.entries()) {
      try {
        await runStep(page, network, step);
      } catch (error) {
        const screenshotPath = path.join(
          scenarioArtifactDir,
          `step-${index + 1}-failure.png`,
        );
        const tracePath = path.join(
          scenarioArtifactDir,
          `step-${index + 1}-trace.zip`,
        );
        await page
          .screenshot({ path: screenshotPath, fullPage: true })
          .catch(() => undefined);
        await context.tracing.stop({ path: tracePath }).catch(() => undefined);
        tracingStopped = true;
        throw new ScenarioRunError(
          error instanceof Error ? error.message : String(error),
          {
            scenarioName: loaded.scenario.name,
            project: options.project,
            stepCount: loaded.scenario.steps.length,
            failedStepIndex: index,
            stepSnippet: formatStepSnippet(step),
            tracePath,
            screenshotPath,
            appLogPath: options.appLogPath,
          },
        );
      }
    }

    return {
      name: loaded.scenario.name,
      project: options.project,
      stepCount: loaded.scenario.steps.length,
    };
  } finally {
    await network.cleanup();
    if (!tracingStopped) {
      await context.tracing.stop().catch(() => undefined);
    }
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function runStep(
  page: Page,
  network: NetworkController,
  step: ScenarioStep,
): Promise<void> {
  const dialogExpectation = step.acceptDialog;
  const dialogState =
    dialogExpectation === undefined
      ? undefined
      : armDialogAcceptance(
          page,
          dialogExpectation.message,
          dialogExpectation.exact,
        );

  try {
    if (step.visit !== undefined) {
      await visit(page, step.visit);
    } else if (step.click !== undefined) {
      await click(page, step);
    } else if (step.fill !== undefined) {
      await fill(page, step);
    } else if (step.select !== undefined) {
      await selectOption(page, step);
    } else if (step.check !== undefined) {
      await setChecked(page, step, true);
    } else if (step.uncheck !== undefined) {
      await setChecked(page, step, false);
    } else if (step.expectVisible !== undefined) {
      await expectVisible(page, step);
    } else if (step.expectHidden !== undefined) {
      await expectHidden(page, step);
    } else if (step.expectPressed !== undefined) {
      await expectPressed(page, step);
    } else if (step.expectDisabled !== undefined) {
      await expectDisabled(page, step);
    } else if (step.expectEnabled !== undefined) {
      await expectEnabled(page, step);
    } else if (step.expectValue !== undefined) {
      await expectValue(page, step);
    } else if (step.expectStatus !== undefined) {
      await expectStatus(page, step.expectStatus);
    } else if (step.expectAlert !== undefined) {
      await expectAlert(page, step.expectAlert);
    } else if (step.wait !== undefined) {
      await wait(page, step);
    } else if (step.holdRequest !== undefined) {
      network.holdRequest(step);
    } else if (step.releaseRequest !== undefined) {
      await network.releaseRequest(step);
    } else if (step.fulfillRequest !== undefined) {
      network.fulfillRequest(step);
    } else if (step.failRequest !== undefined) {
      network.failRequest(step);
    } else if (step.expectRequest !== undefined) {
      await network.expectRequest(step);
    } else {
      throw new Error("scenario step has no action");
    }

    if (dialogState !== undefined) {
      await dialogState.assertHandled();
    }
  } finally {
    dialogState?.dispose();
  }
}

function armDialogAcceptance(
  page: Page,
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
