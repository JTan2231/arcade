package aozoracatalog

import (
	"archive/zip"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const extendedCatalogPath = "index_pages/list_person_all_extended_utf8.zip"

var requiredCatalogColumns = [...]string{
	"作品ID",
	"作品名",
	"人物ID",
	"姓",
	"名",
	"役割フラグ",
	"XHTML/HTMLファイルURL",
	"XHTML/HTMLファイル符号化方式",
	"XHTML/HTMLファイル文字集合",
}

// HTMLMetadata is the small subset of reading-page metadata used when a
// selected document has no corresponding extended-catalogue data. It is kept
// separate from the browser worker's extraction result so inventory loading
// does not depend on that protocol.
type HTMLMetadata struct {
	WorkName    string   `json:"work_name"`
	AuthorNames []string `json:"author_names"`
}

// SelectHTMLPaths returns at most limit reading-page paths in the same lexical
// order as cards/*/files/*.html. Paths are relative to sourceRoot and always
// use slash separators. Directory and file symlinks are deliberately not
// followed, matching find's default behaviour in the prototype html-src.sh.
func SelectHTMLPaths(sourceRoot string, limit int) ([]string, error) {
	if limit < 0 {
		return nil, fmt.Errorf("document limit must not be negative")
	}
	if limit == 0 {
		return []string{}, nil
	}

	root, err := canonicalSourceRoot(sourceRoot)
	if err != nil {
		return nil, err
	}
	cardsDir := filepath.Join(root, "cards")
	people, err := os.ReadDir(cardsDir)
	if err != nil {
		return nil, fmt.Errorf("read Aozora cards directory: %w", err)
	}

	paths := make([]string, 0)
	for _, person := range people {
		if !person.IsDir() || person.Type()&os.ModeSymlink != 0 {
			continue
		}
		filesDir := filepath.Join(cardsDir, person.Name(), "files")
		filesInfo, err := os.Lstat(filesDir)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("inspect %s: %w", filesDir, err)
		}
		if !filesInfo.IsDir() || filesInfo.Mode()&os.ModeSymlink != 0 {
			continue
		}

		files, err := os.ReadDir(filesDir)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", filesDir, err)
		}
		for _, file := range files {
			if !strings.HasSuffix(file.Name(), ".html") || file.Type()&os.ModeSymlink != 0 {
				continue
			}
			info, err := file.Info()
			if err != nil {
				return nil, fmt.Errorf("inspect %s: %w", filepath.Join(filesDir, file.Name()), err)
			}
			if !info.Mode().IsRegular() {
				continue
			}
			paths = append(paths, path.Join("cards", person.Name(), "files", file.Name()))
		}
	}

	sort.Strings(paths)
	if len(paths) > limit {
		paths = paths[:limit]
	}
	return paths, nil
}

// OfficialHTMLPath validates an extended-catalogue URL and reduces it to the
// selected, source-root-relative HTML path used by item data.
func OfficialHTMLPath(sourceRoot, rawURL string, selected []string) (string, error) {
	files, err := validateSelectedFiles(sourceRoot, selected)
	if err != nil {
		return "", err
	}
	rel, err := relativeOfficialHTMLPath(rawURL)
	if err != nil {
		return "", err
	}
	if _, ok := files[rel]; !ok {
		return "", fmt.Errorf("Aozora HTML URL path %q is not a selected local file", rel)
	}
	return rel, nil
}

