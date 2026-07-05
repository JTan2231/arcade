import type { Group, GroupMember } from "../../types";

export function GroupMembersManager({
  group,
  members,
  currentUserId,
  loading,
  error,
  removingUserId,
  onRemoveMember,
}: {
  group: Group;
  members: GroupMember[];
  currentUserId: string | null;
  loading: boolean;
  error: string;
  removingUserId: string | null;
  onRemoveMember: (userId: string) => void;
}) {
  return (
    <section className="group-members-manager" aria-label="Group members">
      <div className="section-title">Group members</div>
      {error !== "" ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="group-member-list">
        {loading ? <div className="meta">Loading members...</div> : null}
        {!loading && members.length === 0 ? <div className="meta">No members</div> : null}
        {members.map((member) => {
          const displayName = member.display_name || member.username;
          const inviteLinkLabel = member.invite_link?.label ?? "";
          const removing = removingUserId === member.user_id;
          const removable = canRemoveMember(group, member, members);
          return (
            <div className="row group-member-row" key={member.user_id}>
              <div className="group-member-summary">
                <div className="title">{displayName}</div>
                <div className="meta">
                  @{member.username} - {roleLabel(member.role)} - {statusLabel(member.status)}
                  {member.user_id === currentUserId ? " - You" : ""}
                </div>
                {member.invited_by ? (
                  <div className="meta">
                    Invited by {member.invited_by.display_name}
                    {inviteLinkLabel !== "" ? ` via ${inviteLinkLabel}` : ""}
                  </div>
                ) : null}
              </div>
              <button
                aria-label={`Remove ${displayName}`}
                className="danger"
                disabled={removing || !removable}
                type="button"
                onClick={() => onRemoveMember(member.user_id)}
              >
                {removing ? "Removing..." : "Remove"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function canManageGroup(group: Group): boolean {
  return group.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

function canRemoveMember(group: Group, member: GroupMember, members: GroupMember[]): boolean {
  if (!canManageGroup(group)) {
    return false;
  }
  if (group.my_role === "admin") {
    return member.role === "member";
  }
  if (group.my_role !== "owner") {
    return false;
  }
  if (member.role !== "owner" || member.status !== "active") {
    return true;
  }
  const activeOwners = members.filter((candidate) => candidate.role === "owner" && candidate.status === "active");
  return activeOwners.length > 1;
}

function roleLabel(role: GroupMember["role"]): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
  }
}

function statusLabel(status: GroupMember["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "left":
      return "Left";
    case "removed":
      return "Removed";
  }
}
