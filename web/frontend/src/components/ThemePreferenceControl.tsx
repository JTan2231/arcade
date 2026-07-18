import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { updateThemePreference } from "../api";
import { applyViewerThemePreference, useViewerTheme, type ViewerThemePreference } from "../theme";
import type { User } from "../types";

export function ThemePreferenceControl({
  currentUser,
  disabled = false,
  onError,
  onUserUpdated,
}: {
  currentUser: User | null;
  disabled?: boolean;
  onError: (message: string) => void;
  onUserUpdated: (user: User) => void;
}) {
  const theme = useViewerTheme();
  const [saving, setSaving] = useState(false);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    requestSequenceRef.current += 1;
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [currentUser?.id]);

  async function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const preference = event.target.value as ViewerThemePreference;
    applyViewerThemePreference(preference);
    if (currentUser === null) {
      return;
    }

    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setSaving(true);
    try {
      const updated = await updateThemePreference(preference);
      if (requestSequenceRef.current === sequence) {
        onUserUpdated(updated);
      }
    } catch (error: unknown) {
      if (requestSequenceRef.current === sequence) {
        applyViewerThemePreference(currentUser.theme_preference);
        onError(error instanceof Error ? error.message : "Could not save theme preference");
      }
    } finally {
      if (requestSequenceRef.current === sequence) {
        setSaving(false);
      }
    }
  }

  return (
    <div className={`theme-preference-control ${currentUser === null ? "signed-out" : "signed-in"}`}>
      <label>
        <span className="visually-hidden">Theme</span>
        <select
          aria-label="Theme"
          disabled={disabled || saving}
          title="Theme"
          value={theme.preference}
          onChange={(event) => {
            void handleChange(event);
          }}
        >
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
    </div>
  );
}