// LoadCatalogMetadata reads the extended UTF-8 catalogue and returns grouped
// metadata for selected files that have an accepted catalogue row. Selected
// paths without a matching row are intentionally absent until fallback data is
// merged.
func LoadCatalogMetadata(sourceRoot string, selected []string) (map[string]DocumentMetadata, error) {
	selectedFiles, err := validateSelectedFiles(sourceRoot, selected)
	if err != nil {
		return nil, err
	}

	zr, err := zip.OpenReader(filepath.Join(sourceRoot, filepath.FromSlash(extendedCatalogPath)))
	if err != nil {
		return nil, fmt.Errorf("open extended Aozora catalogue: %w", err)
	}
	defer zr.Close()

	catalogFile, err := findCatalogCSV(zr.File)
	if err != nil {
		return nil, err
	}
	rc, err := catalogFile.Open()
	if err != nil {
		return nil, fmt.Errorf("open extended Aozora catalogue CSV: %w", err)
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("read extended Aozora catalogue header: %w", err)
	}
	if len(header) > 0 {
		header[0] = strings.TrimPrefix(header[0], "\ufeff")
	}
	columns, err := catalogColumnIndexes(header)
	if err != nil {
		return nil, err
	}
	reader.FieldsPerRecord = len(header)

	groups := make(map[string]*catalogMetadataGroup, len(selectedFiles))
	for rowNumber := 2; ; rowNumber++ {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read extended Aozora catalogue row %d: %w", rowNumber, err)
		}

		row := catalogRowFromRecord(record, columns)
		if row.HTMLURL == "" {
			continue
		}

		rel, urlErr := relativeOfficialHTMLPath(row.HTMLURL)
		if urlErr != nil {
			// The extended catalogue contains references to external reading
			// sites. They are not local Aozora payloads and cannot enrich this
			// inventory. Malformed URLs claiming the official HTTPS origin are
			// treated as catalogue corruption rather than silently accepted.
			if claimsOfficialHTTPSOrigin(row.HTMLURL) {
				return nil, fmt.Errorf("extended Aozora catalogue row %d: %w", rowNumber, urlErr)
			}
			continue
		}
		if _, ok := selectedFiles[rel]; !ok {
			continue
		}

		group := groups[rel]
		if group == nil {
			group = &catalogMetadataGroup{authors: make(map[string]struct{})}
			groups[rel] = group
		}
		if err := group.add(row); err != nil {
			return nil, fmt.Errorf("extended Aozora catalogue row %d for %s: %w", rowNumber, rel, err)
		}
	}

	metadata := make(map[string]DocumentMetadata, len(groups))
	for rel, group := range groups {
		authors := make([]string, 0, len(group.authors))
		for author := range group.authors {
			authors = append(authors, author)
		}
		sort.Strings(authors)
		metadata[rel] = DocumentMetadata{
			HTMLPath:          rel,
			WorkID:            group.workID,
			WorkName:          group.workName,
			AuthorNames:       authors,
			CatalogEncoding:   group.encoding,
			CatalogCharset:    group.charset,
			catalogRolesKnown: group.rolesKnown,
		}
	}
	return metadata, nil
}

// MergeMetadataFallback produces one metadata value per selected path. Page
// metadata fills only catalogue fields that are unavailable; it never replaces
// authoritative catalogue values. The returned count is the number of
// documents for which fallback metadata was needed.
func MergeMetadataFallback(selected []string, catalog map[string]DocumentMetadata, fallbacks map[string]HTMLMetadata) (map[string]DocumentMetadata, int) {
	merged := make(map[string]DocumentMetadata, len(selected))
	fallbackCount := 0
	for _, rel := range selected {
		metadata, found := catalog[rel]
		metadata.HTMLPath = rel
		metadata.AuthorNames = sortedUniqueNames(metadata.AuthorNames)
		usedFallback := metadata.MetadataFallback || !found

		fallback := fallbacks[rel]
		if strings.TrimSpace(metadata.WorkName) == "" {
			if workName := collapseMetadataWhitespace(fallback.WorkName); workName != "" {
				metadata.WorkName = workName
				usedFallback = true
			}
		}
		if len(metadata.AuthorNames) == 0 && (!found || !metadata.catalogRolesKnown) {
			if authors := sortedUniqueNames(fallback.AuthorNames); len(authors) > 0 {
				metadata.AuthorNames = authors
				usedFallback = true
			}
		}

		metadata.MetadataFallback = usedFallback
		if usedFallback {
			fallbackCount++
		}
		merged[rel] = metadata
	}
	return merged, fallbackCount
}

// LoadDocumentMetadata is the complete inventory helper used by the build
// orchestration once reading-page fallback fields are available.
func LoadDocumentMetadata(sourceRoot string, selected []string, fallbacks map[string]HTMLMetadata) (map[string]DocumentMetadata, int, error) {
	catalog, err := LoadCatalogMetadata(sourceRoot, selected)
	if err != nil {
		return nil, 0, err
	}
	metadata, fallbackCount := MergeMetadataFallback(selected, catalog, fallbacks)
	return metadata, fallbackCount, nil
}

func validateSelectedFiles(sourceRoot string, selected []string) (map[string]struct{}, error) {
	root, err := canonicalSourceRoot(sourceRoot)
	if err != nil {
		return nil, err
	}
	files := make(map[string]struct{}, len(selected))
	for _, rel := range selected {
		if _, err := validateSelectedFile(root, rel); err != nil {
			return nil, err
		}
		if _, duplicate := files[rel]; duplicate {
			return nil, fmt.Errorf("selected HTML path %q is duplicated", rel)
		}
		files[rel] = struct{}{}
	}
	return files, nil
}

