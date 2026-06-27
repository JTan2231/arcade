package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleCreateFriendRequest(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	var req struct {
		FriendCode string `json:"friend_code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	friendCode, err := normalizeFriendCode(req.FriendCode)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	target, err := s.publicUserByFriendCode(r.Context(), friendCode)
	if err != nil {
		handleError(w, err)
		return
	}
	if target.ID == current.ID {
		writeError(w, http.StatusBadRequest, "cannot send a friend request to yourself")
		return
	}

	friendRequest, status, err := s.createFriendRequest(r.Context(), current.ID, target.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, status, friendRequest)
}

func (s *Server) handleListFriendRequests(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	incoming, err := s.listPendingFriendRequests(r.Context(), "addressee_user_id", current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	outgoing, err := s.listPendingFriendRequests(r.Context(), "requester_user_id", current.ID)
	if err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, FriendRequests{
		Incoming: incoming,
		Outgoing: outgoing,
	})
}

func (s *Server) handleAcceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	friendRequest, err := s.acceptFriendRequest(r.Context(), r.PathValue("request_id"), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, friendRequest)
}

func (s *Server) handleDeclineFriendRequest(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	friendRequest, err := s.declineFriendRequest(r.Context(), r.PathValue("request_id"), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, friendRequest)
}

func (s *Server) handleCancelFriendRequest(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	friendRequest, err := s.cancelFriendRequest(r.Context(), r.PathValue("request_id"), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, friendRequest)
}

func (s *Server) handleListFriends(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	friends, err := s.listFriends(r.Context(), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, friends)
}

func (s *Server) handleDeleteFriend(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	targetUserID := r.PathValue("user_id")
	if targetUserID == current.ID {
		writeError(w, http.StatusBadRequest, "cannot unfriend yourself")
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update user_friendships
		set status = 'canceled',
		    responded_at = now()
		where status = 'accepted'
		  and user_low_id = least($1::uuid, $2::uuid)
		  and user_high_id = greatest($1::uuid, $2::uuid)
	`, current.ID, targetUserID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "friendship not found")
		return
	}

	if _, err := s.db.Exec(r.Context(), `
		delete from group_memberships
		where status = 'invited'
		  and (
			(user_id = $1 and invited_by_user_id = $2)
			or
			(user_id = $2 and invited_by_user_id = $1)
		  )
	`, current.ID, targetUserID); err != nil {
		handleError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCreateGroupInvite(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	actorRole, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.UserID == "" {
		writeError(w, http.StatusBadRequest, "user_id is required")
		return
	}
	if req.UserID == current.ID {
		writeError(w, http.StatusBadRequest, "cannot invite yourself")
		return
	}

	friends, err := s.acceptedFriendshipExists(r.Context(), current.ID, req.UserID)
	if err != nil {
		handleError(w, err)
		return
	}
	if !friends {
		handleError(w, forbidden("accepted friendship required"))
		return
	}

	existing, err := s.groupMemberState(r.Context(), groupID, req.UserID)
	if err == nil {
		switch existing.Status {
		case "active":
			writeError(w, http.StatusConflict, "user is already an active group member")
			return
		case "invited":
			invite, err := s.getGroupInvite(r.Context(), groupID, req.UserID, current.ID)
			if err != nil {
				handleError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, invite)
			return
		case "removed":
			if actorRole != "owner" && actorRole != "admin" {
				handleError(w, forbidden("owners and admins must re-invite removed members"))
				return
			}
		}
	} else if !isStatusNotFound(err) {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		insert into group_memberships (
			group_id,
			user_id,
			role,
			status,
			invited_by_user_id,
			invited_at
		)
		values ($1, $2, 'member', 'invited', $3, now())
		on conflict (group_id, user_id) do update set
			role = 'member',
			status = 'invited',
			invited_by_user_id = excluded.invited_by_user_id,
			invited_at = excluded.invited_at
		where group_memberships.status in ('left', 'removed')
	`, groupID, req.UserID, current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusConflict, "group invite already exists")
		return
	}

	invite, err := s.getGroupInvite(r.Context(), groupID, req.UserID, current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, invite)
}

func (s *Server) handleListGroupInviteCandidates(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	actorRole, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}

	candidates, err := s.listGroupInviteCandidates(r.Context(), groupID, current.ID, actorRole == "owner" || actorRole == "admin")
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, candidates)
}

func (s *Server) handleListGroupInvites(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	invites, err := s.listGroupInvites(r.Context(), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, invites)
}

func (s *Server) handleAcceptGroupInvite(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	targetUserID := r.PathValue("user_id")
	if targetUserID != current.ID {
		handleError(w, forbidden("only the invited user can accept this invite"))
		return
	}

	var invitedBy sql.NullString
	err = s.db.QueryRow(r.Context(), `
		select invited_by_user_id::text
		from group_memberships
		where group_id = $1 and user_id = $2 and status = 'invited'
	`, groupID, current.ID).Scan(&invitedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "group invite not found")
		return
	}
	if err != nil {
		handleError(w, err)
		return
	}

	if invitedBy.Valid {
		if _, err := s.activeGroupRole(r.Context(), invitedBy.String, groupID); err != nil {
			handleError(w, forbidden("group invite is no longer valid"))
			return
		}
		friends, err := s.acceptedFriendshipExists(r.Context(), current.ID, invitedBy.String)
		if err != nil {
			handleError(w, err)
			return
		}
		if !friends {
			handleError(w, forbidden("group invite is no longer valid"))
			return
		}
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_memberships
		set status = 'active',
		    joined_at = coalesce(joined_at, now())
		where group_id = $1 and user_id = $2 and status = 'invited'
	`, groupID, current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "group invite not found")
		return
	}

	group, err := s.getGroup(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, group)
}

