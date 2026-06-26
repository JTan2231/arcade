import { expect, type Page } from "@playwright/test";

import { scope, strictRoleLocator } from "./actions";
import type {
  ScenarioStep,
  TextExpectation,
  VisibleTarget,
} from "./scenarioSchema";
import { scenarioValue } from "./values";

export async function expectVisible(
  page: Page,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectVisible === undefined) {
    throw new Error("expectVisible assertion is missing");
  }

  await expectTargetVisible(page, step.within, step.expectVisible);
}

export async function expectHidden(
  page: Page,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectHidden === undefined) {
    throw new Error("expectHidden assertion is missing");
  }

  const root = scope(page, step.within);
  const target = step.expectHidden;
  if ("text" in target) {
    await expect(
      root.getByText(target.text, { exact: target.exact ?? false }),
    ).toBeHidden();
    return;
  }

  await expect(
    root.getByRole(target.role, {
      name: target.name,
      exact: target.exact ?? true,
    }),
  ).toBeHidden();
}

export async function expectPressed(
  page: Page,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectPressed === undefined) {
    throw new Error("expectPressed assertion is missing");
  }

  const locator = await strictRoleLocator(
    scope(page, step.within),
    step.expectPressed,
  );
  await expect(locator).toHaveAttribute(
    "aria-pressed",
    String(step.expectPressed.pressed),
  );
}

export async function expectDisabled(
  page: Page,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectDisabled === undefined) {
    throw new Error("expectDisabled assertion is missing");
  }

  await expectControlState(page, step.within, step.expectDisabled, false);
}

export async function expectEnabled(
  page: Page,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectEnabled === undefined) {
    throw new Error("expectEnabled assertion is missing");
  }

  await expectControlState(page, step.within, step.expectEnabled, true);
}

export async function expectValue(
  page: Page,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectValue === undefined) {
    throw new Error("expectValue assertion is missing");
  }

  const locator = scope(page, step.within).getByLabel(step.expectValue.label, {
    exact: step.expectValue.exact ?? true,
  });
  await expect(locator.first()).toBeVisible();
  await expect(locator).toHaveValue(scenarioValue(step.expectValue.value));
}

export async function expectStatus(
  page: Page,
  expectation: TextExpectation,
): Promise<void> {
  const status = page.getByRole("status");
  if (expectation.exact === true) {
    await expect(status).toHaveText(expectation.text);
    return;
  }
  await expect(status).toContainText(expectation.text);
}

export async function expectAlert(
  page: Page,
  expectation: TextExpectation,
): Promise<void> {
  const alert = page
    .getByRole("alert")
    .filter({ hasText: expectation.text })
    .first();
  await expect(alert).toBeVisible();
  if (expectation.exact === true) {
    await expect(alert).toHaveText(expectation.text);
  }
}

async function expectControlState(
  page: Page,
  within: string | undefined,
  target: VisibleTarget,
  enabled: boolean,
): Promise<void> {
  if ("text" in target) {
    throw new Error("control state assertions require a role target");
  }

  const locator = await strictRoleLocator(scope(page, within), target);
  if (enabled) {
    await expect(locator).toBeEnabled();
    return;
  }
  await expect(locator).toBeDisabled();
}

async function expectTargetVisible(
  page: Page,
  within: string | undefined,
  target: VisibleTarget,
): Promise<void> {
  const root = scope(page, within);
  if ("text" in target) {
    await expect(
      root.getByText(target.text, { exact: target.exact ?? false }).first(),
    ).toBeVisible();
    return;
  }

  await strictRoleLocator(root, target);
}
