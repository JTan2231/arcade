package app

import (
	"context"
	"database/sql"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
)

func (s *Server) canViewGroup(ctx context.Context, userID string, groupID string) error {
	var visibility string
	var status sql.NullString
	err := s.db.QueryRow(ctx, `
		select g.visibility, gm.status
		from groups g
		left join group_memberships gm on gm.group_id = g.id and gm.user_id = $2
		where g.id = $1
	`, groupID, userID).Scan(&visibility, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound("group")
	}
	if err != nil {
		return err
	}

	switch visibility {
	case "public":
		return nil
	case "private":
		if status.Valid && status.String == "active" {
			return nil
		}
	}
	return errNotFound("group")
}

func (s *Server) requireGroupRole(ctx context.Context, userID string, groupID string, roles ...string) error {
	role, err := s.activeGroupRole(ctx, userID, groupID)
	if err != nil {
		return err
	}
	if slices.Contains(roles, role) {
		return nil
	}
	return forbidden("insufficient group permissions")
}

func (s *Server) requireGroupOwner(ctx context.Context, userID string, groupID string) error {
	return s.requireGroupRole(ctx, userID, groupID, "owner")
}

func (s *Server) activeGroupRole(ctx context.Context, userID string, groupID string) (string, error) {
	var role string
	err := s.db.QueryRow(ctx, `
		select role
		from group_memberships
		where group_id = $1 and user_id = $2 and status = 'active'
	`, groupID, userID).Scan(&role)
	if err == nil {
		return role, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	if err := s.groupExists(ctx, groupID); err != nil {
		return "", err
	}
	return "", forbidden("active group membership required")
}

func validGroupRole(role string) bool {
	switch role {
	case "owner", "admin", "member":
		return true
	default:
		return false
	}
}

func validGroupStatus(status string) bool {
	switch status {
	case "invited", "active", "removed", "left":
		return true
	default:
		return false
	}
}

func validGroupVisibility(visibility string) bool {
	switch visibility {
	case "public", "private":
		return true
	default:
		return false
	}
}

type groupMemberState struct {
	Role   string
	Status string
}

func (s *Server) groupMemberState(ctx context.Context, groupID string, userID string) (groupMemberState, error) {
	var member groupMemberState
	err := s.db.QueryRow(ctx, `
		select role, status
		from group_memberships
		where group_id = $1 and user_id = $2
	`, groupID, userID).Scan(&member.Role, &member.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return groupMemberState{}, errNotFound("group member")
	}
	return member, err
}

func (s *Server) activeOwnerCount(ctx context.Context, groupID string) (int, error) {
	var count int
	err := s.db.QueryRow(ctx, `
		select count(*)::integer
		from group_memberships
		where group_id = $1 and role = 'owner' and status = 'active'
	`, groupID).Scan(&count)
	return count, err
}

func (s *Server) guardGroupMemberChange(ctx context.Context, actorRole string, groupID string, target groupMemberState, finalRole string, finalStatus string) error {
	if actorRole == "admin" {
		if target.Role != "member" || finalRole != "member" {
			return forbidden("admins can only manage regular members")
		}
	}
	if target.Role == "owner" && actorRole != "owner" {
		return forbidden("only owners can modify owners")
	}
	if finalRole == "owner" && actorRole != "owner" {
		return forbidden("only owners can grant ownership")
	}
	if target.Role == "owner" && target.Status == "active" && (finalRole != "owner" || finalStatus != "active") {
		count, err := s.activeOwnerCount(ctx, groupID)
		if err != nil {
			return err
		}
		if count <= 1 {
			return forbidden("cannot remove or demote the last active owner")
		}
	}
	return nil
}
