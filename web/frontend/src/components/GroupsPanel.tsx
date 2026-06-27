import { FormEvent, useState } from "react";

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    onCreateGroup(trimmed);
    setName("");
  }

  return (
    <section className="panel groups-panel" aria-labelledby="groups-title">
      <div className="panel-header">
        <h2 id="groups-title">Groups</h2>
      </div>
      <form className="compact-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input placeholder="Morning Dojo" required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" disabled={creating}>
          Create group
        </button>
      </form>

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
