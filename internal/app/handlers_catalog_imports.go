package app

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"arcade/internal/catalogimport"
)

const maxCatalogImportUploadBytes = 64 << 20

type catalogImportValidationResponse struct {
	Error  string                        `json:"error"`
	Errors []catalogimport.ImportMessage `json:"errors"`
}

func (s *Server) handleCatalogImport(w http.ResponseWriter, r *http.Request) {
	if !s.catalogImportTokenConfigured() {
		writeError(w, http.StatusServiceUnavailable, "catalog import token is not configured")
		return
	}
	if !s.catalogImportTokenValid(r) {
		writeError(w, http.StatusUnauthorized, "invalid catalog import token")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxCatalogImportUploadBytes)
	if err := r.ParseMultipartForm(maxCatalogImportUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart upload")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	dryRun, err := parseOptionalBool(r.FormValue("dry_run"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "dry_run must be a boolean")
		return
	}

	var ownerUserID *string
	if raw := strings.TrimSpace(r.FormValue("owner_user_id")); raw != "" {
		if !catalogimport.ValidUUID(raw) {
			writeError(w, http.StatusBadRequest, "owner_user_id must be a UUID")
			return
		}
		ownerUserID = &raw
	}

	groupID := strings.TrimSpace(r.FormValue("group_id"))
	if groupID != "" && !catalogimport.ValidUUID(groupID) {
		writeError(w, http.StatusBadRequest, "group_id must be a UUID")
		return
	}

	result, err := catalogimport.ImportJSONL(r.Context(), s.db, file, catalogimport.Options{
		DryRun:      dryRun,
		GroupID:     groupID,
		OwnerUserID: ownerUserID,
		AllowGlobal: true,
	})
	if err != nil {
		var validationErr catalogimport.ValidationError
		if errors.As(err, &validationErr) {
			writeJSON(w, http.StatusBadRequest, catalogImportValidationResponse{
				Error:  "catalog import validation failed",
				Errors: validationErr.Result.Errors,
			})
			return
		}
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) catalogImportTokenConfigured() bool {
	return s.catalogImportToken != ""
}

func (s *Server) catalogImportTokenValid(r *http.Request) bool {
	provided := bearerToken(r.Header.Get("Authorization"))
	if provided == "" {
		provided = strings.TrimSpace(r.Header.Get("X-Arcade-Catalog-Import-Token"))
	}
	if provided == "" || len(provided) != len(s.catalogImportToken) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(s.catalogImportToken)) == 1
}

func bearerToken(header string) string {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func parseOptionalBool(raw string) (bool, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case "":
		return false, nil
	case "1", "t", "true", "yes", "y", "on":
		return true, nil
	case "0", "f", "false", "no", "n", "off":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean %q", raw)
	}
}