func (s *Server) handleDeclineGroupInvite(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	targetUserID := r.PathValue("user_id")
	if targetUserID != current.ID {
		handleError(w, forbidden("only the invited user can decline this invite"))
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		delete from group_memberships
		where group_id = $1 and user_id = $2 and status = 'invited'
	`, r.PathValue("group_id"), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "group invite not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCancelGroupInvite(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	targetUserID := r.PathValue("user_id")

	var invitedBy sql.NullString
	err = s.db.QueryRow(r.Context(), `
		select invited_by_user_id::text
		from group_memberships
		where group_id = $1 and user_id = $2 and status = 'invited'
	`, groupID, targetUserID).Scan(&invitedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "group invite not found")
		return
	}
	if err != nil {
		handleError(w, err)
		return
	}

	allowed := invitedBy.Valid && invitedBy.String == current.ID
	if !allowed {
		role, err := s.activeGroupRole(r.Context(), current.ID, groupID)
		if err != nil {
			handleError(w, err)
			return
		}
		allowed = role == "owner" || role == "admin"
	}
	if !allowed {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	if _, err := s.db.Exec(r.Context(), `
		delete from group_memberships
		where group_id = $1 and user_id = $2 and status = 'invited'
	`, groupID, targetUserID); err != nil {
		handleError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) publicUserByFriendCode(ctx context.Context, friendCode string) (PublicUser, error) {
	user, err := scanPublicUser(s.db.QueryRow(ctx, `
		select id::text, username, display_name, avatar_url
		from users
		where friend_code = $1
	`, friendCode))
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicUser{}, errNotFound("friend code")
	}
	return user, err
}

func (s *Server) createFriendRequest(ctx context.Context, requesterID string, addresseeID string) (FriendRequest, int, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return FriendRequest{}, 0, err
	}
	defer tx.Rollback(ctx)

	existing, err := scanFriendRequest(tx.QueryRow(ctx, friendRequestSelectFrom("user_friendships")+`
		where f.user_low_id = least($1::uuid, $2::uuid)
		  and f.user_high_id = greatest($1::uuid, $2::uuid)
		for update of f
	`, requesterID, addresseeID))
	if errors.Is(err, pgx.ErrNoRows) {
		friendRequest, err := scanFriendRequest(tx.QueryRow(ctx, `
			with created as (
				insert into user_friendships (
					requester_user_id,
					addressee_user_id,
					user_low_id,
					user_high_id,
					status
				)
				values (
					$1,
					$2,
					least($1::uuid, $2::uuid),
					greatest($1::uuid, $2::uuid),
					'pending'
				)
				returning *
			)
		`+friendRequestSelectFrom("created"), requesterID, addresseeID))
		if err != nil {
			return FriendRequest{}, 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return FriendRequest{}, 0, err
		}
		return friendRequest, http.StatusCreated, nil
	}
	if err != nil {
		return FriendRequest{}, 0, err
	}

	var friendRequest FriendRequest
	status := http.StatusOK
	switch existing.Status {
	case "pending":
		if existing.Requester.ID == requesterID {
			friendRequest = existing
			break
		}
		friendRequest, err = updateFriendRequestInTx(ctx, tx, `
			update user_friendships
			set status = 'accepted',
			    responded_at = now(),
			    accepted_at = now()
			where id = $1
			returning *
		`, existing.ID)
	case "accepted":
		friendRequest = existing
	case "declined", "canceled":
		friendRequest, err = updateFriendRequestInTx(ctx, tx, `
			update user_friendships
			set requester_user_id = $2,
			    addressee_user_id = $3,
			    status = 'pending',
			    requested_at = now(),
			    responded_at = null,
			    accepted_at = null
			where id = $1
			returning *
		`, existing.ID, requesterID, addresseeID)
	default:
		return FriendRequest{}, 0, badRequest("unsupported friendship status")
	}
	if err != nil {
		return FriendRequest{}, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return FriendRequest{}, 0, err
	}
	return friendRequest, status, nil
}

func (s *Server) listPendingFriendRequests(ctx context.Context, column string, userID string) ([]FriendRequest, error) {
	if column != "addressee_user_id" && column != "requester_user_id" {
		return nil, badRequest("invalid friend request list")
	}
	rows, err := s.db.Query(ctx, friendRequestSelectFrom("user_friendships")+`
		where f.status = 'pending'
		  and f.`+column+` = $1
		order by f.created_at desc
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanFriendRequestRows(rows)
}

func (s *Server) acceptFriendRequest(ctx context.Context, requestID string, currentUserID string) (FriendRequest, error) {
	friendRequest, err := scanFriendRequest(s.db.QueryRow(ctx, `
		with updated as (
			update user_friendships
			set status = 'accepted',
			    responded_at = now(),
			    accepted_at = now()
			where id = $1
			  and addressee_user_id = $2
			  and status = 'pending'
			returning *
		)
	`+friendRequestSelectFrom("updated"), requestID, currentUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return FriendRequest{}, s.friendRequestActionError(ctx, requestID, currentUserID, "addressee")
	}
	return friendRequest, err
}

func (s *Server) declineFriendRequest(ctx context.Context, requestID string, currentUserID string) (FriendRequest, error) {
	friendRequest, err := scanFriendRequest(s.db.QueryRow(ctx, `
		with updated as (
			update user_friendships
			set status = 'declined',
			    responded_at = now()
			where id = $1
			  and addressee_user_id = $2
			  and status = 'pending'
			returning *
		)
	`+friendRequestSelectFrom("updated"), requestID, currentUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return FriendRequest{}, s.friendRequestActionError(ctx, requestID, currentUserID, "addressee")
	}
	return friendRequest, err
}

func (s *Server) cancelFriendRequest(ctx context.Context, requestID string, currentUserID string) (FriendRequest, error) {
	friendRequest, err := scanFriendRequest(s.db.QueryRow(ctx, `
		with updated as (
			update user_friendships
			set status = 'canceled',
			    responded_at = now()
			where id = $1
			  and requester_user_id = $2
			  and status = 'pending'
			returning *
		)
	`+friendRequestSelectFrom("updated"), requestID, currentUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return FriendRequest{}, s.friendRequestActionError(ctx, requestID, currentUserID, "requester")
	}
	return friendRequest, err
}

func (s *Server) friendRequestActionError(ctx context.Context, requestID string, currentUserID string, requiredSide string) error {
	var requesterUserID string
	var addresseeUserID string
	var status string
	err := s.db.QueryRow(ctx, `
		select requester_user_id::text, addressee_user_id::text, status
		from user_friendships
		where id = $1
	`, requestID).Scan(&requesterUserID, &addresseeUserID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound("friend request")
	}
	if err != nil {
		return err
	}
	if status != "pending" {
		return statusError{status: http.StatusConflict, message: "friend request is not pending"}
	}
	if requiredSide == "addressee" && addresseeUserID != currentUserID {
		return forbidden("only the addressee can respond to this friend request")
	}
	if requiredSide == "requester" && requesterUserID != currentUserID {
		return forbidden("only the requester can cancel this friend request")
	}
	return errNotFound("friend request")
}

func (s *Server) listFriends(ctx context.Context, userID string) ([]Friend, error) {
	rows, err := s.db.Query(ctx, `
		select
			other_user.id::text,
			other_user.username,
			other_user.display_name,
			other_user.avatar_url,
			coalesce(f.accepted_at, f.updated_at)
		from user_friendships f
		join users other_user on other_user.id = case
			when f.user_low_id = $1 then f.user_high_id
			else f.user_low_id
		end
		where f.status = 'accepted'
		  and (f.user_low_id = $1 or f.user_high_id = $1)
		order by other_user.display_name, other_user.username
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	friends := []Friend{}
	for rows.Next() {
		var friend Friend
		var avatarURL sql.NullString
		if err := rows.Scan(
			&friend.User.ID,
			&friend.User.Username,
			&friend.User.DisplayName,
			&avatarURL,
			&friend.FriendsSince,
		); err != nil {
			return nil, err
		}
		friend.User.AvatarURL = nullStringPtr(avatarURL)
		friends = append(friends, friend)
	}
	return friends, rows.Err()
}

func (s *Server) acceptedFriendshipExists(ctx context.Context, firstUserID string, secondUserID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `
		select exists(
			select 1
			from user_friendships
			where status = 'accepted'
			  and user_low_id = least($1::uuid, $2::uuid)
			  and user_high_id = greatest($1::uuid, $2::uuid)
		)
	`, firstUserID, secondUserID).Scan(&exists)
	return exists, err
}

func (s *Server) getGroupInvite(ctx context.Context, groupID string, targetUserID string, viewerUserID string) (GroupInvite, error) {
	invite, err := scanGroupInvite(s.db.QueryRow(ctx, groupInviteSelect("$3")+`
		where invite.group_id = $1
		  and invite.user_id = $2
		  and invite.status = 'invited'
	`, groupID, targetUserID, viewerUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupInvite{}, errNotFound("group invite")
	}
	return invite, err
}

func (s *Server) listGroupInvites(ctx context.Context, userID string) ([]GroupInvite, error) {
	rows, err := s.db.Query(ctx, groupInviteSelect("$1")+`
		where invite.user_id = $1
		  and invite.status = 'invited'
		order by invite.invited_at desc nulls last, invite.created_at desc
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	invites := []GroupInvite{}
	for rows.Next() {
		invite, err := scanGroupInvite(rows)
		if err != nil {
			return nil, err
		}
		invites = append(invites, invite)
	}
	return invites, rows.Err()
}

func (s *Server) listGroupInviteCandidates(ctx context.Context, groupID string, userID string, includeRemoved bool) ([]GroupInviteCandidate, error) {
	rows, err := s.db.Query(ctx, `
		with accepted_friend_ids as (
			select case
				when f.user_low_id = $2 then f.user_high_id
				else f.user_low_id
			end as user_id
			from user_friendships f
			where f.status = 'accepted'
			  and (f.user_low_id = $2 or f.user_high_id = $2)
		)
		select
			u.id::text,
			u.username,
			u.display_name,
			u.avatar_url,
			gm.status
		from accepted_friend_ids friends
		join users u on u.id = friends.user_id
		left join group_memberships gm on gm.group_id = $1 and gm.user_id = u.id
		where gm.status is null
		   or gm.status in ('left', 'invited')
		   or ($3 and gm.status = 'removed')
		order by u.display_name, u.username
	`, groupID, userID, includeRemoved)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidates := []GroupInviteCandidate{}
	for rows.Next() {
		var candidate GroupInviteCandidate
		var avatarURL sql.NullString
		var membershipStatus sql.NullString
		if err := rows.Scan(
			&candidate.User.ID,
			&candidate.User.Username,
			&candidate.User.DisplayName,
			&avatarURL,
			&membershipStatus,
		); err != nil {
			return nil, err
		}
		candidate.User.AvatarURL = nullStringPtr(avatarURL)
		candidate.MembershipStatus = nullStringPtr(membershipStatus)
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

func friendRequestSelectFrom(source string) string {
	return `
		select
			f.id::text,
			f.status,
			requester.id::text,
			requester.username,
			requester.display_name,
			requester.avatar_url,
			addressee.id::text,
			addressee.username,
			addressee.display_name,
			addressee.avatar_url,
			f.created_at,
			f.updated_at
		from ` + source + ` f
		join users requester on requester.id = f.requester_user_id
		join users addressee on addressee.id = f.addressee_user_id
	`
}

func updateFriendRequestInTx(ctx context.Context, tx pgx.Tx, query string, args ...any) (FriendRequest, error) {
	return scanFriendRequest(tx.QueryRow(ctx, `
		with updated as (
	`+query+`
		)
	`+friendRequestSelectFrom("updated"), args...))
}

func scanFriendRequestRows(rows pgx.Rows) ([]FriendRequest, error) {
	requests := []FriendRequest{}
	for rows.Next() {
		request, err := scanFriendRequest(rows)
		if err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func scanFriendRequest(row pgx.Row) (FriendRequest, error) {
	var request FriendRequest
	var requesterAvatar sql.NullString
	var addresseeAvatar sql.NullString
	if err := row.Scan(
		&request.ID,
		&request.Status,
		&request.Requester.ID,
		&request.Requester.Username,
		&request.Requester.DisplayName,
		&requesterAvatar,
		&request.Addressee.ID,
		&request.Addressee.Username,
		&request.Addressee.DisplayName,
		&addresseeAvatar,
		&request.CreatedAt,
		&request.UpdatedAt,
	); err != nil {
		return FriendRequest{}, err
	}
	request.Requester.AvatarURL = nullStringPtr(requesterAvatar)
	request.Addressee.AvatarURL = nullStringPtr(addresseeAvatar)
	return request, nil
}

func scanPublicUser(row pgx.Row) (PublicUser, error) {
	var user PublicUser
	var avatarURL sql.NullString
	if err := row.Scan(&user.ID, &user.Username, &user.DisplayName, &avatarURL); err != nil {
		return PublicUser{}, err
	}
	user.AvatarURL = nullStringPtr(avatarURL)
	return user, nil
}

func groupInviteSelect(viewerPlaceholder string) string {
	return `
		select
			g.id::text,
			g.name,
			g.slug,
			g.description,
			g.visibility,
			g.created_by_user_id::text,
			viewer.role,
			viewer.status,
			g.created_at,
			g.updated_at,
			inviter.id::text,
			inviter.username,
			inviter.display_name,
			inviter.avatar_url,
			invite.invited_at
		from group_memberships invite
		join groups g on g.id = invite.group_id
		left join group_memberships viewer on viewer.group_id = g.id and viewer.user_id = ` + viewerPlaceholder + `
		left join users inviter on inviter.id = invite.invited_by_user_id
	`
}

func scanGroupInvite(row pgx.Row) (GroupInvite, error) {
	var invite GroupInvite
	var description sql.NullString
	var role sql.NullString
	var status sql.NullString
	var inviterID sql.NullString
	var inviterUsername sql.NullString
	var inviterDisplayName sql.NullString
	var inviterAvatarURL sql.NullString
	var invitedAt sql.NullTime
	if err := row.Scan(
		&invite.Group.ID,
		&invite.Group.Name,
		&invite.Group.Slug,
		&description,
		&invite.Group.Visibility,
		&invite.Group.CreatedByUserID,
		&role,
		&status,
		&invite.Group.CreatedAt,
		&invite.Group.UpdatedAt,
		&inviterID,
		&inviterUsername,
		&inviterDisplayName,
		&inviterAvatarURL,
		&invitedAt,
	); err != nil {
		return GroupInvite{}, err
	}
	invite.Group.Description = nullStringPtr(description)
	invite.Group.MyRole = nullStringPtr(role)
	invite.Group.MyStatus = nullStringPtr(status)
	if inviterID.Valid {
		invite.InvitedBy = &PublicUser{
			ID:          inviterID.String,
			Username:    inviterUsername.String,
			DisplayName: inviterDisplayName.String,
			AvatarURL:   nullStringPtr(inviterAvatarURL),
		}
	}
	invite.InvitedAt = nullTimePtr(invitedAt)
	return invite, nil
}

func isStatusNotFound(err error) bool {
	var status statusError
	return errors.As(err, &status) && status.status == http.StatusNotFound
}
