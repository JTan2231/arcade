# Auth Plan

This document describes the proposed user authentication and group authorization
changes for Arcade.

The intended model is deliberately small:

- Users can sign up and log in with email, password, and display name.
- Logged-out users cannot interact with application data.
- "Remember me" extends the session lifetime.
- Group management uses the existing group membership roles: owner, admin, and
  member.

This is form/session auth, not HTTP Basic Auth. Passwords are submitted over
HTTPS to login/signup endpoints, verified server-side, and represented after
login by a secure session cookie.

## Current State

The app currently has user-shaped data, but not authentication.

- `users` exists with `username`, `display_name`, and `avatar_url`.
- `group_memberships` exists with `role` and `status`.
- The server creates one development user on startup from
  `ARCADE_DEV_USERNAME` and `ARCADE_DEV_DISPLAY_NAME`.
- Handlers use `s.currentUser`, which is one process-wide user, not a
  per-request authenticated user.
- The frontend sends JSON requests with no auth header and no explicit
  credentials handling.
- There are no passwords, sessions, cookies, login routes, signup routes, or
  auth middleware.
- Group role data exists, but most group mutation endpoints do not enforce it.

## Goals

1. Require login for all application API interaction except health checks and
   auth endpoints.
2. Add basic account auth with only email, password, and display name required.
3. Add secure cookie-backed sessions.
4. Add "remember me" by issuing longer-lived sessions when requested.
5. Replace the singleton dev user with a request-scoped current user.
6. Enforce minimum group role permissions for group and membership management.
7. Keep the implementation local and simple. No OAuth, email verification,
   password reset, organizations, billing roles, or external identity provider
   integration in this pass.

## Non-Goals

- No OAuth or social login.
- No multi-factor auth.
- No email verification requirement.
- No password reset email flow.
- No global site-admin role unless a later need appears.
- No public anonymous API access beyond health/auth/static assets.
- No external coding-site account proof flow beyond the existing local
  account-linking records.

## Data Model

### Users

Extend the existing `users` table so it can own login credentials.

```sql
alter table users
	add column email text,
	add column password_hash text;

create unique index users_email_unique
	on users (lower(email))
	where email is not null;
```

After backfill, `email` and `password_hash` should become `not null` for real
accounts.

Recommended final shape:

```sql
create table users (
	id uuid primary key default gen_random_uuid(),
	email text unique not null,
	username text unique,
	display_name text not null,
	password_hash text not null,
	avatar_url text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);
```

Notes:

- `username` can remain for compatibility and URLs, but it should not be
  required for auth.
- `email` should be normalized before storage by trimming whitespace and
  lowercasing.
- `display_name` remains the user-facing name.
- `password_hash` must never contain plaintext passwords.

### Password Hashing

Use `argon2id` or `bcrypt`. For the first implementation, `bcrypt` is the
simplest Go option.

Recommended bcrypt behavior:

- Package: `golang.org/x/crypto/bcrypt`
- Cost: `bcrypt.DefaultCost` initially.
- Hash on signup and password change.
- Compare with `bcrypt.CompareHashAndPassword`.
- Return the same login error for unknown email and wrong password.

### Sessions

Add a session table. Store only a hash of the session token, never the raw
cookie token.

```sql
create table user_sessions (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	token_hash bytea unique not null,
	remember_me boolean not null default false,
	user_agent text,
	ip_address inet,
	last_seen_at timestamptz not null default now(),
	expires_at timestamptz not null,
	revoked_at timestamptz,
	created_at timestamptz not null default now()
);

create index user_sessions_user_id_idx on user_sessions (user_id);
create index user_sessions_expires_at_idx on user_sessions (expires_at);
```

Session token handling:

- Generate at least 32 random bytes with `crypto/rand`.
- Encode the raw token for the cookie using base64url without padding.
- Store `sha256(raw_token)` in `user_sessions.token_hash`.
- Look up sessions by hashing the incoming cookie token.
- Treat missing, expired, or revoked sessions as unauthenticated.
- Rotate the session token on login.
- Delete or revoke the current session on logout.

Recommended lifetimes:

- Normal session: 12 hours server-side.
- Remembered session: 30 days server-side.
- For normal sessions, omit cookie `Max-Age` so the browser treats it as a
  session cookie.
- For remembered sessions, set cookie `Max-Age` to match the server-side
  expiry.

Cookie:

- Name: `arcade_session`
- `HttpOnly: true`
- `SameSite: Lax`
- `Secure: true` outside local development
- `Path: /`