func canonicalSourceRoot(sourceRoot string) (string, error) {
	if strings.TrimSpace(sourceRoot) == "" {
		return "", fmt.Errorf("Aozora source root is empty")
	}
	abs, err := filepath.Abs(sourceRoot)
	if err != nil {
		return "", fmt.Errorf("resolve Aozora source root: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("resolve Aozora source root symlinks: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inspect Aozora source root: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("Aozora source root %q is not a directory", sourceRoot)
	}
	return filepath.Clean(resolved), nil
}

func validateSelectedFile(canonicalRoot, rel string) (string, error) {
	if err := validateRelativeHTMLPath(rel); err != nil {
		return "", fmt.Errorf("invalid selected HTML path %q: %w", rel, err)
	}
	localPath := filepath.Join(canonicalRoot, filepath.FromSlash(rel))
	resolved, err := filepath.EvalSymlinks(localPath)
	if err != nil {
		return "", fmt.Errorf("resolve selected HTML path %q: %w", rel, err)
	}
	resolved = filepath.Clean(resolved)
	containedRel, err := filepath.Rel(canonicalRoot, resolved)
	if err != nil {
		return "", fmt.Errorf("round-trip selected HTML path %q: %w", rel, err)
	}
	if filepath.ToSlash(containedRel) != rel {
		return "", fmt.Errorf("selected HTML path %q does not round-trip beneath the source root", rel)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inspect selected HTML path %q: %w", rel, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("selected HTML path %q is not a regular file", rel)
	}
	return resolved, nil
}

func validateRelativeHTMLPath(rel string) error {
	if rel == "" {
		return fmt.Errorf("path is empty")
	}
	if strings.TrimSpace(rel) != rel {
		return fmt.Errorf("path has surrounding whitespace")
	}
	if filepath.IsAbs(rel) || path.IsAbs(rel) {
		return fmt.Errorf("path is absolute")
	}
	if strings.Contains(rel, "\\") || filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel))) != rel || path.Clean(rel) != rel {
		return fmt.Errorf("path is not canonical")
	}
	parts := strings.Split(rel, "/")
	if len(parts) != 4 || parts[0] != "cards" || parts[1] == "" || parts[2] != "files" || parts[3] == "" {
		return fmt.Errorf("path must match cards/*/files/*.html")
	}
	for _, part := range parts {
		if part == "." || part == ".." {
			return fmt.Errorf("path contains a traversal segment")
		}
		for _, char := range part {
			if !isSafePathCharacter(char) {
				return fmt.Errorf("path contains an unsafe character")
			}
		}
	}
	if !strings.HasSuffix(parts[3], ".html") {
		return fmt.Errorf("path must name an HTML file")
	}
	return nil
}

func isSafePathCharacter(char rune) bool {
	return char >= 'a' && char <= 'z' ||
		char >= 'A' && char <= 'Z' ||
		char >= '0' && char <= '9' ||
		char == '_' || char == '-' || char == '.'
}

func relativeOfficialHTMLPath(raw string) (string, error) {
	if raw == "" || strings.TrimSpace(raw) != raw {
		return "", fmt.Errorf("Aozora HTML URL is empty or has surrounding whitespace")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse Aozora HTML URL: %w", err)
	}
	if u.Scheme != "https" || !strings.EqualFold(u.Hostname(), "www.aozora.gr.jp") || u.Port() != "" || u.User != nil || u.Opaque != "" {
		return "", fmt.Errorf("Aozora HTML URL must use the official https://www.aozora.gr.jp origin")
	}
	if u.RawQuery != "" || u.ForceQuery {
		return "", fmt.Errorf("Aozora HTML URL must not contain a query")
	}
	if strings.Contains(raw, "#") || u.Fragment != "" || u.RawFragment != "" {
		return "", fmt.Errorf("Aozora HTML URL must not contain a fragment")
	}
	if u.RawPath != "" || strings.Contains(u.EscapedPath(), "%") {
		return "", fmt.Errorf("Aozora HTML URL path must not use percent escapes")
	}
	if !strings.HasPrefix(u.Path, "/cards/") || strings.HasPrefix(u.Path, "//") {
		return "", fmt.Errorf("Aozora HTML URL path must begin with cards/")
	}
	rel := strings.TrimPrefix(u.Path, "/")
	if err := validateRelativeHTMLPath(rel); err != nil {
		return "", fmt.Errorf("invalid Aozora HTML URL path: %w", err)
	}
	return rel, nil
}

