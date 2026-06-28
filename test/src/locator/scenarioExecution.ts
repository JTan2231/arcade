import type { Dialog } from "@playwright/test";

import { click, fill, selectOption, setChecked, visit, wait } from "../actions";
import {
  expectAlert,
  expectDisabled,
  expectEnabled,
  expectHidden,
  expectPressed,
  expectStatus,
  expectValue,
  expectVisible,
} from "../assertions";
import type { PrimitiveContext } from "../context";
import { initialVariables } from "../interpolation";
import { executeRequestPrimitive } from "../primitives/request";
import { executeSQLPrimitive } from "../primitives/sql";
import type {
  LoadedScenario,
  ScenarioPhase,
  ScenarioStep,
} from "../scenarioSchema";

export async function driveScenarioToState(
  context: PrimitiveContext,
  loaded: LoadedScenario,
  afterStep: number | undefined,
): Promise<{ beforeSteps: number; scenarioSteps: number }> {
  context.variables.clear();
  for (const [name, value] of initialVariables(loaded.scenario.vars)) {
    context.variables.set(name, value);
  }

  await runPhase(context, "before", loaded.scenario.before ?? []);

  const requestedStepCount = afterStep ?? loaded.scenario.steps.length;
  if (requestedStepCount < 0) {
    throw new Error("--after-step must be 0 or greater");
  }
  if (requestedStepCount > loaded.scenario.steps.length) {
    throw new Error(
      `--after-step ${requestedStepCount} is greater than the scenario's ${loaded.scenario.steps.length} steps`,
    );
  }

  await runPhase(
    context,
    "steps",
    loaded.scenario.steps.slice(0, requestedStepCount),
  );
  return {
    beforeSteps: loaded.scenario.before?.length ?? 0,
    scenarioSteps: requestedStepCount,
  };
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
      throw new Error(
        `${phase} step ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
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
  } else if (step.sql !== undefined) {
    await executeSQLPrimitive(context, step);
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
