export function matchesTopState(value: unknown, state: string): boolean {
  if (typeof value === "string") {
    return value === state;
  }
  return isStateObject(value) && Object.prototype.hasOwnProperty.call(value, state);
}

export function matchesChildState(value: unknown, parent: string, child: string): boolean {
  if (!isStateObject(value)) {
    return false;
  }
  return value[parent] === child;
}

export function matchesGrandchildState(value: unknown, parent: string, child: string, grandchild: string): boolean {
  if (!isStateObject(value)) {
    return false;
  }
  const childValue = value[parent];
  if (!isStateObject(childValue)) {
    return false;
  }
  return childValue[child] === grandchild;
}

function isStateObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
