import {
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import type { NetworkController } from "./networkControls";
import type { RuntimeVariables } from "./interpolation";

export type PrimitiveContext = {
  baseURL: string;
  page: Page;
  isolatedRequest: APIRequestContext;
  variables: RuntimeVariables;
  network: NetworkController;
};

export async function createPrimitiveContext(options: {
  baseURL: string;
  page: Page;
  variables: RuntimeVariables;
  network: NetworkController;
}): Promise<PrimitiveContext> {
  return {
    ...options,
    isolatedRequest: await playwrightRequest.newContext({
      baseURL: options.baseURL,
    }),
  };
}

export async function disposePrimitiveContext(
  context: PrimitiveContext,
): Promise<void> {
  await context.isolatedRequest.dispose().catch(() => undefined);
}
