import type { CssTokenMap, CssTokenName } from "./types";

const tokenNamePattern = /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function validateDeclaration(name: string, value: string): asserts name is CssTokenName {
  if (!tokenNamePattern.test(name)) {
    throw new Error(`Invalid CSS token name ${JSON.stringify(name)}`);
  }
  if (value.trim() === "" || /[;{}]/.test(value)) {
    throw new Error(`Invalid value for CSS token ${name}`);
  }
}

export function serializeDeclarations(tokens: CssTokenMap) {
  return Object.entries(tokens)
    .map(([name, value]) => {
      validateDeclaration(name, value);
      return `  ${name}: ${value};`;
    })
    .join("\n");
}

export function installCssTokens(tokens: CssTokenMap, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(tokens)) {
    validateDeclaration(name, value);
    root.style.setProperty(name, value);
  }
}
