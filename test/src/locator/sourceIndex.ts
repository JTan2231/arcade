import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import type { RelatedSource, SourceCandidate, SourceLocation } from "./types";

type JSXOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

type LabelInfo = {
  text: string;
  source: SourceLocation;
};

type RegionInfo = {
  role: string;
  name: string;
};

type LabelResult = {
  text: string;
  relatedSources: RelatedSource[];
};

const domTags = new Set([
  "a",
  "button",
  "details",
  "dialog",
  "div",
  "form",
  "input",
  "label",
  "li",
  "main",
  "ol",
  "option",
  "section",
  "select",
  "summary",
  "textarea",
  "ul",
]);
const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const controlTags = new Set(["input", "select", "textarea"]);
const clickableTextTags = new Set(["a", "button", "summary"]);
const regionRoles = new Set(["alert", "dialog", "main", "region", "status"]);

export function buildSourceIndex(repoRoot: string): SourceCandidate[] {
  const sourceRoot = path.join(repoRoot, "web/frontend/src");
  const candidates: SourceCandidate[] = [];

  for (const filePath of listFiles(sourceRoot)
    .filter((candidate) => candidate.endsWith(".tsx"))
    .sort()) {
    const text = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const idLabels = collectIdLabels(repoRoot, sourceFile);

    visit(sourceFile, (node) => {
      if (!isJsxOpeningLikeElement(node)) {
        return;
      }

      const candidate = sourceCandidateForOpening(
        repoRoot,
        sourceFile,
        node,
        idLabels,
      );
      if (candidate !== null) {
        candidates.push(candidate);
      }
    });
  }

  return candidates;
}

function sourceCandidateForOpening(
  repoRoot: string,
  sourceFile: ts.SourceFile,
  opening: JSXOpening,
  idLabels: Map<string, LabelInfo>,
): SourceCandidate | null {
  const tagName = getTagName(opening, sourceFile);
  const props = attributesForOpening(opening, sourceFile);
  const role = roleForOpening(opening, sourceFile, idLabels);
  const label = labelForOpening(opening, sourceFile, idLabels);
  const container = getElementContainer(opening);
  const text =
    container === null
      ? ""
      : normalizeText(collectVisibleText(container, sourceFile));
  const regionPath = jsxAncestors(opening, true)
    .map((ancestor) => regionForOpening(ancestor.opening, sourceFile, idLabels))
    .filter((region): region is RegionInfo => region !== null)
    .map((region) => region.name)
    .reverse();
  const name = firstNonEmpty(label.text, role.name, text);
  const shouldIndex =
    name !== "" ||
    text !== "" ||
    role.role !== "generic" ||
    Object.keys(props).some(
      (prop) => prop.startsWith("aria-") || prop === "role",
    );

  if (!shouldIndex) {
    return null;
  }

  const source = sourceLocation(
    repoRoot,
    sourceFile,
    container === null ? opening : container,
  );
  const dynamic = [name, text, ...regionPath, ...Object.values(props)].some(
    (value) => value.includes("{"),
  );

  return {
    id: `${source.file}:${source.startLine}:${tagName}`,
    kind: "source",
    elementKind: isDomTag(tagName) ? "dom" : "component",
    tagName,
    role: role.role,
    name,
    text,
    label: label.text,
    regionPath,
    dynamic,
    props,
    source,
    relatedSources: [...role.relatedSources, ...label.relatedSources],
  };
}

