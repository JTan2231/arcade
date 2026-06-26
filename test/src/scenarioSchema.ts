import YAML from "yaml";
import { z } from "zod";

const roleSchema = z.enum([
  "button",
  "link",
  "tab",
  "checkbox",
  "combobox",
  "textbox",
]);
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const methodSchema = z
  .string()
  .trim()
  .min(1)
  .transform((method) => method.toUpperCase());

export const roleTargetSchema = z
  .object({
    role: roleSchema,
    name: z.string().min(1),
    exact: z.boolean().optional(),
  })
  .strict();

const labelTargetSchema = z
  .object({
    label: z.string().min(1),
    exact: z.boolean().optional(),
  })
  .strict();

const fillSchema = labelTargetSchema
  .extend({
    value: scalarSchema,
  })
  .strict();

const selectSchema = labelTargetSchema
  .extend({
    option: scalarSchema.optional(),
    value: scalarSchema.optional(),
  })
  .strict()
  .refine(
    (select) => select.option !== undefined || select.value !== undefined,
    {
      message: "select requires option or value",
    },
  );

const textTargetSchema = z
  .object({
    text: z.string().min(1),
    exact: z.boolean().optional(),
  })
  .strict();

const visibleTargetSchema = z.union([textTargetSchema, roleTargetSchema]);

const expectPressedSchema = roleTargetSchema
  .extend({
    pressed: z.boolean(),
  })
  .strict();

const textExpectationSchema = z
  .object({
    text: z.string().min(1),
    exact: z.boolean().optional(),
  })
  .strict();

const acceptDialogSchema = z
  .object({
    message: z.string().optional(),
    exact: z.boolean().optional(),
  })
  .strict();

const waitSchema = z.union([
  z.number().int().nonnegative(),
  z
    .object({
      milliseconds: z.number().int().nonnegative().optional(),
      text: z.string().min(1).optional(),
      exact: z.boolean().optional(),
    })
    .strict()
    .refine(
      (wait) => wait.milliseconds !== undefined || wait.text !== undefined,
      {
        message: "wait requires milliseconds or text",
      },
    ),
]);

const requestPathSchema = z.string().min(1);
const holdRequestSchema = z
  .object({
    id: z.string().min(1),
    method: methodSchema.optional(),
    path: requestPathSchema,
    times: z.number().int().positive().optional(),
  })
  .strict();

const releaseRequestSchema = z.union([
  z.string().min(1),
  z
    .object({
      id: z.string().min(1),
    })
    .strict(),
]);

const fulfillRequestSchema = z
  .object({
    id: z.string().min(1).optional(),
    method: methodSchema.optional(),
    path: requestPathSchema,
    status: z.number().int().min(100).max(599).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    json: z.unknown().optional(),
    body: z.string().optional(),
  })
  .strict()
  .refine(
    (fulfill) => fulfill.json === undefined || fulfill.body === undefined,
    {
      message: "fulfillRequest supports json or body, not both",
    },
  );

const failRequestSchema = z
  .object({
    id: z.string().min(1).optional(),
    method: methodSchema.optional(),
    path: requestPathSchema,
    errorCode: z.string().min(1).optional(),
  })
  .strict();

const expectRequestSchema = z
  .object({
    id: z.string().min(1).optional(),
    method: methodSchema.optional(),
    path: requestPathSchema.optional(),
    timeout: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (expectRequest) =>
      expectRequest.id !== undefined || expectRequest.path !== undefined,
    {
      message: "expectRequest requires id or path",
    },
  );

const setupAccountSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    rememberMe: z.boolean().optional(),
  })
  .strict();

const setupGroupSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    owner: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    visibility: z.enum(["public", "invite_only", "private"]).optional(),
  })
  .strict();

const catalogFieldSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    value_type: z.enum(["string", "number"]),
    is_array: z.boolean().optional(),
    display_order: z.number().int().optional(),
  })
  .strict();

const catalogItemSchema = z
  .object({
    title: z.string().min(1).optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

const catalogSourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    group: z.string().min(1),
    name: z.string().min(1),
    template: z.string().min(1).optional(),
    preset: z.string().min(1).optional(),
    fields: z.array(catalogFieldSchema).optional(),
    items: z.array(catalogItemSchema).optional(),
  })
  .strict();

