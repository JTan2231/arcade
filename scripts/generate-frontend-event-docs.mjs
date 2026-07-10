import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const frontendRoot = process.cwd();
const require = createRequire(path.join(frontendRoot, "package.json"));
const ts = require("typescript");
const repoRoot = path.resolve(frontendRoot, "../..");
const sourceRoot = path.join(frontendRoot, "src");
const outputPath = path.join(repoRoot, "docs/generated/frontend-event-handlers.md");

const regionRoles = new Set(["alert", "dialog", "main", "region", "status"]);
const domTags = new Set([
  "a",
  "button",
  "details",
  "dialog",
  "div",
  "form",
  "input",
  "label",
  "main",
  "section",
  "select",
  "summary",
  "textarea",
]);
const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const controlTags = new Set(["input", "select", "textarea"]);
const clickableTextTags = new Set(["a", "button", "summary"]);

const entries = [];

for (const filePath of listFiles(sourceRoot).filter((candidate) => candidate.endsWith(".tsx")).sort()) {
  const text = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const idLabels = collectIdLabels(sourceFile);

  visit(sourceFile, (node) => {
    if (!isJsxOpeningLikeElement(node)) {
      return;
    }

    const tag = getTagName(node, sourceFile);
    for (const attribute of node.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) {
        continue;
      }

      const handler = attribute.name.text;
      if (!/^on[A-Z]/.test(handler)) {
        continue;
      }

      const line = sourceFile.getLineAndCharacterOfPosition(attribute.name.getStart(sourceFile)).line + 1;
      const region = findNearestRegion(node, sourceFile, idLabels);
      const label = findNearestLabel(node, sourceFile, idLabels, region);

      entries.push({
        handler,
        targetKind: isDomTag(tag) ? "DOM" : "Component",
        element: tag,
        region,
        label,
        sourcePath: path.relative(repoRoot, filePath),
        line,
      });
    }
  });
}

entries.sort(compareEntries);
writeMarkdown(entries);

function listFiles(dir) {
  const results = [];
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

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function collectIdLabels(sourceFile) {
  const labels = new Map();
  visit(sourceFile, (node) => {
    if (!isJsxOpeningLikeElement(node)) {
      return;
    }
    const id = getAttributeValue(node, "id", sourceFile);
    if (id === null || /[{}\s]/.test(id)) {
      return;
    }

    const element = getElementContainer(node);
    const text = element === null ? "" : normalizeText(collectVisibleText(element, sourceFile));
    if (text !== "") {
      labels.set(id, text);
    }
  });
  return labels;
}

function isJsxOpeningLikeElement(node) {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}

function getTagName(node, sourceFile) {
  return node.tagName.getText(sourceFile);
}

function isDomTag(tag) {
  return domTags.has(tag) || /^[a-z]/.test(tag);
}

function getElementContainer(opening) {
  if (ts.isJsxOpeningElement(opening) && ts.isJsxElement(opening.parent)) {
    return opening.parent;
  }
  if (ts.isJsxSelfClosingElement(opening)) {
    return opening;
  }
  return null;
}

function getAttribute(opening, name) {
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.text === name) {
      return attribute;
    }
  }
  return null;
}

function getAttributeValue(opening, name, sourceFile) {
  const attribute = getAttribute(opening, name);
  if (attribute === null) {
    return null;
  }
  if (attribute.initializer === undefined) {
    return "true";
  }
  return expressionValue(attribute.initializer, sourceFile);
}

