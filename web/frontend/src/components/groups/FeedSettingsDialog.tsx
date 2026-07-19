import { FormEvent, useEffect, useRef, useState } from "react";

import type { DailyFeed, DailyFeedSchedule, EvidenceFormat } from "../../types";
import { datetimeLocalValue, localInputToISOString } from "../dashboard/feedDraft";

export function FeedSettingsDialog({
  feed,
  evidenceFormats,
  mutating,
  onClose,
  onToggleFeedEnabled,
  onToggleFeedCaptions,
  onChangeFeedFormat,
  onChangeFeedSchedule,
  onRefreshGeneration,
  onManageCycles,
  onManageEvents,
  onDeleteFeed,
}: {
  feed: DailyFeed;
  evidenceFormats: EvidenceFormat[];
  mutating: boolean;
  onClose: () => void;
  onToggleFeedEnabled: () => void;
  onToggleFeedCaptions: () => void;
  onChangeFeedFormat: (evidenceFormatId: string) => void;
  onChangeFeedSchedule: (schedule: DailyFeedSchedule) => void;
  onRefreshGeneration: () => void;
  onManageCycles: () => void;
  onManageEvents: () => void;
  onDeleteFeed: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const initialStartsAt = datetimeLocalValue(new Date(feed.schedule.starts_at));
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [timezone, setTimezone] = useState(feed.schedule.timezone);
  const [intervalSeconds, setIntervalSeconds] = useState(String(feed.schedule.interval_seconds));
  const [scheduleError, setScheduleError] = useState("");
  const activeFormats = evidenceFormats.filter((format) => format.archived_at === undefined);
  const formatOptions = activeFormats.some((format) => format.id === feed.evidence_format.id)
    ? activeFormats
    : [feed.evidence_format, ...activeFormats];
  const selectedTimezone = timezone.trim() || "UTC";
  const selectedIntervalSeconds = Number(intervalSeconds);
  const cycleOutputsManaged = feed.cycle_settings !== undefined && feed.cycle_settings.status !== "ended";
  const scheduleChanged =
    startsAt !== initialStartsAt ||
    selectedTimezone !== feed.schedule.timezone ||
    (Number.isFinite(selectedIntervalSeconds) && selectedIntervalSeconds !== feed.schedule.interval_seconds);
  const scheduleSubmittable =
    !cycleOutputsManaged &&
    scheduleChanged &&
    startsAt.trim() !== "" &&
    Number.isFinite(selectedIntervalSeconds) &&
    selectedIntervalSeconds >= 1;

  useEffect(() => {
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setStartsAt(datetimeLocalValue(new Date(feed.schedule.starts_at)));
    setTimezone(feed.schedule.timezone);
    setIntervalSeconds(String(feed.schedule.interval_seconds));
    setScheduleError("");
  }, [feed.id, feed.schedule.interval_seconds, feed.schedule.starts_at, feed.schedule.timezone]);

  function handleScheduleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scheduleChanged) {
      return;
    }
    if (!Number.isFinite(selectedIntervalSeconds) || selectedIntervalSeconds < 1) {
      setScheduleError("Repeat interval is invalid");
      return;
    }
    let nextStartsAt: string;
    try {
      nextStartsAt = localInputToISOString(startsAt);
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : "Start time is invalid");
      return;
    }
    if (!window.confirm("Changing cadence resets schedule-based metrics. Continue?")) {
      return;
    }
    setScheduleError("");
    onChangeFeedSchedule({
      starts_at: nextStartsAt,
      timezone: selectedTimezone,
      interval_seconds: selectedIntervalSeconds,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel feed-settings-dialog" role="dialog" aria-modal="true" aria-label="Feed settings">
        <div className="modal-header">
          <div>
            <h2>Settings</h2>
            <div className="meta">{feed.name}</div>
          </div>
          <button className="secondary" type="button" ref={closeButtonRef} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="feed-settings-grid">
          <section className="feed-settings-section" aria-label="Feed status">
            <div>
              <div className="section-title">Feed status</div>
              <div className="meta">{feed.enabled ? "Active" : "Disabled"}</div>
            </div>
            <button className="secondary" disabled={mutating} type="button" onClick={onToggleFeedEnabled}>
              {feed.enabled ? "Disable" : "Enable"}
            </button>
          </section>
          {feed.kind === "catalog_daily" ? (
            <>
              <section className="feed-settings-section" aria-label="Cycles">
                <div>
                  <div className="section-title">Cycles</div>
                  <div className="meta">
                    {feed.schedule.interval_seconds < 86400
                      ? "Cycles require a daily or slower cadence."
                      : feed.cycle_settings === undefined
                        ? "Rotate ordered configurations across generated cycles."
                        : feed.cycle_settings.status === "ended"
                          ? "Cycles ended; generated history remains available."
                          : `Configured from ${feed.cycle_settings.starts_on}.`}
                  </div>
                </div>
                <button
                  className="secondary"
                  disabled={mutating || (feed.schedule.interval_seconds < 86400 && feed.cycle_settings === undefined)}
                  type="button"
                  onClick={onManageCycles}
                >
                  Manage
                </button>
              </section>
              {!cycleOutputsManaged ? (
                <section className="feed-settings-section" aria-label="Current generation">
                  <div>
                    <div className="section-title">Current generation</div>
                    <div className="meta">Reroll today's generated items.</div>
                  </div>
                  <button className="secondary" disabled={mutating} type="button" onClick={onRefreshGeneration}>
                    Refresh
                  </button>
                </section>
              ) : null}
              {feed.cycle_settings === undefined ? (
                <section className="feed-settings-section" aria-label="Events">
                  <div>
                    <div className="section-title">Events</div>
                    <div className="meta">Schedule temporary item counts and filters.</div>
                  </div>
                  <button className="secondary" disabled={mutating} type="button" onClick={onManageEvents}>
                    Manage
                  </button>
                </section>
              ) : null}
            </>
          ) : null}
          <section className="feed-settings-section feed-format-section" aria-label="Post format">
            <div>
              <div className="section-title">Post format</div>
              <div className="meta">{evidenceFormatSummary(feed.evidence_format)}</div>
            </div>
            <label className="feed-format-select-label">
              Format
              <select
                disabled={mutating || activeFormats.length === 0}
                value={feed.evidence_format.id}
                onChange={(event) => onChangeFeedFormat(event.target.value)}
              >
                {formatOptions.map((format) => (
                  <option disabled={format.archived_at !== undefined} key={format.id} value={format.id}>
                    {format.name}
                    {format.archived_at !== undefined ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="feed-settings-section" aria-label="Captions">
            <div>
              <div className="section-title">Captions</div>
              <div className="meta">{feed.captions_enabled ? "Available on posts" : "Unavailable on posts"}</div>
            </div>
            <button className="secondary" disabled={mutating} type="button" onClick={onToggleFeedCaptions}>
              {feed.captions_enabled ? "Disable captions" : "Enable captions"}
            </button>
          </section>
          <section className="feed-settings-section feed-schedule-section" aria-label="Cadence">
            <div>
              <div className="section-title">Cadence</div>
              <div className="meta">
                {intervalLabel(feed.schedule.interval_seconds)}
                {cycleOutputsManaged ? " · Managed by cycle settings" : ""}
              </div>
            </div>
            <form className="feed-schedule-form" onSubmit={handleScheduleSubmit}>
              <label className="feed-format-select-label">
                Start time
                <input
                  disabled={mutating || cycleOutputsManaged}
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => {
                    setStartsAt(event.target.value);
                    setScheduleError("");
                  }}
                />
              </label>
              <label className="feed-format-select-label">
                Timezone
                <input
                  disabled={mutating || cycleOutputsManaged}
                  value={timezone}
                  onChange={(event) => {
                    setTimezone(event.target.value);
                    setScheduleError("");
                  }}
                />
              </label>
              <label className="feed-format-select-label">
                Repeat
                <select
                  disabled={mutating || cycleOutputsManaged}
                  value={intervalSeconds}
                  onChange={(event) => {
                    setIntervalSeconds(event.target.value);
                    setScheduleError("");
                  }}
                >
                  <option value="86400">Daily</option>
                  <option value="604800">Weekly</option>
                  <option value="3600">Hourly</option>
                </select>
              </label>
              <button className="secondary" disabled={mutating || !scheduleSubmittable} type="submit">
                Save
              </button>
              {scheduleError ? (
                <div className="form-error" role="alert">
                  {scheduleError}
                </div>
              ) : null}
            </form>
          </section>
          <section className="feed-settings-section" aria-label="Delete feed">
            <div>
              <div className="section-title">Delete feed</div>
              <div className="meta">Remove {feed.name}.</div>
            </div>
            <button className="danger" disabled={mutating} type="button" onClick={onDeleteFeed}>
              Delete
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}

function evidenceFormatSummary(format: EvidenceFormat): string {
  return `${format.name} · v${format.active_version.version_number}`;
}

function intervalLabel(seconds: number): string {
  switch (seconds) {
    case 3600:
      return "Hourly";
    case 604800:
      return "Weekly";
    case 86400:
      return "Daily";
    default:
      return `${seconds} seconds`;
  }
}
