import { FormEvent, useEffect, useRef, useState } from "react";

import type { DailyFeed, Group } from "../types";
import { RowActionMenu, type RowAction } from "./RowActionMenu";

type GroupsPanelProps = {
  groups: Group[];
  feeds: DailyFeed[];
  selectedGroupId: string | null;
  selectedFeedId: string | null;
  loading: boolean;
  feedsLoading: boolean;
  feedsError: string;
  creating: boolean;
  deletingGroupId: string | null;
  pendingToggleFeedId: string | null;
  pendingDeleteFeedId: string | null;
  onCreateGroup: (name: string) => void;
  onSelectGroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
  onSelectFeed: (id: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onDeleteFeed: (id: string) => void;
  onAddFeed: () => void;
};

export function GroupsPanel({
  groups,
  feeds,
  selectedGroupId,
  selectedFeedId,
  loading,
  feedsLoading,
  feedsError,
  creating,
  deletingGroupId,
  pendingToggleFeedId,
  pendingDeleteFeedId,
  onCreateGroup,
  onSelectGroup,
  onDeleteGroup,
  onSelectFeed,
  onToggleFeedEnabled,
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
                  <RowActionMenu
                    label={`Group settings for ${group.name}`}
                    actions={[
                      {
                        label: "Delete",
                        danger: true,
                        disabled: group.my_role !== "owner" || deletingGroupId === group.id,
                        onSelect: () => onDeleteGroup(group.id),
                      },
                    ]}
                  />
                </div>
                {selected ? (
                  <FeedSublist
                    feeds={feeds}
                    loading={feedsLoading}
                    error={feedsError}
                    manage={canManageGroup(group)}
                    selectedFeedId={selectedFeedId}
                    pendingToggleFeedId={pendingToggleFeedId}
                    pendingDeleteFeedId={pendingDeleteFeedId}
                    onSelectFeed={onSelectFeed}
                    onToggleFeedEnabled={onToggleFeedEnabled}
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
  loading,
  error,
  manage,
  selectedFeedId,
  pendingToggleFeedId,
  pendingDeleteFeedId,
  onSelectFeed,
  onToggleFeedEnabled,
  onDeleteFeed,
  onAddFeed,
}: {
  feeds: DailyFeed[];
  loading: boolean;
  error: string;
  manage: boolean;
  selectedFeedId: string | null;
  pendingToggleFeedId: string | null;
  pendingDeleteFeedId: string | null;
  onSelectFeed: (id: string) => void;
  onToggleFeedEnabled: (id: string) => void;
  onDeleteFeed: (id: string) => void;
  onAddFeed: () => void;
}) {
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
        const mutating = pendingToggleFeedId === feed.id || pendingDeleteFeedId === feed.id;
        const actions: RowAction[] = manage
          ? [
              {
                label: feed.enabled ? "Disable" : "Enable",
                disabled: mutating,
                onSelect: () => onToggleFeedEnabled(feed.id),
              },
              {
                label: "Delete",
                danger: true,
                disabled: mutating,
                onSelect: () => onDeleteFeed(feed.id),
              },
            ]
          : [
              {
                label: "Delete",
                danger: true,
                disabled: true,
                onSelect: () => onDeleteFeed(feed.id),
              },
            ];

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
                {!feed.enabled ? <div className="meta">Disabled</div> : null}
              </button>
              <RowActionMenu label={`Feed settings for ${feed.name}`} actions={actions} />
            </div>
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

function canManageGroup(group: Group | null): boolean {
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}
