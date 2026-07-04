import type { GroupInviteCandidate } from "../../types";

export function InviteFriends({
  candidates,
  loading,
  invitingUserId,
  onInviteFriend,
  onCancelGroupInvite,
}: {
  candidates: GroupInviteCandidate[];
  loading: boolean;
  invitingUserId: string | null;
  onInviteFriend: (userId: string) => void;
  onCancelGroupInvite: (userId: string) => void;
}) {
  return (
    <section className="invite-friends-section group-settings-invite-section" aria-label="Invite friends">
      <div className="section-title">Invite friends</div>
      <div className="stack">
        {loading ? <div className="meta">Loading friends...</div> : null}
        {!loading && !candidates.length ? <div className="meta">No eligible friends</div> : null}
        {candidates.map((candidate) => {
          const pending = candidate.membership_status === "invited";
          return (
            <div className="row social-row" key={candidate.user.id}>
              <div>
                <div className="title">{candidate.user.display_name || candidate.user.username}</div>
                <div className="meta">@{candidate.user.username}</div>
              </div>
              <button
                className={pending ? "secondary" : undefined}
                type="button"
                disabled={invitingUserId === candidate.user.id}
                onClick={() => {
                  if (pending) {
                    onCancelGroupInvite(candidate.user.id);
                    return;
                  }
                  onInviteFriend(candidate.user.id);
                }}
              >
                {pending ? "Cancel" : "Invite"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