function listFiles(dir: string): string[] {
  const results: string[] = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      results.push(...listFiles(fullPath));
      continue;
    }
    if (dirent.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function collectIdLabels(
  repoRoot: string,
  sourceFile: ts.SourceFile,
): Map<string, LabelInfo> {
  const labels = new Map<string, LabelInfo>();
  visit(sourceFile, (node) => {
    if (!isJsxOpeningLikeElement(node)) {
      return;
    }

    const id = getAttributeValue(node, "id", sourceFile);
    if (id === null || /[{}\s]/.test(id)) {
      return;
    }

    const container = getElementContainer(node);
    const text =
      container === null
        ? ""
        : normalizeText(collectVisibleText(container, sourceFile));
    if (text !== "") {
      labels.set(id, {
        text,
        source: sourceLocation(
          repoRoot,
          sourceFile,
          container === null ? node : container,
        ),
      });
    }
  });
  return labels;
}

function roleForOpening(
  opening: JSXOpening,
  sourceFile: ts.SourceFile,
  idLabels: Map<string, LabelInfo>,
): { role: string; name: string; relatedSources: RelatedSource[] } {
  const explicitRole = getAttributeValue(opening, "role", sourceFile);
  const tagName = getTagName(opening, sourceFile);
  const label = explicitLabelForOpening(opening, sourceFile, idLabels);
  const namedRegion = firstNonEmpty(label.text, "");

  if (
    explicitRole !== null &&
    explicitRole !== "" &&
    explicitRole !== "none" &&
    explicitRole !== "presentation"
  ) {
    return {
      role: explicitRole.split(/\s+/)[0] ?? explicitRole,
      name: namedRegion,
      relatedSources: label.relatedSources,
    };
  }

  if (tagName === "main") {
    return {
      role: "main",
      name: namedRegion,
      relatedSources: label.relatedSources,
    };
  }
  if (tagName === "section" && namedRegion !== "") {
    return {
      role: "region",
      name: namedRegion,
      relatedSources: label.relatedSources,
    };
  }
  if (tagName === "button") {
    return { role: "button", name: namedRegion, relatedSources: [] };
  }
  if (
    tagName === "a" &&
    getAttributeValue(opening, "href", sourceFile) !== null
  ) {
    return { role: "link", name: namedRegion, relatedSources: [] };
  }
  if (tagName === "select") {
    return { role: "combobox", name: namedRegion, relatedSources: [] };
  }
  if (tagName === "textarea") {
    return { role: "textbox", name: namedRegion, relatedSources: [] };
  }
  if (tagName === "input") {
    const inputType = (
      getAttributeValue(opening, "type", sourceFile) ?? "text"
    ).toLowerCase();
    if (inputType === "checkbox") {
      return { role: "checkbox", name: namedRegion, relatedSources: [] };
    }
    if (
      inputType === "button" ||
      inputType === "submit" ||
      inputType === "reset"
    ) {
      return { role: "button", name: namedRegion, relatedSources: [] };
    }
    return { role: "textbox", name: namedRegion, relatedSources: [] };
  }
  if (headingTags.has(tagName)) {
    return { role: "heading", name: namedRegion, relatedSources: [] };
  }
  if (tagName === "ul" || tagName === "ol") {
    return { role: "list", name: namedRegion, relatedSources: [] };
  }
  if (tagName === "li") {
    return { role: "listitem", name: namedRegion, relatedSources: [] };
  }
  if (tagName === "form" && namedRegion !== "") {
    return { role: "form", name: namedRegion, relatedSources: [] };
  }
  if (!isDomTag(tagName)) {
    return { role: "component", name: namedRegion, relatedSources: [] };
  }

  return { role: "generic", name: namedRegion, relatedSources: [] };
}

function labelForOpening(
  opening: JSXOpening,
  sourceFile: ts.SourceFile,
  idLabels: Map<string, LabelInfo>,
): LabelResult {
  const explicit = explicitLabelForOpening(opening, sourceFile, idLabels);
  if (explicit.text !== "") {
    return explicit;
  }

  const tagName = getTagName(opening, sourceFile);
  if (!isDomTag(tagName)) {
    const propLabel = firstNonEmpty(
      getAttributeValue(opening, "label", sourceFile),
      getAttributeValue(opening, "title", sourceFile),
      getAttributeValue(opening, "name", sourceFile),
      "",
    );
    if (propLabel !== "") {
      return { text: propLabel, relatedSources: [] };
    }
  }

  const container = getElementContainer(opening);
  if (container !== null && clickableTextTags.has(tagName)) {
    const text = normalizeText(collectVisibleText(container, sourceFile));
    if (text !== "") {
      return { text, relatedSources: [] };
    }
  }

  if (controlTags.has(tagName)) {
    const wrappingLabel = findWrappingLabel(opening, sourceFile);
    if (wrappingLabel !== null) {
      return wrappingLabel;
    }
  }

  const siblingHeading = findNearestSiblingHeading(opening, sourceFile);
  if (siblingHeading !== null) {
    return siblingHeading;
  }

  const region = regionForOpening(opening, sourceFile, idLabels);
  if (region !== null) {
    return { text: region.name, relatedSources: [] };
  }

  return { text: "", relatedSources: [] };
}

function explicitLabelForOpening(
  opening: JSXOpening,
  sourceFile: ts.SourceFile,
  idLabels: Map<string, LabelInfo>,
): LabelResult {
  const ariaLabel = getAttributeValue(opening, "aria-label", sourceFile);
  if (ariaLabel !== null && ariaLabel !== "") {
    return { text: ariaLabel, relatedSources: [] };
  }

  return resolveLabelledBy(
    getAttributeValue(opening, "aria-labelledby", sourceFile),
    idLabels,
  );
}

function findWrappingLabel(
  opening: JSXOpening,
  sourceFile: ts.SourceFile,
): LabelResult | null {
  for (const ancestor of jsxAncestors(opening, false)) {
    const tagName = getTagName(ancestor.opening, sourceFile);
    if (tagName !== "label") {
      continue;
    }

    const container = getElementContainer(ancestor.opening);
    const text =
      container === null
        ? ""
        : normalizeText(collectLabelText(container, sourceFile));
    if (text !== "") {
      return { text, relatedSources: [] };
    }
  }
  return null;
}

function findNearestSiblingHeading(
  opening: JSXOpening,
  sourceFile: ts.SourceFile,
): LabelResult | null {
  const self = getElementContainer(opening);
  if (
    self === null ||
    self.parent === undefined ||
    !ts.isJsxElement(self.parent)
  ) {
    return null;
  }

  const siblings = self.parent.children.filter(
    (child): child is ts.JsxElement => ts.isJsxElement(child),
  );
  if (!ts.isJsxElement(self)) {
    return null;
  }

  const index = siblings.indexOf(self);
  if (index === -1) {
    return null;
  }

  for (let siblingIndex = index - 1; siblingIndex >= 0; siblingIndex -= 1) {
    const sibling = siblings[siblingIndex];
    if (sibling === undefined) {
      continue;
    }
    const tagName = getTagName(sibling.openingElement, sourceFile);
    if (!headingTags.has(tagName)) {
      continue;
    }
    const text = normalizeText(collectVisibleText(sibling, sourceFile));
    if (text !== "") {
      return { text, relatedSources: [] };
    }
  }

  return null;
}

function regionForOpening(
  opening: JSXOpening,
  sourceFile: ts.SourceFile,
  idLabels: Map<string, LabelInfo>,
): RegionInfo | null {
  const tagName = getTagName(opening, sourceFile);
  const role = getAttributeValue(opening, "role", sourceFile);
  const label = explicitLabelForOpening(opening, sourceFile, idLabels);
  const name = firstNonEmpty(label.text, "");

  if (role !== null && regionRoles.has(role)) {
    return { role, name: firstNonEmpty(name, role) };
  }
  if (tagName === "main") {
    return { role: "main", name: firstNonEmpty(name, "main") };
  }
  if (tagName === "section" && name !== "") {
    return { role: "region", name };
  }

  return null;
}

function resolveLabelledBy(
  value: string | null,
  idLabels: Map<string, LabelInfo>,
): LabelResult {
  if (value === null || value === "") {
    return { text: "", relatedSources: [] };
  }
  if (value.includes("{")) {
    return { text: value, relatedSources: [] };
  }

  const labels: string[] = [];
  const relatedSources: RelatedSource[] = [];
  for (const id of value.split(/\s+/)) {
    const label = idLabels.get(id);
    if (label === undefined) {
      labels.push(id);
      continue;
    }
    labels.push(label.text);
    relatedSources.push({ label: id, location: label.source });
  }

  return {
    text: labels.filter((label) => label !== "").join(" "),
    relatedSources,
  };
}

function collectVisibleText(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isJsxText(node)) {
    return node.getText(sourceFile);
  }
  if (ts.isJsxExpression(node)) {
    if (node.expression === undefined) {
      return "";
    }
    return expressionText(node.expression, sourceFile);
  }
  if (ts.isJsxElement(node)) {
    return node.children
      .map((child) => collectVisibleText(child, sourceFile))
      .join(" ");
  }
  if (ts.isJsxFragment(node)) {
    return node.children
      .map((child) => collectVisibleText(child, sourceFile))
      .join(" ");
  }
  return "";
}

