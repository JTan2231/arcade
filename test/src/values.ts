import {
  interpolateScalar,
  interpolateString,
  scenarioDate as interpolatedScenarioDate,
  type RuntimeVariables,
  type Scalar,
} from "./interpolation";

export function scenarioValue(
  value: Scalar,
  variables: RuntimeVariables,
): string {
  return interpolateScalar(value, variables);
}

export function scenarioPath(
  value: string,
  variables: RuntimeVariables,
): string {
  return interpolateString(value, variables);
}

export function scenarioDate(
  value: string | undefined,
  variables: RuntimeVariables,
): string {
  return interpolatedScenarioDate(value, variables);
}
