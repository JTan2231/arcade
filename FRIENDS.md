# Friendship And Group Invite Design

This document describes a mutual friendship system for Arcade and how that
system should interact with group invitations.

The core product rule is:

> Friendship controls who may initiate direct social actions toward whom. Group
> membership controls what a user can do inside a group.

That means a group does not need to be a complete friend graph. If Alice invites
Bob to a group, only Alice and Bob need an accepted friendship. Bob does not need
to be friends with every existing group member.

## Goals

- Let a user share a friend code with another person.
- Let another user send a friend request by entering that code.
- Require acceptance before users can interact through friend-gated actions.
- Allow an accepted friend to be invited to a group.
- Keep group membership independent from the global friendship graph.
- Reuse the existing `groups` and `group_memberships` model where practical.
- Avoid exposing email addresses or other private account identifiers.

## Non-Goals

- This is not a public user search system.
- This is not a follower system. Friendships are mutual.
- This does not require every member of a group to be friends with every other
  member.
- This does not replace group roles. Owners and admins still manage group-level
  authority.
- This does not require real-time notifications in the first version.

## Existing Model

Arcade already has:

- `users`: local accounts and display profile data.
- `groups`: social or team scopes.
- `group_memberships`: one row per `(group_id, user_id)`, with role and status.

Current membership roles are:

- `owner`
- `admin`
- `member`

Current membership statuses are:

- `invited`
- `active`
- `removed`
- `left`

That existing membership status is enough for a first version of group invites.
The friendship system should add a way to decide who can create an invited
membership row.

## Conceptual Model

There are three separate concepts:

1. Friend code

   A friend code is an address for finding a user. It should not itself grant
   access. A user can rotate it without changing existing friendships.

2. Friend request and friendship

   A request is directional while pending. After acceptance, the friendship is
   mutual and either user can initiate friend-gated actions.

3. Group invitation

   A group invite is a pending group membership. The invite is authorized by the
   relationship between the inviter and invitee, not by a relationship between
   the invitee and the whole group.

## Friend Code

Add a stable, unique friend code to each account.

Recommended user-facing properties:

- Random, non-sequential, and hard to guess.
- Case-insensitive.
- Safe to read aloud or paste.
- Displayed with grouping, such as `ARCD-7QK2-MP9R`.
- Stored normalized without separators, such as `ARCD7QK2MP9R`.
- Rotatable by the account owner.

Suggested schema addition:

```sql
alter table users
add column friend_code text;

create unique index users_friend_code_idx
on users (friend_code)
where friend_code is not null;
```

After backfilling existing users, the column can become `not null`.

Code rotation should only affect future friend requests. Existing pending
requests, accepted friendships, and group memberships should continue to refer
to user IDs, not friend codes.

Friend-code lookup should return only a minimal public profile:

- user ID
- username, if public in the product
- display name
- avatar URL

It should never return email address, session state, or account metadata.

## Friendship Table

Use one durable row per unordered pair of users.

Recommended schema:

```sql
create table user_friendships (
    id uuid primary key default gen_random_uuid(),
    requester_user_id uuid not null references users(id) on delete cascade,
    addressee_user_id uuid not null references users(id) on delete cascade,
    user_low_id uuid not null references users(id) on delete cascade,
    user_high_id uuid not null references users(id) on delete cascade,
    status text not null check (
        status in ('pending', 'accepted', 'declined', 'canceled')
    ),
    requested_at timestamptz not null default now(),
    responded_at timestamptz,
    accepted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (requester_user_id <> addressee_user_id),
    check (user_low_id <> user_high_id),
    unique (user_low_id, user_high_id)
);
```

`user_low_id` and `user_high_id` are the canonical unordered pair. Application
code should store the lower UUID in `user_low_id` and the higher UUID in
`user_high_id`, or the migration can use generated columns if that pattern is
preferred later.

The directional fields remain useful:

- `requester_user_id` records who initiated the latest request.
- `addressee_user_id` records who needs to respond while pending.
- `user_low_id` and `user_high_id` enforce one friendship record per pair.

Recommended indexes:

```sql
create index user_friendships_addressee_pending_idx
on user_friendships (addressee_user_id, created_at desc)
where status = 'pending';

create index user_friendships_requester_pending_idx
on user_friendships (requester_user_id, created_at desc)
where status = 'pending';

create index user_friendships_user_low_status_idx
on user_friendships (user_low_id, status);

create index user_friendships_user_high_status_idx
on user_friendships (user_high_id, status);
```