function collectLabelText(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isJsxText(node)) {
    return node.getText(sourceFile);
  }
  if (ts.isJsxExpression(node)) {
    if (node.expression === undefined) {
      return "";
    }
    return expressionText(node.expression, sourceFile);
  }
  if (ts.isJsxElement(node)) {
    const tagName = getTagName(node.openingElement, sourceFile);
    if (
      tagName !== "label" &&
      (controlTags.has(tagName) || tagName === "option" || tagName === "button")
    ) {
      return "";
    }
    return node.children
      .map((child) => collectLabelText(child, sourceFile))
      .join(" ");
  }
  if (ts.isJsxFragment(node)) {
    return node.children
      .map((child) => collectLabelText(child, sourceFile))
      .join(" ");
  }
  return "";
}

function jsxAncestors(
  opening: JSXOpening,
  includeSelf: boolean,
): Array<{ opening: JSXOpening; distance: number }> {
  const ancestors: Array<{ opening: JSXOpening; distance: number }> = [];
  if (includeSelf) {
    ancestors.push({ opening, distance: 0 });
  }

  let node: ts.Node | undefined = ts.isJsxOpeningElement(opening)
    ? opening.parent?.parent
    : opening.parent;
  let distance = 1;
  while (node !== undefined) {
    if (ts.isJsxElement(node)) {
      ancestors.push({ opening: node.openingElement, distance });
      distance += 1;
    } else if (ts.isJsxSelfClosingElement(node)) {
      ancestors.push({ opening: node, distance });
      distance += 1;
    }
    node = node.parent;
  }
  return ancestors;
}

