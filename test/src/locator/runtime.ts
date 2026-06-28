import type { Page } from "@playwright/test";

import type { RuntimeCandidate } from "./types";

type PlaywrightRole = Parameters<Page["getByRole"]>[0];

const runtimeRoles = [
  "main",
  "region",
  "dialog",
  "alert",
  "status",
  "button",
  "link",
  "tab",
  "checkbox",
  "combobox",
  "textbox",
  "heading",
  "form",
  "list",
  "listitem",
] satisfies PlaywrightRole[];

type ElementMetadata = {
  role: string;
  tagName: string;
  name: string;
  text: string;
  regionPath: string[];
  enabled?: boolean;
  pressed?: boolean;
};

export async function collectRuntimeCandidates(
  page: Page,
): Promise<RuntimeCandidate[]> {
  const candidates: RuntimeCandidate[] = [];
  const seen = new Set<string>();

  for (const role of runtimeRoles) {
    const roleLocator = page.getByRole(role);
    const count = await roleLocator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const locator = roleLocator.nth(index);
      const metadata = await locator
        .evaluate(
          (element, payload) => {
            const collect = (0, eval)(payload.script);
            return collect(element, payload.role) as ElementMetadata;
          },
          { role, script: metadataScript },
        )
        .catch((error: unknown) => {
          if (process.env.LOCATOR_DEBUG_RUNTIME === "1") {
            process.stderr.write(
              `runtime metadata failed for role ${role}: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
          return null;
        });
      if (metadata === null) {
        continue;
      }

      const visible = await locator.isVisible().catch(() => false);
      const bounds = visible
        ? await locator.boundingBox().catch(() => null)
        : null;
      const key = [
        metadata.role,
        metadata.name,
        metadata.text,
        metadata.regionPath.join(">"),
        bounds === null
          ? "no-box"
          : `${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}`,
      ].join("|");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      if (
        metadata.name === "" &&
        metadata.text === "" &&
        metadata.regionPath.length === 0
      ) {
        continue;
      }

      candidates.push({
        id: `${metadata.role}:${candidates.length + 1}`,
        kind: "runtime",
        role: metadata.role,
        tagName: metadata.tagName,
        name: metadata.name,
        text: metadata.text,
        regionPath: metadata.regionPath,
        visible,
        ...(metadata.enabled === undefined
          ? {}
          : { enabled: metadata.enabled }),
        ...(metadata.pressed === undefined
          ? {}
          : { pressed: metadata.pressed }),
        ...(bounds === null
          ? {}
          : {
              bounds: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              },
            }),
        locator,
      });
    }
  }

  return candidates;
}

const metadataScript = String.raw`((element, requestedRole) => {
  function normalizedText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function accessibleName(target) {
    const explicitName = explicitAccessibleName(target);
    if (explicitName !== "") {
      return explicitName;
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement ||
      (typeof HTMLMeterElement !== "undefined" && target instanceof HTMLMeterElement) ||
      (typeof HTMLOutputElement !== "undefined" && target instanceof HTMLOutputElement) ||
      (typeof HTMLProgressElement !== "undefined" && target instanceof HTMLProgressElement)
    ) {
      const labelText = Array.from(target.labels ?? [])
        .map(textForLabel)
        .filter((label) => label !== "")
        .join(" ");
      if (labelText !== "") {
        return labelText;
      }
    }

    const wrappedLabel = target.closest("label");
    if (wrappedLabel !== null) {
      const text = textForLabel(wrappedLabel);
      if (text !== "") {
        return text;
      }
    }

    if (target instanceof HTMLImageElement && target.alt.trim() !== "") {
      return normalizedText(target.alt);
    }

    const title = target.getAttribute("title");
    if (title !== null && title.trim() !== "") {
      return normalizedText(title);
    }

    return normalizedText(target.textContent ?? "");
  }

  function textForLabel(label) {
    const clone = label.cloneNode(true);
    clone
      .querySelectorAll("input, select, textarea, button, option")
      .forEach((control) => control.remove());
    return normalizedText(clone.textContent ?? "");
  }

  function explicitAccessibleName(target) {
    const ariaLabel = target.getAttribute("aria-label");
    if (ariaLabel !== null && ariaLabel.trim() !== "") {
      return normalizedText(ariaLabel);
    }

    const labelledBy = target.getAttribute("aria-labelledby");
    if (labelledBy !== null && labelledBy.trim() !== "") {
      const labels = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? id)
        .map(normalizedText)
        .filter((label) => label !== "");
      if (labels.length > 0) {
        return labels.join(" ");
      }
    }

    return "";
  }

  function computedRole(target, fallbackRole) {
    const explicitRole = target.getAttribute("role")?.trim().split(/\s+/)[0];
    if (
      explicitRole !== undefined &&
      explicitRole !== "" &&
      explicitRole !== "none" &&
      explicitRole !== "presentation"
    ) {
      return explicitRole;
    }

    const targetTagName = target.tagName.toLowerCase();
    if (targetTagName === "main") {
      return "main";
    }
    if (targetTagName === "section" && accessibleName(target) !== "") {
      return "region";
    }
    if (targetTagName === "button") {
      return "button";
    }
    if (targetTagName === "a" && target.hasAttribute("href")) {
      return "link";
    }
    if (targetTagName === "select") {
      return "combobox";
    }
    if (targetTagName === "textarea") {
      return "textbox";
    }
    if (targetTagName === "input") {
      const type = (target.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "button" || type === "submit" || type === "reset") {
        return "button";
      }
      return "textbox";
    }
    if (/^h[1-6]$/.test(targetTagName)) {
      return "heading";
    }
    if (targetTagName === "form" && accessibleName(target) !== "") {
      return "form";
    }
    if (targetTagName === "ul" || targetTagName === "ol") {
      return "list";
    }
    if (targetTagName === "li") {
      return "listitem";
    }

    return fallbackRole;
  }

  function regionName(target) {
    const targetRole = target.getAttribute("role");
    const targetTagName = target.tagName.toLowerCase();
    if (
      targetRole === "region" ||
      targetRole === "dialog" ||
      targetRole === "main" ||
      targetRole === "alert" ||
      targetRole === "status"
    ) {
      return explicitAccessibleName(target) || targetRole;
    }
    if (targetTagName === "main") {
      return explicitAccessibleName(target) || "main";
    }
    if (targetTagName === "section") {
      const targetName = explicitAccessibleName(target);
      return targetName === "" ? null : targetName;
    }
    return null;
  }

  function regionPathForElement(target) {
    const names = [];
    let current = target;
    while (current !== null) {
      const region = regionName(current);
      if (region !== null && !names.includes(region)) {
        names.push(region);
      }
      current = current.parentElement;
    }
    return names.reverse();
  }

  const role = computedRole(element, requestedRole);
  const tagName = element.tagName.toLowerCase();
  const name = accessibleName(element);
  const text = normalizedText(element.textContent ?? "");
  const enabled =
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? !element.disabled
      : undefined;
  const ariaPressed = element.getAttribute("aria-pressed");
  const pressed =
    ariaPressed === null
      ? undefined
      : ariaPressed === "true"
        ? true
        : ariaPressed === "false"
          ? false
          : undefined;

  return {
    role,
    tagName,
    name,
    text,
    regionPath: regionPathForElement(element),
    ...(enabled === undefined ? {} : { enabled }),
    ...(pressed === undefined ? {} : { pressed }),
  };
})`;