Add the shared `set_updated_at()` trigger because this is a mutable user-facing
table.

## Friendship States

The friendship state machine should be small:

```text
none
  -> pending

pending
  -> accepted
  -> declined
  -> canceled

accepted
  -> none or canceled

declined
  -> pending

canceled
  -> pending
```

The implementation can either delete accepted rows when a user unfriends
someone, or retain the row with a terminal status. Retaining rows is better for
abuse prevention and auditability. If rows are retained, use `canceled` for an
unfriend or request cancellation.

Declined and canceled rows can be reused for future requests by updating the
same row back to `pending`, subject to any cooldown policy.

## Friend Request Flow

### Sending

Alice enters Bob's friend code.

The server should:

1. Normalize the submitted friend code.
2. Find the target user by `users.friend_code`.
3. Reject self-requests.
4. Check block rules, if blocking exists.
5. Look up the unordered friendship pair.
6. If no row exists, create a `pending` row.
7. If a pending row already exists from Alice to Bob, return the existing row.
8. If a pending row exists from Bob to Alice, accept it instead of creating a
   duplicate request.
9. If the pair is already accepted, return a conflict or accepted state.
10. If the previous row is declined or canceled, update it to `pending`.

The reciprocal pending behavior is important. If Bob already asked Alice to be
friends and Alice enters Bob's code, that should be treated as mutual consent.

### Accepting

Only the pending addressee can accept a friend request.

On acceptance:

- set `status = 'accepted'`
- set `responded_at = now()`
- set `accepted_at = now()`

### Declining

Only the pending addressee can decline a friend request.

On decline:

- set `status = 'declined'`
- set `responded_at = now()`
- keep enough row history to suppress immediate repeated requests, if desired

### Canceling

Only the requester can cancel a pending request.

On cancellation:

- set `status = 'canceled'`
- set `responded_at = now()`

### Unfriending

Either user in an accepted friendship can unfriend.

Recommended behavior:

- set `status = 'canceled'`
- clear or preserve `accepted_at` based on audit needs
- do not alter existing group memberships
- cancel pending group invites between those two users if the invite has not
  been accepted

Existing group memberships should remain active after an unfriend. Friendship
authorizes the social action of inviting someone; it should not become a hidden
dependency for staying in a group.

## Blocking

Blocking is not required for the first implementation, but the data model should
leave room for it because friend codes can be shared outside the app.

Suggested table:

```sql
create table user_blocks (
    blocker_user_id uuid not null references users(id) on delete cascade,
    blocked_user_id uuid not null references users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_user_id, blocked_user_id),
    check (blocker_user_id <> blocked_user_id)
);
```

Recommended block behavior:

- A blocked user cannot send a friend request to the blocker.
- A blocked user cannot invite the blocker to a group.
- Blocking cancels pending friend requests between the two users.
- Blocking cancels pending group invites between the two users.
- Blocking does not automatically remove either user from groups they already
  share.
- Friendship lists and pending request lists should hide blocked users.

Blocking is directional. If Alice blocks Bob, Bob cannot initiate interactions
toward Alice. Alice can later unblock Bob.

## Group Invites

The first version should reuse `group_memberships`.

When Alice invites Bob to group `G`, create or update Bob's membership row:

```text
group_id = G
user_id = Bob
role = member
status = invited
joined_at = null
```

Add invite metadata to `group_memberships`:

```sql
alter table group_memberships
add column invited_by_user_id uuid references users(id) on delete set null,
add column invited_at timestamptz;
```

This metadata matters because the friendship requirement is between the inviter
and invitee. It also supports displaying "invited by Alice" in the UI.

For v1, all social group invites should create `role = 'member'`. Role changes
remain an owner/admin action after the invitee joins.

## Group Invite Authorization

To create a social group invite:

1. The actor must be authenticated.
2. The actor must have an active membership in the group.
3. The target user must be an accepted friend of the actor.
4. The actor and target must not block each other.
5. The target must not already be an active member of the group.
6. The target must not already have a pending invite to the group.
7. The target must not be in a `removed` state unless the actor is an owner or
   admin.
8. The invite must create a regular `member` role.

This rule does not require the target to be friends with any other group member.

Existing owner/admin member-management can remain separate from social invites.
That administrative path may still be useful for tests, bootstrapping, or
explicit direct management. The user-facing "Invite friend" flow should use the
friend-gated invite endpoint.

## Group Invite Acceptance

Only the invited user can accept their own invite.

On acceptance:

- require `group_memberships.status = 'invited'`
- optionally require `invited_by_user_id` to still be an active group member
- require no block between inviter and invitee
- recommended: require the inviter and invitee to still be accepted friends
- set `status = 'active'`
- set `joined_at = now()` if it is null

The "still friends" check prevents stale invitations from remaining usable after
the relationship that authorized the invite has been removed. If that feels too
strict later, the rule can be relaxed to "friendship required only when the
invite is created."

## Group Invite Decline And Cancellation

Only the invited user can decline their own invite.

Two reasonable v1 options:

1. Delete the `group_memberships` row if it is still `invited`.
2. Add a new `declined` membership status and preserve the row.

Deleting is simpler and avoids changing the existing membership state machine.
Adding `declined` is better if the product needs invitation history, abuse
review, or cooldowns.

Inviters should be able to cancel an invite they sent while it is still pending.
Owners and admins should be able to cancel any pending invite in their group.

## Group Invite Edge Cases

### Target Is Already Active

Return conflict. Do not change role or status.

### Target Already Has Pending Invite

Return the existing invited state. Do not overwrite `invited_by_user_id` unless
there is an explicit product reason to let a newer inviter take over the invite.

### Target Previously Left

Allow a new friend invite. Update the existing membership row to:

```text
status = invited
role = member
invited_by_user_id = actor
invited_at = now()
joined_at = previous joined_at or null, based on existing convention
```

Preserving `joined_at` may be useful as "first joined at." If the UI needs
"current membership started at," add a separate timestamp later.

### Target Was Removed

Do not allow a regular member to re-invite a removed user. Owners/admins may
re-invite them if the product allows it.

### Inviter Leaves Before Acceptance

Recommended behavior: invalidate the invite for regular member invitations.

If an owner/admin wants the invite to remain valid independently of the inviter,
they can issue or reissue an administrative invite.

### Friendship Ends Before Acceptance

Recommended behavior: the invite cannot be accepted. The server can either
cancel it automatically or return an error explaining that the invite is no
longer valid.

### Friendship Ends After Acceptance

Do nothing to group membership. Bob remains in the group until he leaves or a
group admin removes him.

## API Shape

The exact route names can change to match local routing style, but this is the
recommended surface area.

### Identity

```text
GET  /api/me
POST /api/me/friend-code/rotate
```

`GET /api/me` should include the current user's `friend_code`.

Rotating the friend code should require the current password or a recent
session check if account security later supports that pattern. For v1, an
authenticated request may be enough.

### Friend Requests

```text
POST /api/friend-requests
GET  /api/friend-requests
POST /api/friend-requests/{request_id}/accept
POST /api/friend-requests/{request_id}/decline
POST /api/friend-requests/{request_id}/cancel
```

`POST /api/friend-requests` body:

```json
{
  "friend_code": "ARCD-7QK2-MP9R"
}
```

`GET /api/friend-requests` can return both incoming and outgoing pending
requests:

```json
{
  "incoming": [],
  "outgoing": []
}
```

### Friends

```text
GET    /api/friends
DELETE /api/friends/{user_id}
```

`GET /api/friends` should return accepted friends only, with minimal profile
data and no email addresses.

### Blocks

If blocking is implemented:

```text
POST   /api/blocks
GET    /api/blocks
DELETE /api/blocks/{user_id}
```

`POST /api/blocks` body:

```json
{
  "user_id": "..."
}
```

### Group Invites

```text
POST /api/groups/{group_id}/invites
GET  /api/group-invites
POST /api/groups/{group_id}/invites/{user_id}/accept
POST /api/groups/{group_id}/invites/{user_id}/decline
POST /api/groups/{group_id}/invites/{user_id}/cancel
```

`POST /api/groups/{group_id}/invites` body:

```json
{
  "user_id": "..."
}
```

The server should verify that `user_id` is an accepted friend of the actor.

`GET /api/group-invites` returns pending group invites for the current user
across groups.

An optional helper endpoint can make the frontend easier:

```text
GET /api/groups/{group_id}/invite-candidates
```

That endpoint would return accepted friends who are eligible to be invited to
the group.

## Response Shapes

Friend profile summary:

```json
{
  "id": "...",
  "username": "bob",
  "display_name": "Bob",
  "avatar_url": null
}
```

Friend request:

```json
{
  "id": "...",
  "status": "pending",
  "requester": {},
  "addressee": {},
  "created_at": "2026-06-25T12:00:00Z",
  "updated_at": "2026-06-25T12:00:00Z"
}
```