function expressionValue(node, sourceFile) {
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

function expressionText(expression, sourceFile) {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
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

function findNearestRegion(opening, sourceFile, idLabels) {
  for (const ancestor of jsxAncestors(opening, true)) {
    const candidate = regionForOpening(ancestor.opening, sourceFile, idLabels);
    if (candidate !== null) {
      return {
        name: candidate.name,
        relationship: `${relationshipName(ancestor.distance)} ${candidate.relationship} (distance ${ancestor.distance})`,
      };
    }
  }
  return {
    name: "unknown",
    relationship: "no enclosing accessible region",
  };
}

function regionForOpening(opening, sourceFile, idLabels) {
  const tag = getTagName(opening, sourceFile);
  const role = getAttributeValue(opening, "role", sourceFile);
  const ariaLabel = getAttributeValue(opening, "aria-label", sourceFile);
  const labelledBy = getAttributeValue(opening, "aria-labelledby", sourceFile);
  const labelledByText = resolveLabelledBy(labelledBy, idLabels);

  if (role !== null && regionRoles.has(role)) {
    return {
      name: firstNonEmpty(ariaLabel, labelledByText, role),
      relationship: `role ${role}`,
    };
  }
  if (tag === "main") {
    return {
      name: firstNonEmpty(ariaLabel, labelledByText, "main"),
      relationship: "main landmark",
    };
  }
  if (tag === "section" && firstNonEmpty(ariaLabel, labelledByText, "") !== "") {
    return {
      name: firstNonEmpty(ariaLabel, labelledByText, "section"),
      relationship: "section label",
    };
  }
  return null;
}

function findNearestLabel(opening, sourceFile, idLabels, region) {
  const ownAriaLabel = getAttributeValue(opening, "aria-label", sourceFile);
  if (ownAriaLabel !== null && ownAriaLabel !== "") {
    return {
      text: ownAriaLabel,
      relationship: "self aria-label (distance 0)",
    };
  }

  const ownLabelledBy = resolveLabelledBy(getAttributeValue(opening, "aria-labelledby", sourceFile), idLabels);
  if (ownLabelledBy !== null && ownLabelledBy !== "") {
    return {
      text: ownLabelledBy,
      relationship: "self aria-labelledby (distance 0)",
    };
  }

  const tag = getTagName(opening, sourceFile);
  if (!isDomTag(tag)) {
    const propLabel = firstNonEmpty(
      getAttributeValue(opening, "label", sourceFile),
      getAttributeValue(opening, "title", sourceFile),
      null,
    );
    if (propLabel !== null && propLabel !== "") {
      return {
        text: propLabel,
        relationship: "component prop label (distance 0)",
      };
    }
  }

  const container = getElementContainer(opening);
  if (container !== null && clickableTextTags.has(tag)) {
    const text = normalizeText(collectVisibleText(container, sourceFile));
    if (text !== "") {
      return {
        text,
        relationship: "self text (distance 0)",
      };
    }
  }

  if (controlTags.has(tag)) {
    const wrappingLabel = findWrappingLabel(opening, sourceFile);
    if (wrappingLabel !== null) {
      return wrappingLabel;
    }
  }

  const siblingHeading = findNearestSiblingHeading(opening, sourceFile);
  if (siblingHeading !== null) {
    return siblingHeading;
  }

  if (region.name !== "unknown") {
    return {
      text: region.name,
      relationship: `region fallback (${region.relationship})`,
    };
  }

  return {
    text: "unknown",
    relationship: "no nearby accessible label",
  };
}

function findWrappingLabel(opening, sourceFile) {
  for (const ancestor of jsxAncestors(opening, false)) {
    const tag = getTagName(ancestor.opening, sourceFile);
    if (tag !== "label") {
      continue;
    }
    const container = getElementContainer(ancestor.opening);
    const text = container === null ? "" : normalizeText(collectLabelText(container, sourceFile));
    if (text !== "") {
      return {
        text,
        relationship: `${relationshipName(ancestor.distance)} label (distance ${ancestor.distance})`,
      };
    }
  }
  return null;
}

function findNearestSiblingHeading(opening, sourceFile) {
  const self = getElementContainer(opening);
  if (self === null || self.parent === undefined || !ts.isJsxElement(self.parent)) {
    return null;
  }

  const siblings = self.parent.children.filter((child) => ts.isJsxElement(child));
  const index = siblings.indexOf(self);
  if (index === -1) {
    return null;
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    const sibling = siblings[i];
    const tag = getTagName(sibling.openingElement, sourceFile);
    if (!headingTags.has(tag)) {
      continue;
    }
    const text = normalizeText(collectVisibleText(sibling, sourceFile));
    if (text !== "") {
      return {
        text,
        relationship: `previous sibling ${tag}`,
      };
    }
  }

  return null;
}

function resolveLabelledBy(value, idLabels) {
  if (value === null || value === "") {
    return null;
  }
  if (value.includes("{")) {
    return value;
  }
  const pieces = value
    .split(/\s+/)
    .map((id) => idLabels.get(id) ?? id)
    .filter((label) => label !== "");
  return pieces.length === 0 ? null : pieces.join(" ");
}

function collectVisibleText(node, sourceFile) {
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
    return node.children.map((child) => collectVisibleText(child, sourceFile)).join(" ");
  }
  if (ts.isJsxFragment(node)) {
    return node.children.map((child) => collectVisibleText(child, sourceFile)).join(" ");
  }
  return "";
}

function collectLabelText(node, sourceFile) {
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
    const tag = getTagName(node.openingElement, sourceFile);
    if (tag !== "label" && (controlTags.has(tag) || tag === "option" || tag === "button")) {
      return "";
    }
    return node.children.map((child) => collectLabelText(child, sourceFile)).join(" ");
  }
  if (ts.isJsxFragment(node)) {
    return node.children.map((child) => collectLabelText(child, sourceFile)).join(" ");
  }
  return "";
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function jsxAncestors(opening, includeSelf) {
  const ancestors = [];
  if (includeSelf) {
    ancestors.push({ opening, distance: 0 });
  }

  let node = ts.isJsxOpeningElement(opening) ? opening.parent?.parent : opening.parent;
  let distance = includeSelf ? 1 : 1;
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

function relationshipName(distance) {
  if (distance === 0) {
    return "self";
  }
  if (distance === 1) {
    return "parent";
  }
  if (distance === 2) {
    return "grandparent";
  }
  return "ancestor";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}

function compareEntries(left, right) {
  return (
    left.handler.localeCompare(right.handler) ||
    left.region.name.localeCompare(right.region.name) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.element.localeCompare(right.element)
  );
}

function writeMarkdown(allEntries) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const lines = [
    "# Frontend Event Handler Inventory",
    "",
    "Generated by `scripts/generate-frontend-event-docs.sh`. Do not hand-edit.",
    "",
    "This is a static JSX inventory. It records JSX attributes whose names start with `on`, including native DOM handlers and component callback props. Region and label detection is best-effort and local to the file; it does not expand child component render trees.",
    "",
  ];

  const handlers = [...new Set(allEntries.map((entry) => entry.handler))].sort();
  for (const handler of handlers) {
    const handlerEntries = allEntries.filter((entry) => entry.handler === handler);
    lines.push(`## ${handler}`, "");
    lines.push(`Found ${handlerEntries.length} occurrence${handlerEntries.length === 1 ? "" : "s"}.`, "");
    lines.push("| Region | Region relationship | Nearest label | Label relationship | Target | Source |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const entry of handlerEntries) {
      lines.push(
        [
          md(entry.region.name),
          md(entry.region.relationship),
          md(entry.label.text),
          md(entry.label.relationship),
          md(`${entry.targetKind} <${entry.element}>`),
          sourceLink(entry),
        ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
      );
    }
    lines.push("");
  }

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

function md(value) {
  return String(value)
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sourceLink(entry) {
  const href = `../../${entry.sourcePath}#L${entry.line}`;
  const label = `${entry.sourcePath}:${entry.line}`;
  return `[${md(label)}](${href})`;
}
