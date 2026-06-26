export type RuntimeVariables = Map<string, unknown>;
export type Scalar = string | number | boolean;

export function initialVariables(
  values: Record<string, Scalar> | undefined,
): RuntimeVariables {
  return new Map(Object.entries(values ?? {}));
}

export function interpolateScalar(
  value: Scalar,
  variables: RuntimeVariables,
): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return interpolateString(value, variables);
}

export function interpolateString(
  value: string,
  variables: RuntimeVariables,
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_match, token: string) => {
    const resolved = tokenValue(token.trim(), variables);
    if (!isScalar(resolved)) {
      throw new Error(
        `cannot interpolate non-scalar variable "${token.trim()}" into a string`,
      );
    }
    return String(resolved);
  });
}

export function interpolateData(
  value: unknown,
  variables: RuntimeVariables,
): unknown {
  if (typeof value === "string") {
    return interpolateString(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateData(entry, variables));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        interpolateData(entry, variables),
      ]),
    );
  }
  return value;
}

export function scenarioDate(
  value: string | undefined,
  variables: RuntimeVariables,
): string {
  return interpolateString(value ?? "{{today}}", variables);
}

function tokenValue(token: string, variables: RuntimeVariables): unknown {
  if (token === "today") {
    return formatDateValue(0);
  }
  if (token === "yesterday") {
    return formatDateValue(1);
  }

  const daysAgoMatch = /^daysAgo:(\d+)$/.exec(token);
  if (daysAgoMatch !== null) {
    return formatDateValue(Number(daysAgoMatch[1]));
  }

  if (!variables.has(token)) {
    throw new Error(`unknown scenario variable or token: ${token}`);
  }
  return variables.get(token);
}

function formatDateValue(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
