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
      <form className="compact-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input
            placeholder="Morning Dojo"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
            const role = group.my_role || "viewer";
            const status = group.my_status ? ` - ${group.my_status}` : "";

            return (
              <div className={`row ${selected ? "selected-row" : ""}`} key={group.id}>
                <div className="row-top">
                  <div>
                    <div className="title">{group.name}</div>
                    <div className="meta">
                      {group.visibility} - {role}
                      {status}
                    </div>
                  </div>
                  <button
                    className={selected ? "" : "secondary"}
                    type="button"
                    onClick={() => onSelectGroup(group.id)}
                  >
                    {selected ? "Selected" : "Open"}
                  </button>
                </div>
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
