import type { Group, JoinPolicy, Visibility } from "../../types";

type GroupAccessPreset = "private" | "public" | "open";

export function GroupVisibilityControl({
  group,
  saving,
  onUpdateAccess,
}: {
  group: Group;
  saving: boolean;
  onUpdateAccess: (visibility: Visibility, joinPolicy: JoinPolicy) => void;
}) {
  const preset = groupAccessPreset(group);

  return (
    <section className="group-access-section" aria-label="Group access">
      <label htmlFor="group-access-select">Who can view and post?</label>
      <select
        id="group-access-select"
        disabled={saving}
        value={preset}
        onChange={(event) => {
          const nextPreset = event.target.value as GroupAccessPreset;
          onUpdateAccess(
            nextPreset === "private" ? "private" : "public",
            nextPreset === "open" ? "open" : "invite_only",
          );
        }}
      >
        <option value="private">Private</option>
        <option value="public">Public</option>
        <option value="open">Open</option>
      </select>
      <div className="meta">{groupAccessDescription(preset)}</div>
    </section>
  );
}

function groupAccessPreset(group: Group): GroupAccessPreset {
  if (group.visibility === "private") {
    return "private";
  }
  return group.join_policy === "open" ? "open" : "public";
}

function groupAccessDescription(preset: GroupAccessPreset): string {
  switch (preset) {
    case "private":
      return "Only invited members can view and post.";
    case "public":
      return "Anyone can view. Posting requires an invite.";
    case "open":
      return "Anyone with an Arcade account can join as a member and post.";
  }
}