const setupDailyFeedSchema = z
  .object({
    id: z.string().min(1),
    group: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["catalog_daily", "daily_thread"]).optional(),
    source: z.string().min(1).optional(),
    itemCount: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict();

const setupFeedPostSchema = z
  .object({
    group: z.string().min(1),
    feed: z.string().min(1),
    author: z.string().min(1),
    date: z.string().min(1).optional(),
    evidenceText: z.string().min(1),
    caption: z.string().optional(),
  })
  .strict();

const setupSchema = z
  .object({
    accounts: z.array(setupAccountSchema).optional(),
    loginAs: z.string().min(1).optional(),
    groups: z.array(setupGroupSchema).optional(),
    catalogSources: z.array(catalogSourceSchema).optional(),
    dailyFeeds: z.array(setupDailyFeedSchema).optional(),
    feedPosts: z.array(setupFeedPostSchema).optional(),
  })
  .strict();

const actionKeys = [
  "visit",
  "click",
  "fill",
  "select",
  "check",
  "uncheck",
  "expectVisible",
  "expectHidden",
  "expectPressed",
  "expectDisabled",
  "expectEnabled",
  "expectValue",
  "expectStatus",
  "expectAlert",
  "wait",
  "holdRequest",
  "releaseRequest",
  "fulfillRequest",
  "failRequest",
  "expectRequest",
] as const;

export const scenarioStepSchema = z
  .object({
    within: z.string().min(1).optional(),
    acceptDialog: acceptDialogSchema.optional(),
    visit: z.string().min(1).optional(),
    click: roleTargetSchema.optional(),
    fill: fillSchema.optional(),
    select: selectSchema.optional(),
    check: labelTargetSchema.optional(),
    uncheck: labelTargetSchema.optional(),
    expectVisible: visibleTargetSchema.optional(),
    expectHidden: visibleTargetSchema.optional(),
    expectPressed: expectPressedSchema.optional(),
    expectDisabled: visibleTargetSchema.optional(),
    expectEnabled: visibleTargetSchema.optional(),
    expectValue: fillSchema.optional(),
    expectStatus: textExpectationSchema.optional(),
    expectAlert: textExpectationSchema.optional(),
    wait: waitSchema.optional(),
    holdRequest: holdRequestSchema.optional(),
    releaseRequest: releaseRequestSchema.optional(),
    fulfillRequest: fulfillRequestSchema.optional(),
    failRequest: failRequestSchema.optional(),
    expectRequest: expectRequestSchema.optional(),
  })
  .strict()
  .superRefine((step, context) => {
    const configuredActions = actionKeys.filter(
      (key) => step[key] !== undefined,
    );
    if (configuredActions.length !== 1) {
      context.addIssue({
        code: "custom",
        message: `expected exactly one action, found ${configuredActions.length}`,
      });
    }

    if (step.acceptDialog !== undefined && step.click === undefined) {
      context.addIssue({
        code: "custom",
        path: ["acceptDialog"],
        message: "acceptDialog can only be combined with click",
      });
    }
  });

export const scenarioSchema = z
  .object({
    name: z.string().min(1),
    setup: setupSchema.optional(),
    steps: z.array(scenarioStepSchema).min(1),
  })
  .strict();

export type RoleTarget = z.infer<typeof roleTargetSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioStep = z.infer<typeof scenarioStepSchema>;
export type ScenarioSetup = NonNullable<Scenario["setup"]>;
export type TextExpectation = z.infer<typeof textExpectationSchema>;
export type VisibleTarget = z.infer<typeof visibleTargetSchema>;

export type LoadedScenario = {
  file: string;
  source: string;
  scenario: Scenario;
};

export function parseScenarioFile(
  file: string,
  source: string,
): LoadedScenario {
  let parsed: unknown;
  try {
    parsed = YAML.parse(source);
  } catch (error) {
    throw new Error(
      `${file}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = scenarioSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(formatScenarioValidationError(file, result.error));
  }

  return {
    file,
    source,
    scenario: result.data,
  };
}

export function formatStepSnippet(step: ScenarioStep): string {
  return YAML.stringify(step).trim();
}

function formatScenarioValidationError(
  file: string,
  error: z.ZodError,
): string {
  const messages = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    const stepIndex = stepIndexFromPath(issue.path);
    const prefix =
      stepIndex === null
        ? `${file}: ${path}`
        : `${file}: step ${stepIndex + 1} (${path})`;
    return `${prefix}: ${issue.message}`;
  });

  return messages.join("\n");
}

function stepIndexFromPath(path: PropertyKey[]): number | null {
  if (path[0] !== "steps" || typeof path[1] !== "number") {
    return null;
  }
  return path[1];
}
