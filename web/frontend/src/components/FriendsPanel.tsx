import { FormEvent, useState } from "react";

import type { Friend, FriendRequest, FriendRequests, GroupInvite, User } from "../types";

type FriendsPanelProps = {
  user: User | null;
  friendRequests: FriendRequests;
  friends: Friend[];
  groupInvites: GroupInvite[];
  loading: boolean;
  error: string;
  mutating: string | null;
  onAddFriend: (friendCode: string) => void;
  onAcceptFriendRequest: (requestId: string) => void;
  onDeclineFriendRequest: (requestId: string) => void;
  onCancelFriendRequest: (requestId: string) => void;
  onDeleteFriend: (userId: string) => void;
  onRotateFriendCode: () => void;
  onAcceptGroupInvite: (invite: GroupInvite) => void;
  onDeclineGroupInvite: (invite: GroupInvite) => void;
};

export function FriendsPanel({
  user,
  friendRequests,
  friends,
  groupInvites,
  loading,
  error,
  mutating,
  onAddFriend,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onCancelFriendRequest,
  onDeleteFriend,
  onRotateFriendCode,
  onAcceptGroupInvite,
  onDeclineGroupInvite,
}: FriendsPanelProps) {
  const [friendCode, setFriendCode] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = friendCode.trim();
    if (!trimmed) {
      return;
    }
    onAddFriend(trimmed);
    setFriendCode("");
  }

  async function copyFriendCode() {
    const code = user?.friend_code ?? "";
    if (code === "" || navigator.clipboard === undefined) {
      return;
    }
    await navigator.clipboard.writeText(formatFriendCode(code)).catch(() => undefined);
  }

  const rawFriendCode = user?.friend_code ?? "";
  const formattedFriendCode = rawFriendCode === "" ? "" : formatFriendCode(rawFriendCode);

  return (
    <section className="panel friends-panel" aria-labelledby="friends-title">
      <div className="panel-header">
        <h2 id="friends-title">Friends</h2>
      </div>

      <div className="friend-code-row">
        <div>
          <div className="meta">Your friend code</div>
          <div className="friend-code">{formattedFriendCode}</div>
        </div>
        <div className="compact-actions">
          <button
            className="secondary"
            type="button"
            aria-label="Copy friend code"
            onClick={() => {
              void copyFriendCode();
            }}
          >
            Copy
          </button>
          <button
            className="secondary"
            type="button"
            aria-label="Rotate friend code"
            disabled={mutating === "rotate-code"}
            onClick={onRotateFriendCode}
          >
            Rotate
          </button>
        </div>
      </div>

      <form className="compact-form" onSubmit={handleSubmit}>
        <label>
          Friend code
          <input
            placeholder="ARCD-7QK2-MP9R"
            value={friendCode}
            onChange={(event) => setFriendCode(event.target.value)}
          />
        </label>
        <button type="submit" disabled={mutating === "add-friend"}>
          Add friend
        </button>
      </form>

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="social-section">
        <div className="section-title">Incoming</div>
        <RequestList
          emptyText={loading ? "Loading..." : "No incoming requests"}
          requests={friendRequests.incoming}
          currentUserId={user?.id ?? null}
          mutating={mutating}
          onAccept={onAcceptFriendRequest}
          onDecline={onDeclineFriendRequest}
        />
      </div>

      <div className="social-section">
        <div className="section-title">Outgoing</div>
        <OutgoingRequestList
          emptyText={loading ? "Loading..." : "No outgoing requests"}
          requests={friendRequests.outgoing}
          currentUserId={user?.id ?? null}
          mutating={mutating}
          onCancel={onCancelFriendRequest}
        />
      </div>

      <div className="social-section">
        <div className="section-title">Accepted</div>
        <div className="stack">
          {friends.length ? (
            friends.map((friend) => (
              <div className="row social-row" key={friend.user.id}>
                <div>
                  <div className="title">{friend.user.display_name || friend.user.username}</div>
                  <div className="meta">@{friend.user.username}</div>
                </div>
                <button
                  className="danger"
                  type="button"
                  disabled={mutating === `delete-friend:${friend.user.id}`}
                  onClick={() => onDeleteFriend(friend.user.id)}
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <div className="meta">{loading ? "Loading..." : "No friends yet"}</div>
          )}
        </div>
      </div>

      <div className="social-section">
        <div className="section-title">Group invites</div>
        <div className="stack">
          {groupInvites.length ? (
            groupInvites.map((invite) => (
              <div className="row social-row" key={invite.group.id}>
                <div>
                  <div className="title">{invite.group.name}</div>
                  {invite.invited_by ? <div className="meta">Invited by {invite.invited_by.display_name}</div> : null}
                </div>
                <div className="compact-actions">
                  <button
                    type="button"
                    disabled={mutating === `accept-group:${invite.group.id}`}
                    onClick={() => onAcceptGroupInvite(invite)}
                  >
                    Accept
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={mutating === `decline-group:${invite.group.id}`}
                    onClick={() => onDeclineGroupInvite(invite)}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="meta">{loading ? "Loading..." : "No group invites"}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function RequestList({
  requests,
  currentUserId,
  emptyText,
  mutating,
  onAccept,
  onDecline,
}: {
  requests: FriendRequest[];
  currentUserId: string | null;
  emptyText: string;
  mutating: string | null;
  onAccept: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}) {
  return (
    <div className="stack">
      {requests.length ? (
        requests.map((request) => {
          const user = otherUser(request, currentUserId);
          return (
            <div className="row social-row" key={request.id}>
              <div>
                <div className="title">{user.display_name || user.username}</div>
                <div className="meta">@{user.username}</div>
              </div>
              <div className="compact-actions">
                <button
                  type="button"
                  aria-label={`Accept friend request from ${user.display_name || user.username}`}
                  disabled={mutating === `accept-request:${request.id}`}
                  onClick={() => onAccept(request.id)}
                >
                  Accept
                </button>
                <button
                  className="secondary"
                  type="button"
                  aria-label={`Decline friend request from ${user.display_name || user.username}`}
                  disabled={mutating === `decline-request:${request.id}`}
                  onClick={() => onDecline(request.id)}
                >
                  Decline
                </button>
              </div>
            </div>
          );
        })
      ) : (
        <div className="meta">{emptyText}</div>
      )}
    </div>
  );
}

function OutgoingRequestList({
  requests,
  currentUserId,
  emptyText,
  mutating,
  onCancel,
}: {
  requests: FriendRequest[];
  currentUserId: string | null;
  emptyText: string;
  mutating: string | null;
  onCancel: (requestId: string) => void;
}) {
  return (
    <div className="stack">
      {requests.length ? (
        requests.map((request) => {
          const user = otherUser(request, currentUserId);
          return (
            <div className="row social-row" key={request.id}>
              <div>
                <div className="title">{user.display_name || user.username}</div>
                <div className="meta">@{user.username}</div>
              </div>
              <button
                className="secondary"
                type="button"
                disabled={mutating === `cancel-request:${request.id}`}
                onClick={() => onCancel(request.id)}
              >
                Cancel
              </button>
            </div>
          );
        })
      ) : (
        <div className="meta">{emptyText}</div>
      )}
    </div>
  );
}

function otherUser(request: FriendRequest, currentUserId: string | null) {
  return request.requester.id === currentUserId ? request.addressee : request.requester;
}

function formatFriendCode(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalized.length <= 4) {
    return normalized;
  }
  return [normalized.slice(0, 4), normalized.slice(4, 8), normalized.slice(8)].filter(Boolean).join("-");
}
