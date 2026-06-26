import type { Page, Request, Route } from "@playwright/test";

import { interpolateData, type RuntimeVariables } from "./interpolation";
import type { ScenarioStep } from "./scenarioSchema";
import { scenarioPath } from "./values";

type RuleType = "hold" | "fulfill" | "fail";

type RequestMatcher = {
  id?: string;
  method?: string;
  path: string;
};

type ObservedRequest = {
  id?: string;
  method: string;
  path: string;
  url: string;
};

type Rule = RequestMatcher & {
  type: RuleType;
  released: boolean;
  observed: number;
  times?: number;
  pending: Array<() => Promise<void>>;
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  errorCode?: string;
};

type RequestWaiter = {
  matcher: {
    id?: string;
    method?: string;
    path?: string;
  };
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class NetworkController {
  private readonly rules: Rule[] = [];
  private readonly observedRequests: ObservedRequest[] = [];
  private readonly waiters: RequestWaiter[] = [];

  async attach(page: Page): Promise<void> {
    await page.route("**/*", async (route) => this.handleRoute(route));
  }

  holdRequest(step: ScenarioStep, variables: RuntimeVariables): void {
    if (step.holdRequest === undefined) {
      throw new Error("holdRequest action is missing");
    }

    this.rules.push({
      type: "hold",
      id: step.holdRequest.id,
      method: step.holdRequest.method,
      path: scenarioPath(step.holdRequest.path, variables),
      times: step.holdRequest.times,
      released: false,
      observed: 0,
      pending: [],
    });
  }

  async releaseRequest(step: ScenarioStep): Promise<void> {
    if (step.releaseRequest === undefined) {
      throw new Error("releaseRequest action is missing");
    }

    const id =
      typeof step.releaseRequest === "string"
        ? step.releaseRequest
        : step.releaseRequest.id;
    const rule = this.rules.find(
      (candidate) => candidate.id === id && candidate.type === "hold",
    );
    if (rule === undefined) {
      throw new Error(`no held request named "${id}"`);
    }

    rule.released = true;
    const pending = rule.pending.splice(0);
    await Promise.all(pending.map((continueRoute) => continueRoute()));
  }

  fulfillRequest(step: ScenarioStep, variables: RuntimeVariables): void {
    if (step.fulfillRequest === undefined) {
      throw new Error("fulfillRequest action is missing");
    }

    this.rules.push({
      type: "fulfill",
      id: step.fulfillRequest.id,
      method: step.fulfillRequest.method,
      path: scenarioPath(step.fulfillRequest.path, variables),
      released: true,
      observed: 0,
      pending: [],
      status: step.fulfillRequest.status,
      headers:
        step.fulfillRequest.headers === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(step.fulfillRequest.headers).map(
                ([key, value]) => [key, scenarioPath(value, variables)],
              ),
            ),
      json:
        step.fulfillRequest.json === undefined
          ? undefined
          : interpolateData(step.fulfillRequest.json, variables),
      body:
        step.fulfillRequest.body === undefined
          ? undefined
          : scenarioPath(step.fulfillRequest.body, variables),
    });
  }

  failRequest(step: ScenarioStep, variables: RuntimeVariables): void {
    if (step.failRequest === undefined) {
      throw new Error("failRequest action is missing");
    }

    this.rules.push({
      type: "fail",
      id: step.failRequest.id,
      method: step.failRequest.method,
      path: scenarioPath(step.failRequest.path, variables),
      released: true,
      observed: 0,
      pending: [],
      errorCode: step.failRequest.errorCode,
    });
  }

  async expectRequest(
    step: ScenarioStep,
    variables: RuntimeVariables,
  ): Promise<void> {
    if (step.expectRequest === undefined) {
      throw new Error("expectRequest action is missing");
    }

    const matcher = {
      id: step.expectRequest.id,
      method: step.expectRequest.method,
      path:
        step.expectRequest.path === undefined
          ? undefined
          : scenarioPath(step.expectRequest.path, variables),
    };
    if (
      this.observedRequests.some((request) =>
        matchesObservedRequest(request, matcher),
      )
    ) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex(
          (waiter) => waiter.timer === timer,
        );
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(
          new Error(`request was not observed: ${describeMatcher(matcher)}`),
        );
      }, step.expectRequest?.timeout ?? 5_000);

      this.waiters.push({ matcher, resolve, reject, timer });
    });
  }

  async cleanup(): Promise<void> {
    const pendingContinuations = this.rules.flatMap((rule) => {
      rule.released = true;
      return rule.pending.splice(0);
    });

    await Promise.allSettled(
      pendingContinuations.map((continueRoute) => continueRoute()),
    );
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error("network controller cleaned up before request was observed"),
      );
    }
  }

  private async handleRoute(route: Route): Promise<void> {
    const request = route.request();
    const matchingRule = this.rules.find((rule) => matchesRule(rule, request));
    const observed = observedFromRequest(request, matchingRule?.id);
    this.observedRequests.push(observed);
    this.resolveWaiters(observed);

    if (matchingRule === undefined) {
      await route.continue();
      return;
    }

    matchingRule.observed += 1;
    switch (matchingRule.type) {
      case "hold":
        await this.holdRoute(route, matchingRule);
        return;
      case "fulfill":
        await route.fulfill({
          status: matchingRule.status ?? 200,
          headers: matchingRule.headers,
          contentType:
            matchingRule.json === undefined ? undefined : "application/json",
          body:
            matchingRule.body ??
            (matchingRule.json === undefined
              ? ""
              : JSON.stringify(matchingRule.json)),
        });
        return;
      case "fail":
        await route.abort(matchingRule.errorCode ?? "failed");
        return;
    }
  }

  private async holdRoute(route: Route, rule: Rule): Promise<void> {
    if (rule.released) {
      await route.continue();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      rule.pending.push(async () => {
        try {
          await route.continue();
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  private resolveWaiters(observed: ObservedRequest): void {
    for (const waiter of [...this.waiters]) {
      if (!matchesObservedRequest(observed, waiter.matcher)) {
        continue;
      }

      clearTimeout(waiter.timer);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  }
}

function matchesRule(rule: Rule, request: Request): boolean {
  if (rule.times !== undefined && rule.observed >= rule.times) {
    return false;
  }

  const observed = observedFromRequest(request, rule.id);
  return matchesObservedRequest(observed, rule);
}

function matchesObservedRequest(
  request: ObservedRequest,
  matcher: {
    id?: string;
    method?: string;
    path?: string;
  },
): boolean {
  if (matcher.id !== undefined && request.id !== matcher.id) {
    return false;
  }
  if (matcher.method !== undefined && request.method !== matcher.method) {
    return false;
  }
  if (matcher.path !== undefined && !pathMatches(matcher.path, request.path)) {
    return false;
  }
  return true;
}

function observedFromRequest(request: Request, id?: string): ObservedRequest {
  const url = new URL(request.url());
  return {
    id,
    method: request.method().toUpperCase(),
    path: url.pathname,
    url: request.url(),
  };
}

function pathMatches(pattern: string, path: string): boolean {
  if (!pattern.includes("*")) {
    return pattern === path;
  }

  const regex = new RegExp(
    `^${pattern.split("*").map(escapeRegExp).join(".*")}$`,
  );
  return regex.test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function describeMatcher(matcher: {
  id?: string;
  method?: string;
  path?: string;
}): string {
  return [
    matcher.id === undefined ? "" : `id=${matcher.id}`,
    matcher.method === undefined ? "" : `method=${matcher.method}`,
    matcher.path === undefined ? "" : `path=${matcher.path}`,
  ]
    .filter(Boolean)
    .join(" ");
}
