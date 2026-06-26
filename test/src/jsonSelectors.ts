type PathPart =
  | {
      type: "field";
      name: string;
    }
  | {
      type: "index";
      index: number;
    };

export function selectJSON(value: unknown, selector: string): unknown {
  const parts = parseSelector(selector);
  let current = value;

  for (const part of parts) {
    if (part.type === "field") {
      if (!isRecord(current) || !(part.name in current)) {
        throw new Error(`JSON selector did not match: ${selector}`);
      }
      current = current[part.name];
      continue;
    }

    if (!Array.isArray(current) || part.index >= current.length) {
      throw new Error(`JSON selector did not match: ${selector}`);
    }
    current = current[part.index];
  }

  return current;
}

function parseSelector(selector: string): PathPart[] {
  if (selector === "$") {
    return [];
  }
  if (!selector.startsWith("$")) {
    throw new Error(`JSON selector must start with $: ${selector}`);
  }

  const parts: PathPart[] = [];
  let index = 1;
  while (index < selector.length) {
    const char = selector[index];
    if (char === ".") {
      const match = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(selector.slice(index));
      if (match === null) {
        throw new Error(`invalid JSON selector: ${selector}`);
      }
      parts.push({ type: "field", name: match[1] });
      index += match[0].length;
      continue;
    }

    if (char === "[") {
      const match = /^\[(\d+)\]/.exec(selector.slice(index));
      if (match === null) {
        throw new Error(`invalid JSON selector: ${selector}`);
      }
      parts.push({ type: "index", index: Number(match[1]) });
      index += match[0].length;
      continue;
    }

    throw new Error(`invalid JSON selector: ${selector}`);
  }

  return parts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
