import { expect, type Page } from "@playwright/test";

import { scope, strictRoleLocator } from "./actions";
import type { PrimitiveContext } from "./context";
import type {
  ScenarioStep,
  TextExpectation,
  VisibleTarget,
} from "./scenarioSchema";
import { scenarioValue } from "./values";

export async function expectVisible(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectVisible === undefined) {
    throw new Error("expectVisible assertion is missing");
  }

  await expectTargetVisible(context, step.within, step.expectVisible);
}

export async function expectHidden(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectHidden === undefined) {
    throw new Error("expectHidden assertion is missing");
  }

  const root = scope(context.page, step.within);
  const target = step.expectHidden;
  if ("text" in target) {
    await expect(
      root.getByText(scenarioValue(target.text, context.variables), {
        exact: target.exact ?? false,
      }),
    ).toBeHidden();
    return;
  }

  await expect(
    root.getByRole(target.role, {
      name: scenarioValue(target.name, context.variables),
      exact: target.exact ?? true,
    }),
  ).toBeHidden();
}

export async function expectPressed(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectPressed === undefined) {
    throw new Error("expectPressed assertion is missing");
  }

  const locator = await strictRoleLocator(
    scope(context.page, step.within),
    step.expectPressed,
    context,
  );
  await expect(locator).toHaveAttribute(
    "aria-pressed",
    String(step.expectPressed.pressed),
  );
}

export async function expectDisabled(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectDisabled === undefined) {
    throw new Error("expectDisabled assertion is missing");
  }

  await expectControlState(context, step.within, step.expectDisabled, false);
}

export async function expectEnabled(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectEnabled === undefined) {
    throw new Error("expectEnabled assertion is missing");
  }

  await expectControlState(context, step.within, step.expectEnabled, true);
}

export async function expectValue(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.expectValue === undefined) {
    throw new Error("expectValue assertion is missing");
  }

  const locator = scope(context.page, step.within).getByLabel(
    scenarioValue(step.expectValue.label, context.variables),
    {
      exact: step.expectValue.exact ?? true,
    },
  );
  await expect(locator.first()).toBeVisible();
  await expect(locator).toHaveValue(
    scenarioValue(step.expectValue.value, context.variables),
  );
}

export async function expectStatus(
  context: PrimitiveContext,
  expectation: TextExpectation,
): Promise<void> {
  const status = context.page.getByRole("status");
  const text = scenarioValue(expectation.text, context.variables);
  if (expectation.exact === true) {
    await expect(status).toHaveText(text);
    return;
  }
  await expect(status).toContainText(text);
}

export async function expectAlert(
  context: PrimitiveContext,
  expectation: TextExpectation,
): Promise<void> {
  const text = scenarioValue(expectation.text, context.variables);
  const alert = context.page
    .getByRole("alert")
    .filter({ hasText: text })
    .first();
  await expect(alert).toBeVisible();
  if (expectation.exact === true) {
    await expect(alert).toHaveText(text);
  }
}

async function expectControlState(
  context: PrimitiveContext,
  within: string | undefined,
  target: VisibleTarget,
  enabled: boolean,
): Promise<void> {
  if ("text" in target) {
    throw new Error("control state assertions require a role target");
  }

  const locator = await strictRoleLocator(
    scope(context.page, within),
    target,
    context,
  );
  if (enabled) {
    await expect(locator).toBeEnabled();
    return;
  }
  await expect(locator).toBeDisabled();
}

async function expectTargetVisible(
  context: PrimitiveContext,
  within: string | undefined,
  target: VisibleTarget,
): Promise<void> {
  const root = scope(context.page, within);
  if ("text" in target) {
    await expect(
      root
        .getByText(scenarioValue(target.text, context.variables), {
          exact: target.exact ?? false,
        })
        .first(),
    ).toBeVisible();
    return;
  }

  await strictRoleLocator(root, target, context);
}