## Server Design

### Request-Scoped User

Replace `s.currentUser` with a request-scoped user loaded from the session
cookie.

Suggested helpers:

```go
type contextKey string

const currentUserKey contextKey = "currentUser"

func currentUser(ctx context.Context) (User, bool)
func requireUser(ctx context.Context) (User, error)
func withCurrentUser(ctx context.Context, user User) context.Context
```

Handlers should use:

```go
user, err := requireUser(r.Context())
```

instead of:

```go
s.currentUser
```

This is the central mechanical change. Every current `s.currentUser.ID` access
needs to become request-scoped.

### Middleware

Add auth middleware around API routes.

Behavior:

1. Read `arcade_session` cookie.
2. Hash the token and look up an active, unexpired session.
3. Load the owning user.
4. Attach the user to request context.
5. Continue to the handler.
6. If missing or invalid, return `401`.

Public routes:

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`, so clients can clear cookies even when the server no
  longer recognizes the session
- Static assets under `/`

Protected routes:

- `GET /api/me`
- `PATCH /api/me`
- all preferences routes
- all external account routes
- all source/problem routes if the requirement is "login to interact with
  anything"
- all daily, group, division, submission, and leaderboard routes

If problem browsing should be public later, it can be moved out of the
protected group intentionally.

### Auth Endpoints

Add these routes:

```txt
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
```

`POST /api/auth/signup`

Request:

```json
{
  "email": "user@example.com",
  "password": "correct horse battery staple",
  "display_name": "Ada Lovelace",
  "remember_me": true
}
```

Behavior:

- Validate email, password, and display name.
- Normalize email.
- Reject duplicate email with `409`.
- Hash password.
- Create user.
- Create session.
- Set cookie.
- Return the user.

Response:

```json
{
  "id": "...",
  "email": "user@example.com",
  "display_name": "Ada Lovelace",
  "avatar_url": null,
  "created_at": "...",
  "updated_at": "..."
}
```

`POST /api/auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "correct horse battery staple",
  "remember_me": false
}
```

Behavior:

- Normalize email.
- Look up user.
- Compare password hash.
- Create session.
- Set cookie.
- Return the user.
- For either unknown email or wrong password, return `401` with a generic
  message such as `invalid email or password`.

`POST /api/auth/logout`

Behavior:

- If a valid session cookie exists, revoke or delete that session.
- Clear `arcade_session`.
- Return `204`.

`GET /api/auth/session`

Behavior:

- Return the current user if authenticated.
- Return `401` if unauthenticated.

This endpoint is useful for frontend bootstrapping. `GET /api/me` can also
serve this role, but keeping auth/session explicit makes the frontend easier to
reason about.

## Frontend Design

Add a logged-out view before loading app data.

Minimum screens:

- Login form: email, password, remember me.
- Signup form: email, password, display name, remember me.
- Logout button in the app header.

Frontend behavior:

- On boot, call `GET /api/auth/session`.
- If authenticated, load the app as it does today.
- If `401`, render the login/signup view and do not load app data.
- On login/signup success, load base app data.
- On logout, clear local state and return to login view.
- If any API request returns `401`, return to login view.

The app can continue using relative `fetch` calls. Same-origin cookies will be
sent by default. If the API is later split onto another origin, fetch must use
`credentials: "include"` and CORS must allow credentials.

## Authorization Model

Authentication answers: "Who is this user?"

Authorization answers: "Can this user perform this action?"

The minimum policy should use the existing `group_memberships.role` and
`group_memberships.status` fields.

### Roles

`owner`

- Full control over the group.
- Can update group metadata.
- Can delete the group.
- Can invite/add/remove members.
- Can promote/demote admins.
- Can transfer ownership.
- Cannot remove or demote the last active owner.

`admin`

- Can update group metadata.
- Can invite/add/remove regular members.
- Can create/update/delete divisions.
- Can generate group/division dailies if group dailies are treated as managed
  content.
- Cannot delete the group.
- Cannot promote users to owner.
- Cannot demote/remove owners.
- Cannot remove or demote admins unless that is explicitly allowed later.

`member`

- Can view groups they belong to.
- Can participate in group workflows.
- Can view group leaderboard.
- Can view group dailies.
- Cannot change group metadata.
- Cannot manage members.
- Cannot manage divisions unless explicitly allowed later.

`invited`

- Can see enough group metadata to accept or ignore an invite.
- Should not count as active on leaderboards.
- Should not perform member actions until active.

### Group Visibility

`public`

- Any logged-in user can view the group.
- Only active members should appear on member-scoped leaderboards.
- Mutations still require role checks.

`invite_only`

- Active members can view.
- Invited users can view limited invite state.
- Non-members should receive `404` or `403`. Prefer `404` if hiding existence is
  desired.

`private`

- Active members can view.
- Non-members should receive `404`.
- Invited users should only see invite-specific information if invite flows are
  added.

### Permission Helpers

Add central helpers rather than repeating ad hoc SQL in every handler.

Suggested helpers:

```go
func (s *Server) canViewGroup(ctx context.Context, userID, groupID string) error
func (s *Server) requireGroupRole(ctx context.Context, userID, groupID string, roles ...string) error
func (s *Server) requireGroupOwner(ctx context.Context, userID, groupID string) error
func (s *Server) activeGroupRole(ctx context.Context, userID, groupID string) (string, error)
```

`requireGroupRole` should only consider `status = 'active'`.

### Endpoint Policy

Group routes:

```txt
GET    /api/groups
POST   /api/groups
GET    /api/groups/{group_id}
PATCH  /api/groups/{group_id}
DELETE /api/groups/{group_id}
```

Policy:

- `GET /api/groups`: return public groups plus groups visible to the current
  user.
- `POST /api/groups`: any authenticated user can create a group. Creator
  becomes active owner.
- `GET /api/groups/{group_id}`: require `canViewGroup`.
- `PATCH /api/groups/{group_id}`: require owner or admin.
- `DELETE /api/groups/{group_id}`: require owner.

Member routes:

```txt
GET    /api/groups/{group_id}/members
POST   /api/groups/{group_id}/members
PATCH  /api/groups/{group_id}/members/{user_id}
DELETE /api/groups/{group_id}/members/{user_id}
```

Policy:

- `GET`: require `canViewGroup`.
- `POST`: require owner or admin.
- `PATCH`: require owner or admin, with special restrictions:
  - only owner can set `role = 'owner'`
  - only owner can modify an owner
  - admin cannot grant admin unless explicitly allowed
  - cannot demote or remove the last active owner
- `DELETE`: require owner or admin, with special restrictions:
  - only owner can remove an owner
  - cannot remove the last active owner
  - users may leave a group themselves if a leave route is added

Division routes:

```txt
GET    /api/groups/{group_id}/divisions
POST   /api/groups/{group_id}/divisions
GET    /api/groups/{group_id}/divisions/{division_id}
PATCH  /api/groups/{group_id}/divisions/{division_id}
DELETE /api/groups/{group_id}/divisions/{division_id}
GET    /api/groups/{group_id}/divisions/{division_id}/members
POST   /api/groups/{group_id}/divisions/{division_id}/recompute
```

Policy:

- `GET` routes: require `canViewGroup`.
- `POST/PATCH/DELETE`: require owner or admin.
- `recompute`: require owner or admin until division membership is automatic
  and safe to expose.

Daily routes:

```txt
GET  /api/me/daily
POST /api/me/dailies/generate
GET  /api/me/dailies
GET  /api/groups/{group_id}/daily
POST /api/groups/{group_id}/dailies/generate
GET  /api/groups/{group_id}/dailies
GET  /api/groups/{group_id}/divisions/{division_id}/daily
POST /api/groups/{group_id}/divisions/{division_id}/dailies/generate
GET  /api/daily-sets/{daily_set_id}
GET  /api/daily-sets/{daily_set_id}/leaderboard
```

Policy:

- `/api/me/*`: current user only.
- group daily reads: require `canViewGroup`.
- group daily generation: choose one policy and enforce it consistently:
  - recommended: owner/admin only, because this creates shared group content.
  - alternative: any active member can generate, if group dailies are treated as
    collaborative.
- `GET /api/daily-sets/{daily_set_id}` must check the set scope:
  - user daily: only owning user.
  - group daily: `canViewGroup`.
  - global daily: any authenticated user.

Submissions:

```txt
GET  /api/me/submissions
GET  /api/me/solves
POST /api/submissions/manual
POST /api/sources/{source_slug}/sync/submissions
```

Policy:

- Current user only.
- Manual submissions should only attach to daily sets the user can access.
- Source sync should only update external accounts owned by the current user.

Leaderboards:

```txt
GET /api/leaderboards
GET /api/groups/{group_id}/leaderboard
GET /api/groups/{group_id}/divisions/{division_id}/leaderboard
GET /api/daily-sets/{daily_set_id}/leaderboard
```

Policy:

- global leaderboard: authenticated users.
- group/division leaderboard: require `canViewGroup`.
- daily leaderboard: authorize based on daily set scope.

External accounts:

```txt
GET    /api/me/external-accounts
POST   /api/me/external-accounts
GET    /api/me/external-accounts/{account_id}
DELETE /api/me/external-accounts/{account_id}
POST   /api/me/external-accounts/{account_id}/verify
POST   /api/me/external-accounts/{account_id}/sync
```

Policy:

- Current user only.
- Existing ownership checks should remain.
- Verification is still local/stubbed unless a real provider proof flow is
  added.

## Migration Strategy

Recommended order:

1. Add columns/tables in a new migration:
   - `users.email`
   - `users.password_hash`
   - `user_sessions`
2. Keep the existing dev user bootstrap temporarily, but give it a deterministic
   local email and generated password only for development if needed.
3. Add password hashing helpers.
4. Add session creation, lookup, revocation, and cookie helpers.
5. Add auth endpoints.
6. Add request context current-user helpers.
7. Add auth middleware and wrap protected routes.
8. Convert handlers from `s.currentUser` to request-scoped current user.
9. Add group permission helpers.
10. Wire permission checks into group, division, daily, submissions, and
    leaderboard routes.
11. Add frontend login/signup/logout.
12. Remove or disable the singleton dev user behavior.

During development, it is acceptable to keep a local-only escape hatch such as:

```txt
ARCADE_AUTH_DEV_BYPASS=true
```

If that is added, it must default to false and should be documented as unsafe
outside local development.

## Validation Rules

Signup:

- `email` is required.
- `email` must parse as an email-like value.
- `password` is required.
- minimum password length: 8 characters.
- `display_name` is required.
- `display_name` max length: 100 characters.

Login:

- `email` is required.
- `password` is required.
- error message should not reveal whether email exists.

Group mutations:

- role must be one of `owner`, `admin`, `member`.
- status must be one of `invited`, `active`, `removed`, `left`.
- group visibility must be one of `public`, `invite_only`, `private`.

## Error Semantics

Recommended status codes:

- `400`: invalid request body or validation error.
- `401`: not authenticated or invalid login.
- `403`: authenticated but not allowed.
- `404`: resource not found, or intentionally hidden due to visibility.
- `409`: duplicate email, duplicate group slug, duplicate linked external
  account.

For private groups, prefer `404` for non-members if the product should hide
group existence.

## Tests

Add focused handler/service tests once the auth helpers exist.

Auth tests:

- signup creates user and session cookie.
- signup rejects duplicate email.
- login accepts correct password.
- login rejects wrong password with `401`.
- logout revokes the session and clears cookie.
- expired session returns `401`.
- remembered session gets longer expiry and cookie `Max-Age`.
- normal session gets shorter expiry and no persistent cookie.

Middleware tests:

- protected route rejects missing cookie.
- protected route rejects invalid cookie.
- protected route attaches current user for valid cookie.

Authorization tests:

- non-member cannot view private group.
- member cannot patch group.
- admin can patch group.
- admin cannot delete group.
- owner can delete group.
- admin can add member.
- admin cannot modify owner.
- last owner cannot be removed or demoted.
- group daily generation follows the selected policy.
- daily set access follows user/group/global scope.

Regression tests:

- `/api/me` returns the session user, not a process-wide user.
- one user's submissions do not appear in another user's `/api/me/submissions`.
- one user's preferences do not affect another user's daily generation.

## Security Checklist

- Store password hashes only.
- Store session token hashes only.
- Use `crypto/rand` for tokens.
- Set `HttpOnly` on session cookie.
- Set `Secure` outside local development.
- Set `SameSite=Lax`.
- Normalize email before unique lookup.
- Use generic login failure errors.
- Revoke session on logout.
- Filter expired/revoked sessions on every request.
- Do not log passwords or raw session tokens.
- Do not expose `password_hash` in JSON responses.

## Open Decisions

1. Should signup auto-login? Recommended: yes.
2. Should `username` remain user-editable, or become an internal slug derived
   from display name/email? Recommended: keep for compatibility but remove from
   auth requirements.
3. Should public problem browsing require login? The stated requirement says
   login is required to interact with anything, so protect it for now.
4. Should group daily generation be admin-only or member-allowed? Recommended:
   owner/admin only.
5. Should private group misses return `403` or `404`? Recommended: `404`.
6. Should there be a global admin role? Recommended: no for this pass.

