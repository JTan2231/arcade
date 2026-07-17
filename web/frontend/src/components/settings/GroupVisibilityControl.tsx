import type { Group, Visibility } from "../../types";

export function GroupVisibilityControl({
  group,
  saving,
  onUpdateVisibility,
}: {
  group: Group;
  saving: boolean;
  onUpdateVisibility: (visibility: Visibility) => void;
}) {
  return (
    <section className="group-visibility-section" aria-label="Group visibility">
      <label htmlFor="group-visibility-select">Visibility</label>
      <select
        id="group-visibility-select"
        disabled={saving}
        value={group.visibility}
        onChange={(event) => onUpdateVisibility(event.target.value as Visibility)}
      >
        <option value="public">Public</option>
        <option value="private">Private</option>
      </select>
      <div className="meta">
        {group.visibility === "public" ? "Visible on public group pages and discovery." : "Visible only to members."}
      </div>
    </section>
  );
}
