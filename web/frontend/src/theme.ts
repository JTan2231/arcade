import { useSyncExternalStore } from "react";

import type { ThemePreference } from "./types";
import { defaultCardPaletteTokens } from "./palette/cardPalette";
import { installCssTokens } from "./palette/bridge";
import { assertPaletteValid } from "./palette/render";
import {
  getThemeProfile,
  setActiveThemeProfileMode,
  type ThemeMode,
  type ThemeProfileId,
} from "./palette/themeProfiles";

export type ViewerThemePreference = ThemePreference;

type ViewerThemeSnapshot = Readonly<{
  preference: ViewerThemePreference;
  profileId: ThemeProfileId;
  resolvedTheme: ThemeMode;
}>;

const viewerThemeStorageKey = "arcade.viewer-theme";
const defaultViewerThemePreference: ViewerThemePreference = "system";

const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;
let mediaQueryListening = false;
let storageListening = false;
let initialized = false;
let snapshot: ViewerThemeSnapshot = Object.freeze({
  preference: defaultViewerThemePreference,
  profileId: "arcade-dark-v1",
  resolvedTheme: "dark",
});

function isViewerThemePreference(value: unknown): value is ViewerThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  mediaQuery ??= window.matchMedia("(prefers-color-scheme: light)");
  return mediaQuery.matches ? "light" : "dark";
}

function resolveViewerTheme(preference: ViewerThemePreference): ThemeMode {
  return preference === "system" ? getSystemTheme() : preference;
}

function installResolvedTheme(preference: ViewerThemePreference, resolvedTheme: ThemeMode) {
  const profile = getThemeProfile(resolvedTheme);
  assertPaletteValid(profile.palette.validation);
  setActiveThemeProfileMode(resolvedTheme);

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    installCssTokens(profile.palette.tokens, root);
    installCssTokens(defaultCardPaletteTokens(resolvedTheme), root);
    root.dataset["theme"] = resolvedTheme;
    root.dataset["themeProfile"] = profile.id;
    root.style.colorScheme = profile.colorScheme;
  }

  const next = Object.freeze({ preference, profileId: profile.id, resolvedTheme });
  if (
    snapshot.preference === next.preference &&
    snapshot.profileId === next.profileId &&
    snapshot.resolvedTheme === next.resolvedTheme
  ) {
    return snapshot;
  }

  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("arcade:themechange", { detail: snapshot }));
  }
  return snapshot;
}

function handleSystemThemeChange() {
  if (snapshot.preference === "system") {
    installResolvedTheme("system", getSystemTheme());
  }
}

function handleStoredThemeChange(event: StorageEvent) {
  if (event.key !== viewerThemeStorageKey) {
    return;
  }
  const preference = isViewerThemePreference(event.newValue) ? event.newValue : defaultViewerThemePreference;
  updateMediaQuerySubscription(preference);
  installResolvedTheme(preference, resolveViewerTheme(preference));
}

function updateStorageSubscription() {
  if (typeof window === "undefined" || storageListening) {
    return;
  }
  window.addEventListener("storage", handleStoredThemeChange);
  storageListening = true;
}

function updateMediaQuerySubscription(preference: ViewerThemePreference) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  mediaQuery ??= window.matchMedia("(prefers-color-scheme: light)");
  if (preference === "system" && !mediaQueryListening) {
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    mediaQueryListening = true;
  } else if (preference !== "system" && mediaQueryListening) {
    mediaQuery.removeEventListener("change", handleSystemThemeChange);
    mediaQueryListening = false;
  }
}

function readStoredViewerThemePreference(): ViewerThemePreference {
  if (typeof window === "undefined") {
    return defaultViewerThemePreference;
  }
  try {
    const value = window.localStorage.getItem(viewerThemeStorageKey);
    return isViewerThemePreference(value) ? value : defaultViewerThemePreference;
  } catch {
    return defaultViewerThemePreference;
  }
}

function storeViewerThemePreference(preference: ViewerThemePreference) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(viewerThemeStorageKey, preference);
  } catch {
    // Theme selection remains active for the current page when storage is unavailable.
  }
}

export function initializeViewerTheme() {
  const preference = readStoredViewerThemePreference();
  initialized = true;
  updateStorageSubscription();
  updateMediaQuerySubscription(preference);
  return installResolvedTheme(preference, resolveViewerTheme(preference));
}

export function applyViewerThemePreference(preference: ViewerThemePreference) {
  if (!isViewerThemePreference(preference)) {
    throw new Error(`Unsupported viewer theme preference ${JSON.stringify(preference)}`);
  }
  initialized = true;
  storeViewerThemePreference(preference);
  updateMediaQuerySubscription(preference);
  return installResolvedTheme(preference, resolveViewerTheme(preference));
}

function getViewerThemeSnapshot() {
  if (!initialized) {
    return initializeViewerTheme();
  }
  return snapshot;
}

function subscribeViewerTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewerTheme() {
  return useSyncExternalStore(subscribeViewerTheme, getViewerThemeSnapshot, () => snapshot);
}
