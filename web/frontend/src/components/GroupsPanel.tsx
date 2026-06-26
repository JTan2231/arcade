import { FormEvent, useState } from "react";

import type { Group } from "../types";

type GroupsPanelProps = {
  groups: Group[];
  selectedGroupId: string | null;
  loading: boolean;
  creating: boolean;
  onCreateGroup: (name: string) => Promise<void>;
  onSelectGroup: (id: string) => void;
};

export function GroupsPanel({
  groups,
  selectedGroupId,
  loading,
  creating,
  onCreateGroup,
  onSelectGroup,
}: GroupsPanelProps) {
  const [name, setName] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    await onCreateGroup(trimmed);
    setName("");
  }

  return (
    <section className="panel groups-panel">
      <div className="panel-header">
        <h2>Groups</h2>
      </div>
      <form
        className="compact-form"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
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
              <button
                aria-pressed={selected}
                className={`row selectable-row ${selected ? "selected-row" : ""}`}
                key={group.id}
                type="button"
                onClick={() => onSelectGroup(group.id)}
              >
                <div className="title">{group.name}</div>
              </button>
            );
          })
        ) : (
          <div className="meta">No groups yet</div>
        )}
      </div>
    </section>
  );
}
