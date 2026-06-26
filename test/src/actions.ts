import { expect, type Locator, type Page } from "@playwright/test";

import type { PrimitiveContext } from "./context";
import { findLandmark } from "./landmarks";
import type { RoleTarget, ScenarioStep } from "./scenarioSchema";
import { scenarioValue } from "./values";

type LocatorRoot = Locator | Page;

export async function visit(
  context: PrimitiveContext,
  path: string,
): Promise<void> {
  await context.page.goto(scenarioValue(path, context.variables), {
    waitUntil: "domcontentloaded",
  });
}

export async function click(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.click === undefined) {
    throw new Error("click action is missing");
  }

  const locator = await strictRoleLocator(
    scope(context.page, step.within),
    step.click,
    context,
  );
  await locator.click();
}

export async function fill(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.fill === undefined) {
    throw new Error("fill action is missing");
  }

  const locator = scope(context.page, step.within).getByLabel(
    scenarioValue(step.fill.label, context.variables),
    {
      exact: step.fill.exact ?? true,
    },
  );
  await expect(locator.first()).toBeVisible();
  await locator.fill(scenarioValue(step.fill.value, context.variables));
}

export async function selectOption(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.select === undefined) {
    throw new Error("select action is missing");
  }

  const locator = scope(context.page, step.within).getByLabel(
    scenarioValue(step.select.label, context.variables),
    {
      exact: step.select.exact ?? true,
    },
  );
  await expect(locator.first()).toBeVisible();
  if (step.select.option !== undefined) {
    await locator.selectOption({
      label: scenarioValue(step.select.option, context.variables),
    });
    return;
  }
  if (step.select.value !== undefined) {
    await locator.selectOption(
      scenarioValue(step.select.value, context.variables),
    );
    return;
  }
  throw new Error("select requires option or value");
}

export async function setChecked(
  context: PrimitiveContext,
  step: ScenarioStep,
  checked: boolean,
): Promise<void> {
  const checkStep = checked ? step.check : step.uncheck;
  if (checkStep === undefined) {
    throw new Error(`${checked ? "check" : "uncheck"} action is missing`);
  }

  const locator = scope(context.page, step.within).getByLabel(
    scenarioValue(checkStep.label, context.variables),
    {
      exact: checkStep.exact ?? true,
    },
  );
  await expect(locator.first()).toBeVisible();
  if (checked) {
    await locator.check();
  } else {
    await locator.uncheck();
  }
}

export async function wait(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.wait === undefined) {
    throw new Error("wait action is missing");
  }

  if (typeof step.wait === "number") {
    await context.page.waitForTimeout(step.wait);
    return;
  }

  if (step.wait.milliseconds !== undefined) {
    await context.page.waitForTimeout(step.wait.milliseconds);
  }
  if (step.wait.text !== undefined) {
    await expect(
      scope(context.page, step.within)
        .getByText(scenarioValue(step.wait.text, context.variables), {
          exact: step.wait.exact ?? false,
        })
        .first(),
    ).toBeVisible();
  }
}

export function scope(page: Page, within: string | undefined): LocatorRoot {
  return within === undefined ? page : findLandmark(page, within);
}

export async function strictRoleLocator(
  root: LocatorRoot,
  target: RoleTarget,
  context: PrimitiveContext,
): Promise<Locator> {
  const locator = root.getByRole(target.role, {
    name: scenarioValue(target.name, context.variables),
    exact: target.exact ?? true,
  });

  await expect(locator).toHaveCount(1);
  await expect(locator).toBeVisible();
  return locator;
}
