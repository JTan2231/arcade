import { expect, type Locator, type Page } from "@playwright/test";

import { findLandmark } from "./landmarks";
import type { RoleTarget, ScenarioStep } from "./scenarioSchema";
import { scenarioValue } from "./values";

type LocatorRoot = Locator | Page;

export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

export async function click(page: Page, step: ScenarioStep): Promise<void> {
  if (step.click === undefined) {
    throw new Error("click action is missing");
  }

  const locator = await strictRoleLocator(scope(page, step.within), step.click);
  await locator.click();
}

export async function fill(page: Page, step: ScenarioStep): Promise<void> {
  if (step.fill === undefined) {
    throw new Error("fill action is missing");
  }

  const locator = scope(page, step.within).getByLabel(step.fill.label, {
    exact: step.fill.exact ?? true,
  });
  await expect(locator.first()).toBeVisible();
  await locator.fill(scenarioValue(step.fill.value));
}

export async function selectOption(
  page: Page,
  step: ScenarioStep,
): Promise<void> {
  if (step.select === undefined) {
    throw new Error("select action is missing");
  }

  const locator = scope(page, step.within).getByLabel(step.select.label, {
    exact: step.select.exact ?? true,
  });
  await expect(locator.first()).toBeVisible();
  if (step.select.option !== undefined) {
    await locator.selectOption({ label: scenarioValue(step.select.option) });
    return;
  }
  if (step.select.value !== undefined) {
    await locator.selectOption(scenarioValue(step.select.value));
    return;
  }
  throw new Error("select requires option or value");
}

export async function setChecked(
  page: Page,
  step: ScenarioStep,
  checked: boolean,
): Promise<void> {
  const checkStep = checked ? step.check : step.uncheck;
  if (checkStep === undefined) {
    throw new Error(`${checked ? "check" : "uncheck"} action is missing`);
  }

  const locator = scope(page, step.within).getByLabel(checkStep.label, {
    exact: checkStep.exact ?? true,
  });
  await expect(locator.first()).toBeVisible();
  if (checked) {
    await locator.check();
  } else {
    await locator.uncheck();
  }
}

export async function wait(page: Page, step: ScenarioStep): Promise<void> {
  if (step.wait === undefined) {
    throw new Error("wait action is missing");
  }

  if (typeof step.wait === "number") {
    await page.waitForTimeout(step.wait);
    return;
  }

  if (step.wait.milliseconds !== undefined) {
    await page.waitForTimeout(step.wait.milliseconds);
  }
  if (step.wait.text !== undefined) {
    await expect(
      scope(page, step.within)
        .getByText(step.wait.text, { exact: step.wait.exact ?? false })
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
): Promise<Locator> {
  const locator = root.getByRole(target.role, {
    name: target.name,
    exact: target.exact ?? true,
  });

  await expect(locator).toHaveCount(1);
  await expect(locator).toBeVisible();
  return locator;
}