function attributesForOpening(
  opening: JSXOpening,
  sourceFile: ts.SourceFile,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) {
      continue;
    }
    const name = attribute.name.getText(sourceFile);
    attributes[name] = getAttributeValue(opening, name, sourceFile) ?? "true";
  }
  return attributes;
}

function isJsxOpeningLikeElement(node: ts.Node): node is JSXOpening {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}

function getTagName(opening: JSXOpening, sourceFile: ts.SourceFile): string {
  return opening.tagName.getText(sourceFile);
}

function isDomTag(tagName: string): boolean {
  return domTags.has(tagName) || /^[a-z]/.test(tagName);
}

function getElementContainer(opening: JSXOpening): ts.Node | null {
  if (ts.isJsxOpeningElement(opening) && ts.isJsxElement(opening.parent)) {
    return opening.parent;
  }
  if (ts.isJsxSelfClosingElement(opening)) {
    return opening;
  }
  return null;
}

function getAttribute(
  opening: JSXOpening,
  name: string,
): ts.JsxAttribute | null {
  for (const attribute of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(attribute.getSourceFile()) === name
    ) {
      return attribute;
    }
  }
  return null;
}

function getAttributeValue(
  opening: JSXOpening,
  name: string,
  sourceFile: ts.SourceFile,
): string | null {
  const attribute = getAttribute(opening, name);
  if (attribute === null) {
    return null;
  }
  if (attribute.initializer === undefined) {
    return "true";
  }
  return expressionValue(attribute.initializer, sourceFile);
}

function expressionValue(
  node: ts.JsxAttributeValue,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (!ts.isJsxExpression(node)) {
    return node.getText(sourceFile);
  }
  if (node.expression === undefined) {
    return "";
  }
  return expressionText(node.expression, sourceFile);
}

function expressionText(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  if (ts.isIdentifier(expression)) {
    return `{${expression.text}}`;
  }
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = expressionText(expression.whenTrue, sourceFile);
    const whenFalse = expressionText(expression.whenFalse, sourceFile);
    if (whenTrue !== "" && whenFalse !== "") {
      return `${whenTrue} / ${whenFalse}`;
    }
  }
  return `{${expression.getText(sourceFile)}}`;
}

function sourceLocation(
  repoRoot: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: path.relative(repoRoot, sourceFile.fileName),
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}
