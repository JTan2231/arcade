import { FormEvent, useEffect, useRef, useState } from "react";

import type { DailyFeed, DailyFeedSchedule, EvidenceFormat, Group } from "../types";
import { RowActionMenu, type RowAction } from "./RowActionMenu";

export type GroupsPanelProps = {
  groups: Group[];
  feeds: DailyFeed[];
  evidenceFormats: EvidenceFormat[];
  selectedGroupId: string | null;
  selectedFeedId: string | null;
  loading: boolean;
  feedsLoading: boolean;
  feedsError: string;
  creating: boolean;
  deletingGroupId: string | null;
  pendingToggleFeedId: string | null;
  pendingFeedFormatFeedId: string | null;
  pendingFeedScheduleFeedId: string | null;
  pendingRefreshFeedId: string | null;
  pendingDeleteFeedId: string | null;
  onCreateGroup: (name: string) => void;
  onSelectGroup: (id: string) => void;
  onOpenGroupSettings: (id: string) => void;
  onDeleteGroup: (id: string) => void;
  onSelectFeed: (id: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onChangeFeedFormat: (feedId: string, evidenceFormatId: string) => void;
  onChangeFeedSchedule: (feedId: string, schedule: DailyFeedSchedule) => void;
  onRefreshFeedGeneration: (id: string) => void;
  onCopyPublicFeedLink: (id: string) => void;
  onDeleteFeed: (id: string) => void;
  onAddFeed: () => void;
};

export function GroupsPanel({
  groups,
  feeds,
  evidenceFormats,
  selectedGroupId,
  selectedFeedId,
  loading,
  feedsLoading,
  feedsError,
  creating,
  deletingGroupId,
  pendingToggleFeedId,
  pendingFeedFormatFeedId,
  pendingFeedScheduleFeedId,
  pendingRefreshFeedId,
  pendingDeleteFeedId,
  onCreateGroup,
  onSelectGroup,
  onOpenGroupSettings,
  onDeleteGroup,
  onSelectFeed,
  onToggleFeedEnabled,
  onChangeFeedFormat,
  onChangeFeedSchedule,
  onRefreshFeedGeneration,
  onCopyPublicFeedLink,
  onDeleteFeed,
  onAddFeed,
}: GroupsPanelProps) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) {
      inputRef.current?.focus();
    }
  }, [adding]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    onCreateGroup(trimmed);
    setName("");
    setAdding(false);
  }

  return (
    <section className="groups-panel" aria-labelledby="groups-title">
      <div className="panel-header groups-panel-header">
        <h2 id="groups-title">Groups</h2>
        {adding ? (
          <form className="group-add-form" onSubmit={handleSubmit}>
            <input
              aria-label="New group name"
              disabled={creating}
              placeholder="New group"
              ref={inputRef}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAdding(false);
                  setName("");
                }
              }}
            />
            <button
              aria-label="Create group"
              className="icon-button confirm-icon-button"
              type="submit"
              disabled={creating}
            >
              <span aria-hidden="true">✓</span>
            </button>
          </form>
        ) : (
          <button
            aria-label="Add group"
            className="icon-button group-add-button"
            type="button"
            disabled={creating}
            onClick={() => setAdding(true)}
          >
            <span aria-hidden="true">+</span>
          </button>
        )}
      </div>

      <div className="group-tree">
        {loading ? (
          <div className="meta">Loading groups...</div>
        ) : groups.length ? (
          groups.map((group) => {
            const selected = group.id === selectedGroupId;
            const actions = groupActions(group, deletingGroupId, onOpenGroupSettings, onDeleteGroup);

            return (
              <div className="group-tree-node" key={group.id}>
                <div className={`row action-row nav-row group-row ${selected ? "selected-row" : ""}`}>
                  <button
                    aria-pressed={selected}
                    className="row-select-button nav-select-button group-select-button"
                    type="button"
                    aria-label={group.name}
                    onClick={() => onSelectGroup(group.id)}
                  >
                    <div className="title">{group.name}</div>
                  </button>
                  {actions.length > 0 ? (
                    <RowActionMenu label={`Group settings for ${group.name}`} actions={actions} />
                  ) : null}
                </div>
                {selected ? (
                  <FeedSublist
                    feeds={feeds}
                    evidenceFormats={evidenceFormats}
                    loading={feedsLoading}
                    error={feedsError}
                    manage={canManageGroup(group)}
                    selectedFeedId={selectedFeedId}
                    pendingToggleFeedId={pendingToggleFeedId}
                    pendingFeedFormatFeedId={pendingFeedFormatFeedId}
                    pendingFeedScheduleFeedId={pendingFeedScheduleFeedId}
                    pendingRefreshFeedId={pendingRefreshFeedId}
                    pendingDeleteFeedId={pendingDeleteFeedId}
                    publicLinksAvailable={group.visibility === "public"}
                    onSelectFeed={onSelectFeed}
                    onToggleFeedEnabled={onToggleFeedEnabled}
                    onChangeFeedFormat={onChangeFeedFormat}
                    onChangeFeedSchedule={onChangeFeedSchedule}
                    onRefreshFeedGeneration={onRefreshFeedGeneration}
                    onCopyPublicFeedLink={onCopyPublicFeedLink}
                    onDeleteFeed={onDeleteFeed}
                    onAddFeed={onAddFeed}
                  />
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="meta">No groups yet</div>
        )}
      </div>
    </section>
  );
}

function FeedSublist({
  feeds,
  evidenceFormats,
  loading,
  error,
  manage,
  selectedFeedId,
  pendingToggleFeedId,
  pendingFeedFormatFeedId,
  pendingFeedScheduleFeedId,
  pendingRefreshFeedId,
  pendingDeleteFeedId,
  publicLinksAvailable,
  onSelectFeed,
  onToggleFeedEnabled,
  onChangeFeedFormat,
  onChangeFeedSchedule,
  onRefreshFeedGeneration,
  onCopyPublicFeedLink,
  onDeleteFeed,
  onAddFeed,
}: {
  feeds: DailyFeed[];
  evidenceFormats: EvidenceFormat[];
  loading: boolean;
  error: string;
  manage: boolean;
  selectedFeedId: string | null;
  pendingToggleFeedId: string | null;
  pendingFeedFormatFeedId: string | null;
  pendingFeedScheduleFeedId: string | null;
  pendingRefreshFeedId: string | null;
  pendingDeleteFeedId: string | null;
  publicLinksAvailable: boolean;
  onSelectFeed: (id: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onChangeFeedFormat: (feedId: string, evidenceFormatId: string) => void;
  onChangeFeedSchedule: (feedId: string, schedule: DailyFeedSchedule) => void;
  onRefreshFeedGeneration: (id: string) => void;
  onCopyPublicFeedLink: (id: string) => void;
  onDeleteFeed: (id: string) => void;
  onAddFeed: () => void;
}) {
  const [settingsFeedId, setSettingsFeedId] = useState<string | null>(null);

  useEffect(() => {
    if (settingsFeedId !== null && !feeds.some((feed) => feed.id === settingsFeedId)) {
      setSettingsFeedId(null);
    }
  }, [feeds, settingsFeedId]);

  if (loading) {
    return (
      <section className="feed-sublist" aria-label="Feeds">
        <div className="feed-branch feed-sublist-status">
          <div className="meta">Loading feeds...</div>
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="feed-sublist" aria-label="Feeds">
        <div className="feed-branch feed-sublist-status">
          <div className="form-error" role="alert">
            {error}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="feed-sublist" aria-label="Feeds">
      {!feeds.length ? (
        <div className="feed-branch feed-sublist-status">
          <div className="meta">{manage ? "No feeds yet." : "No feeds are available for this group."}</div>
        </div>
      ) : null}
      {feeds.map((feed) => {
        const selected = feed.id === selectedFeedId;
        const mutating =
          pendingToggleFeedId === feed.id ||
          pendingFeedFormatFeedId === feed.id ||
          pendingFeedScheduleFeedId === feed.id ||
          pendingRefreshFeedId === feed.id ||
          pendingDeleteFeedId === feed.id;
        const copyPublicLinkAction: RowAction | null =
          publicLinksAvailable && feed.enabled
            ? {
                label: "Copy link",
                disabled: mutating,
                onSelect: () => onCopyPublicFeedLink(feed.id),
              }
            : null;
        const actions: RowAction[] = manage
          ? [
              {
                label: "Settings",
                disabled: mutating,
                onSelect: () => setSettingsFeedId(feed.id),
              },
              ...(copyPublicLinkAction === null ? [] : [copyPublicLinkAction]),
            ]
          : copyPublicLinkAction === null
            ? []
            : [copyPublicLinkAction];

        return (
          <div className="feed-branch" key={feed.id}>
            <div className={`row action-row nav-row feed-row ${selected ? "selected-row" : ""}`}>
              <button
                aria-pressed={selected}
                className="row-select-button nav-select-button feed-select-button"
                type="button"
                aria-label={feed.name}
                onClick={() => onSelectFeed(feed.id)}
              >
                <div className="title">{feed.name}</div>
                <div className="meta">{!feed.enabled ? "Disabled" : ""}</div>
              </button>
              {actions.length > 0 ? <RowActionMenu label={`Feed settings for ${feed.name}`} actions={actions} /> : null}
            </div>
            {settingsFeedId === feed.id ? (
              <FeedSettingsDialog
                feed={feed}
                evidenceFormats={evidenceFormats}
                mutating={mutating}
                onClose={() => setSettingsFeedId(null)}
                onDeleteFeed={() => {
                  setSettingsFeedId(null);
                  onDeleteFeed(feed.id);
                }}
                onToggleFeedEnabled={() => {
                  setSettingsFeedId(null);
                  onToggleFeedEnabled(feed.id);
                }}
                onChangeFeedFormat={(evidenceFormatId) => onChangeFeedFormat(feed.id, evidenceFormatId)}
                onChangeFeedSchedule={(schedule) => onChangeFeedSchedule(feed.id, schedule)}
                onRefreshGeneration={() => {
                  setSettingsFeedId(null);
                  onRefreshFeedGeneration(feed.id);
                }}
              />
            ) : null}
          </div>
        );
      })}
      {manage ? (
        <div className="feed-branch">
          <button className="add-feed-button nav-add-feed-button" type="button" onClick={onAddFeed}>
            Add feed
          </button>
        </div>
      ) : null}
    </section>
  );
}

function FeedSettingsDialog({
  feed,
  evidenceFormats,
  mutating,
  onClose,
  onToggleFeedEnabled,
  onChangeFeedFormat,
  onChangeFeedSchedule,
  onRefreshGeneration,
  onDeleteFeed,
}: {
  feed: DailyFeed;
  evidenceFormats: EvidenceFormat[];
  mutating: boolean;
  onClose: () => void;
  onToggleFeedEnabled: () => void;
  onChangeFeedFormat: (evidenceFormatId: string) => void;
  onChangeFeedSchedule: (schedule: DailyFeedSchedule) => void;
  onRefreshGeneration: () => void;
  onDeleteFeed: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(String(feed.schedule.interval_seconds));
  const activeFormats = evidenceFormats.filter((format) => format.archived_at === undefined);
  const formatOptions = activeFormats.some((format) => format.id === feed.evidence_format.id)
    ? activeFormats
    : [feed.evidence_format, ...activeFormats];
  const selectedIntervalSeconds = Number(intervalSeconds);
  const cadenceChanged =
    Number.isFinite(selectedIntervalSeconds) && selectedIntervalSeconds !== feed.schedule.interval_seconds;

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
    setIntervalSeconds(String(feed.schedule.interval_seconds));
  }, [feed.id, feed.schedule.interval_seconds]);

  function handleScheduleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cadenceChanged || !Number.isFinite(selectedIntervalSeconds) || selectedIntervalSeconds < 1) {
      return;
    }
    if (!window.confirm("Changing cadence resets schedule-based metrics. Continue?")) {
      return;
    }
    onChangeFeedSchedule({
      ...feed.schedule,
      starts_at: new Date().toISOString(),
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
          <section className="feed-settings-section feed-schedule-section" aria-label="Cadence">
            <div>
              <div className="section-title">Cadence</div>
              <div className="meta">{intervalLabel(feed.schedule.interval_seconds)}</div>
            </div>
            <form className="feed-schedule-form" onSubmit={handleScheduleSubmit}>
              <label className="feed-format-select-label">
                Repeat
                <select
                  disabled={mutating}
                  value={intervalSeconds}
                  onChange={(event) => setIntervalSeconds(event.target.value)}
                >
                  <option value="86400">Daily</option>
                  <option value="604800">Weekly</option>
                  <option value="3600">Hourly</option>
                </select>
              </label>
              <button className="secondary" disabled={mutating || !cadenceChanged} type="submit">
                Save
              </button>
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

function canManageGroup(group: Group | null): boolean {
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

function groupActions(
  group: Group,
  deletingGroupId: string | null,
  onOpenGroupSettings: (id: string) => void,
  onDeleteGroup: (id: string) => void,
): RowAction[] {
  const actions: RowAction[] = [];
  if (canManageGroup(group)) {
    actions.push({
      label: "Settings",
      onSelect: () => onOpenGroupSettings(group.id),
    });
  }
  if (group.my_status === "active" && group.my_role === "owner") {
    actions.push({
      label: "Delete",
      danger: true,
      disabled: deletingGroupId === group.id,
      onSelect: () => onDeleteGroup(group.id),
    });
  }
  return actions;
}