Friend:

```json
{
  "user": {},
  "friends_since": "2026-06-25T12:00:00Z"
}
```

Group invite:

```json
{
  "group": {},
  "invited_by": {},
  "invited_at": "2026-06-25T12:00:00Z"
}
```

## Frontend Experience

### Social Panel

Add a friends area near the account or group dashboard surface:

- Shows "Your friend code" with copy and rotate actions.
- Provides an "Add friend" form for a friend code.
- Shows incoming friend requests with accept and decline actions.
- Shows outgoing friend requests with cancel action.
- Shows accepted friends.

The friend-code entry flow should confirm the resolved profile before sending a
request if the backend exposes a lookup endpoint. If there is no separate lookup
endpoint, the send endpoint can return the created pending request with the
target profile.

### Group Invite Flow

Inside a group:

- Show an "Invite friend" action to eligible active members.
- Present accepted friends who are eligible for the group.
- Hide friends who are already active members.
- Mark friends who already have pending invites as pending.
- Create group invites through the friend-gated invite endpoint.

For group invite recipients:

- Show pending group invites in a clear inbox.
- Display the group name and inviter.
- Provide accept and decline actions.

## Privacy And Safety

Friend codes are intentionally shareable, but they should not become a broad
directory.

Recommended rules:

- Do not support global search by email.
- Do not expose email in friend requests, friend lists, or group invites.
- Normalize friend codes before lookup.
- Rate-limit friend-code lookup and friend-request creation.
- Treat duplicate friend requests as idempotent where possible.
- Use generic errors for sensitive rejection cases, especially blocks.
- Allow friend-code rotation.
- Add blocking before or soon after public use.

Potential rate limits:

- friend-code lookup attempts per account per hour
- friend requests created per account per day
- pending outgoing friend requests per account
- group invites created per account per group per day

## Migration Plan

1. Add `users.friend_code`.
2. Backfill codes for existing users.
3. Make `users.friend_code` unique and not null after backfill.
4. Add `user_friendships`.
5. Add `group_memberships.invited_by_user_id` and `invited_at`.
6. Optionally add `user_blocks`.
7. Update [docs/data-model.md](docs/data-model.md) after the schema migration
   is implemented.

Per existing migration conventions:

- Add a new numbered migration under `internal/migrations`.
- Keep it forward-only.
- Use text checks for enum-like values.
- Add `updated_at` triggers for mutable tables.
- Test a fresh database and an upgrade from the prior schema.

## Backend Implementation Plan

1. Add friend-code generation and normalization helpers.
2. Include `friend_code` in the current-user response model.
3. Add friendship query helpers:
   - find pair by two user IDs
   - test accepted friendship
   - list accepted friends
   - list incoming and outgoing pending requests
4. Add friend request handlers.
5. Add unfriend handling.
6. Add group invite handlers that reuse `group_memberships`.
7. Gate social group invites on accepted friendship.
8. Add tests around duplicate requests, reciprocal requests, blocks, and group
   invite authorization.

## Frontend Implementation Plan

1. Extend the API client with friend request, friend list, and group invite
   calls.
2. Add friend code to the current-user type.
3. Add a friends panel or account-social view.
4. Add incoming and outgoing friend request UI.
5. Add group invite candidate UI inside the selected group.
6. Add pending group invite UI for the current user.
7. Preserve the existing group owner/admin management UI as a separate admin
   surface.

## Open Product Questions

- Should every active member be allowed to invite accepted friends, or should
  groups have an invite policy?
- Should private groups restrict friend invites to owners/admins?
- Should declined group invites be stored as history or deleted?
- Should friend requests have a cooldown after decline?
- Should pending group invites expire?
- Should accepting a group invite require the inviter to still be an active
  group member?
- Should accepting a group invite require the inviter and invitee to still be
  friends?
- Should owner/admin direct member management bypass friendship, or should all
  user-facing invitations require friendship?

## Recommended V1

The pragmatic first version:

- Add friend codes on users.
- Add `user_friendships`.
- Add `invited_by_user_id` and `invited_at` on `group_memberships`.
- Let users send, accept, decline, cancel, and remove friendships.
- Let active group members invite accepted friends as regular members.
- Require owners/admins to re-invite users with `removed` group membership.
- Reuse `group_memberships.status = 'invited'` for pending group invites.
- Delete pending invited membership rows when the invitee declines.
- Do not require friendship among all group members.
- Leave blocking as the next safety feature if it is not included immediately.

