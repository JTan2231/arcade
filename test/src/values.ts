type Scalar = string | number | boolean;

export function scenarioValue(value: Scalar): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return expandScenarioTokens(value);
}

export function scenarioPath(value: string): string {
  return expandScenarioTokens(value);
}

export function scenarioDate(value: string | undefined): string {
  return scenarioValue(value ?? "{{today}}");
}

function expandScenarioTokens(value: string): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_match, token: string) =>
    tokenValue(token),
  );
}

function tokenValue(token: string): string {
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

  throw new Error(`unknown scenario token: ${token}`);
}

function formatDateValue(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
