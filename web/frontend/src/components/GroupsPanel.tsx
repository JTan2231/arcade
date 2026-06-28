import { FormEvent, useEffect, useRef, useState } from "react";

import type { Group } from "../types";
import { RowActionMenu } from "./RowActionMenu";

type GroupsPanelProps = {
  groups: Group[];
  selectedGroupId: string | null;
  loading: boolean;
  creating: boolean;
  deletingGroupId: string | null;
  onCreateGroup: (name: string) => void;
  onSelectGroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
};

export function GroupsPanel({
  groups,
  selectedGroupId,
  loading,
  creating,
  deletingGroupId,
  onCreateGroup,
  onSelectGroup,
  onDeleteGroup,
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
    <section className="panel groups-panel" aria-labelledby="groups-title">
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

      <div className="stack">
        {loading ? (
          <div className="meta">Loading groups...</div>
        ) : groups.length ? (
          groups.map((group) => {
            const selected = group.id === selectedGroupId;

            return (
              <div className={`row action-row ${selected ? "selected-row" : ""}`} key={group.id}>
                <button
                  aria-pressed={selected}
                  className="row-select-button"
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
            );
          })
        ) : (
          <div className="meta">No groups yet</div>
        )}
      </div>
    </section>
  );
}
