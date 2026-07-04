import { FormEvent, useEffect, useRef, useState } from "react";

import type { DailyFeed, DailyFeedSchedule, EvidenceFormat, Group } from "../../types";
import { RowActionMenu, type RowAction } from "../RowActionMenu";
import { FeedSublist } from "./FeedSublist";

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
