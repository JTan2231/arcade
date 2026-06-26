import YAML from "yaml";
import { z } from "zod";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const roleSchema = z.enum([
  "alert",
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "link",
  "main",
  "region",
  "status",
  "tab",
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

const captureEntrySchema = z.union([
  z.string().min(1),
  z
    .object({
      selector: z.string().min(1),
      overwrite: z.literal(true).optional(),
    })
    .strict(),
]);

const requestSchema = z
  .object({
    id: z.string().min(1).optional(),
    client: z.enum(["isolated", "browser"]).optional(),
    method: methodSchema,
    path: requestPathSchema,
    headers: z.record(z.string(), z.string()).optional(),
    json: z.unknown().optional(),
    body: z.string().optional(),
    form: z.record(z.string(), scalarSchema).optional(),
    expectStatus: z.number().int().min(100).max(599).optional(),
    expectJson: z.unknown().optional(),
    capture: z.record(z.string(), captureEntrySchema).optional(),
  })
  .strict()
  .refine(
    (request) =>
      [request.json, request.body, request.form].filter(
        (value) => value !== undefined,
      ).length <= 1,
    {
      message: "request supports only one of json, body, or form",
    },
  );

const operationKeys = [
  "request",
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
    id: z.string().min(1).optional(),
    within: z.string().min(1).optional(),
    timeout: z.number().int().positive().optional(),
    acceptDialog: acceptDialogSchema.optional(),
    request: requestSchema.optional(),
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
    const configuredOperations = operationKeys.filter(
      (key) => step[key] !== undefined,
    );
    if (configuredOperations.length !== 1) {
      context.addIssue({
        code: "custom",
        message: `expected exactly one primitive operation, found ${configuredOperations.length}`,
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
    vars: z.record(z.string(), scalarSchema).optional(),
    before: z.array(scenarioStepSchema).optional(),
    steps: z.array(scenarioStepSchema).min(1),
    after: z.array(scenarioStepSchema).optional(),
  })
  .strict()
  .superRefine((scenario, context) => {
    for (const variableName of Object.keys(scenario.vars ?? {})) {
      if (!identifierPattern.test(variableName)) {
        context.addIssue({
          code: "custom",
          path: ["vars", variableName],
          message: "variable name must be a valid identifier",
        });
      }
    }

    const capturedNames = new Set(Object.keys(scenario.vars ?? {}));
    for (const phase of ["before", "steps", "after"] as const) {
      for (const [index, step] of (scenario[phase] ?? []).entries()) {
        for (const [name, capture] of Object.entries(
          step.request?.capture ?? {},
        )) {
          if (!identifierPattern.test(name)) {
            context.addIssue({
              code: "custom",
              path: [phase, index, "request", "capture", name],
              message: "capture name must be a valid identifier",
            });
          }

          const overwrites =
            typeof capture === "object" && capture.overwrite === true;
          if (capturedNames.has(name) && !overwrites) {
            context.addIssue({
              code: "custom",
              path: [phase, index, "request", "capture", name],
              message:
                "duplicate capture names require overwrite: true on the capture",
            });
          }
          capturedNames.add(name);
        }
      }
    }
  });

export type RoleTarget = z.infer<typeof roleTargetSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioStep = z.infer<typeof scenarioStepSchema>;
export type ScenarioPhase = "before" | "steps" | "after";
export type RequestPrimitive = NonNullable<ScenarioStep["request"]>;
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
    const stepLocation = stepLocationFromPath(issue.path);
    const prefix =
      stepLocation === null
        ? `${file}: ${path}`
        : `${file}: ${stepLocation.phase} step ${stepLocation.index + 1} (${path})`;
    return `${prefix}: ${issue.message}`;
  });

  return messages.join("\n");
}

function stepLocationFromPath(
  path: PropertyKey[],
): { phase: ScenarioPhase; index: number } | null {
  if (path[0] !== "before" && path[0] !== "steps" && path[0] !== "after") {
    return null;
  }
  if (typeof path[1] !== "number") {
    return null;
  }
  return { phase: path[0], index: path[1] };
}