func claimsOfficialHTTPSOrigin(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && strings.EqualFold(u.Hostname(), "www.aozora.gr.jp")
}

func findCatalogCSV(files []*zip.File) (*zip.File, error) {
	var candidates []*zip.File
	for _, file := range files {
		if file.FileInfo().IsDir() || !strings.EqualFold(path.Ext(file.Name), ".csv") {
			continue
		}
		if path.Base(file.Name) == "list_person_all_extended_utf8.csv" {
			return file, nil
		}
		candidates = append(candidates, file)
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("extended Aozora catalogue ZIP contains no CSV file")
	}
	return nil, fmt.Errorf("extended Aozora catalogue ZIP contains multiple ambiguous CSV files")
}

func catalogColumnIndexes(header []string) (map[string]int, error) {
	all := make(map[string]int, len(header))
	for index, name := range header {
		if _, duplicate := all[name]; duplicate {
			return nil, fmt.Errorf("extended Aozora catalogue has duplicate column %q", name)
		}
		all[name] = index
	}
	required := make(map[string]int, len(requiredCatalogColumns))
	for _, name := range requiredCatalogColumns {
		index, ok := all[name]
		if !ok {
			return nil, fmt.Errorf("extended Aozora catalogue is missing required column %q", name)
		}
		required[name] = index
	}
	return required, nil
}

type catalogRow struct {
	WorkID    string
	WorkName  string
	PersonID  string
	Surname   string
	GivenName string
	Role      string
	HTMLURL   string
	Encoding  string
	Charset   string
}

func catalogRowFromRecord(record []string, columns map[string]int) catalogRow {
	return catalogRow{
		WorkID:    record[columns["作品ID"]],
		WorkName:  record[columns["作品名"]],
		PersonID:  record[columns["人物ID"]],
		Surname:   record[columns["姓"]],
		GivenName: record[columns["名"]],
		Role:      record[columns["役割フラグ"]],
		HTMLURL:   record[columns["XHTML/HTMLファイルURL"]],
		Encoding:  record[columns["XHTML/HTMLファイル符号化方式"]],
		Charset:   record[columns["XHTML/HTMLファイル文字集合"]],
	}
}

type catalogMetadataGroup struct {
	workID     string
	workName   string
	encoding   string
	charset    string
	authors    map[string]struct{}
	rolesKnown bool
}

func (group *catalogMetadataGroup) add(row catalogRow) error {
	if err := mergeCatalogValue("work ID", &group.workID, row.WorkID); err != nil {
		return err
	}
	if err := mergeCatalogValue("work name", &group.workName, collapseMetadataWhitespace(row.WorkName)); err != nil {
		return err
	}
	if err := mergeCatalogValue("HTML encoding", &group.encoding, strings.TrimSpace(row.Encoding)); err != nil {
		return err
	}
	if err := mergeCatalogValue("HTML character set", &group.charset, strings.TrimSpace(row.Charset)); err != nil {
		return err
	}
	role := strings.TrimSpace(row.Role)
	if role != "" {
		group.rolesKnown = true
	}
	if role == "著者" {
		if author := contributorName(row.Surname, row.GivenName); author != "" {
			group.authors[author] = struct{}{}
		}
	}
	return nil
}

func mergeCatalogValue(label string, current *string, candidate string) error {
	if candidate == "" {
		return nil
	}
	if *current == "" {
		*current = candidate
		return nil
	}
	if *current != candidate {
		return fmt.Errorf("conflicting %s values %q and %q", label, *current, candidate)
	}
	return nil
}

func contributorName(surname, givenName string) string {
	parts := make([]string, 0, 2)
	if surname = collapseMetadataWhitespace(surname); surname != "" {
		parts = append(parts, surname)
	}
	if givenName = collapseMetadataWhitespace(givenName); givenName != "" {
		parts = append(parts, givenName)
	}
	return strings.Join(parts, " ")
}

func sortedUniqueNames(names []string) []string {
	set := make(map[string]struct{}, len(names))
	for _, name := range names {
		if name = collapseMetadataWhitespace(name); name != "" {
			set[name] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for name := range set {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}

func collapseMetadataWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
