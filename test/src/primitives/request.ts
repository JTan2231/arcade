import type { APIRequestContext, APIResponse } from "@playwright/test";

import type { PrimitiveContext } from "../context";
import {
  interpolateData,
  interpolateString,
  type RuntimeVariables,
} from "../interpolation";
import { selectJSON } from "../jsonSelectors";
import type { RequestPrimitive, ScenarioStep } from "../scenarioSchema";

export async function executeRequestPrimitive(
  context: PrimitiveContext,
  step: ScenarioStep,
): Promise<void> {
  if (step.request === undefined) {
    throw new Error("request primitive is missing");
  }

  const request = step.request;
  const client = requestClient(context, request.client);
  const response = await client.fetch(
    interpolateString(request.path, context.variables),
    requestOptions(request, context.variables),
  );

  if (
    request.expectStatus !== undefined &&
    response.status() !== request.expectStatus
  ) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${request.method} ${request.path} returned ${response.status()}, expected ${request.expectStatus}${body === "" ? "" : `: ${body}`}`,
    );
  }

  if (request.expectJson !== undefined) {
    assertPartialJSON(
      await responseJSON(response),
      interpolateData(request.expectJson, context.variables),
      "$",
    );
  }

  if (request.capture !== undefined) {
    const body = await responseJSON(response);
    for (const [name, capture] of Object.entries(request.capture)) {
      const selector = typeof capture === "string" ? capture : capture.selector;
      const overwrite =
        typeof capture === "object" && capture.overwrite === true;
      if (context.variables.has(name) && !overwrite) {
        throw new Error(
          `capture "${name}" already exists; use overwrite: true to replace it`,
        );
      }
      context.variables.set(
        name,
        selectJSON(body, interpolateString(selector, context.variables)),
      );
    }
  }
}

function requestClient(
  context: PrimitiveContext,
  client: RequestPrimitive["client"],
): APIRequestContext {
  return client === "browser"
    ? context.page.context().request
    : context.isolatedRequest;
}

function requestOptions(
  request: RequestPrimitive,
  variables: RuntimeVariables,
): Parameters<APIRequestContext["fetch"]>[1] {
  return {
    method: request.method,
    headers:
      request.headers === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [
              key,
              interpolateString(value, variables),
            ]),
          ),
    data:
      request.json !== undefined
        ? interpolateData(request.json, variables)
        : request.body === undefined
          ? undefined
          : interpolateString(request.body, variables),
    form:
      request.form === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(request.form).map(([key, value]) => [
              key,
              typeof value === "string"
                ? interpolateString(value, variables)
                : value,
            ]),
          ),
  };
}

async function responseJSON(response: APIResponse): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new Error(
      `response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertPartialJSON(
  actual: unknown,
  expected: unknown,
  path: string,
): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      throw new Error(`${path}: expected array, got ${describeJSON(actual)}`);
    }
    if (actual.length < expected.length) {
      throw new Error(
        `${path}: expected at least ${expected.length} array entries, got ${actual.length}`,
      );
    }
    for (const [index, expectedEntry] of expected.entries()) {
      assertPartialJSON(actual[index], expectedEntry, `${path}[${index}]`);
    }
    return;
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      throw new Error(`${path}: expected object, got ${describeJSON(actual)}`);
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (!(key in actual)) {
        throw new Error(`${path}.${key}: missing key`);
      }
      assertPartialJSON(actual[key], expectedValue, `${path}.${key}`);
    }
    return;
  }

  if (!Object.is(actual, expected)) {
    throw new Error(
      `${path}: expected ${describeJSON(expected)}, got ${describeJSON(actual)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeJSON(value: unknown): string {
  return JSON.stringify(value);
}
