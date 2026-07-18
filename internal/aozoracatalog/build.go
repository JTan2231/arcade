package aozoracatalog

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type ExtractRequest struct {
	SourceRoot   string
	HTMLPath     string
	Encoding     string
	Charset      string
	NativeSample bool
}

type ExtractResult struct {
	HasText           bool         `json:"has_text"`
	RejectedReason    string       `json:"rejected_reason,omitempty"`
	Metadata          HTMLMetadata `json:"metadata"`
	Occurrences       []Occurrence `json:"occurrences"`
	OccurrencesSeen   int          `json:"occurrences_seen"`
	SelectorsVerified int          `json:"selectors_verified"`
	SelectorsRejected int          `json:"selectors_rejected"`
}

type ExtractorStats struct {
	SelectorEngineRevision    string `json:"selector_engine_revision"`
	ChromiumVersion           string `json:"chromium_version"`
	DOMRoundTripsVerified     int    `json:"dom_round_trips_verified"`
	NativeNavigationsChecked  int    `json:"native_navigations_checked"`
	NativeNavigationsVerified int    `json:"native_navigations_verified"`
}

type Extractor interface {
	Extract(context.Context, ExtractRequest) (ExtractResult, error)
	Stats(context.Context) (ExtractorStats, error)
	Close() error
}

type BuildOptions struct {
	SourceRoot      string
	OutputDirectory string
	GeneratedAt     time.Time
	Extractor       Extractor
	WorkerScript    string
	NodeBinary      string
	WorkerStderr    io.Writer
	Progress        func(processed, total int, htmlPath string)
}

func Build(ctx context.Context, options BuildOptions) (BuildReport, error) {
	if strings.TrimSpace(options.OutputDirectory) == "" {
		return BuildReport{}, errors.New("output directory is required")
	}
	sourceRoot, err := resolvedDirectory(options.SourceRoot)
	if err != nil {
		return BuildReport{}, fmt.Errorf("resolve Aozora source root: %w", err)
	}
	selected, err := SelectHTMLPaths(sourceRoot, documentLimit)
	if err != nil {
		return BuildReport{}, err
	}
	if len(selected) != documentLimit {
		return BuildReport{}, fmt.Errorf("selected %d Aozora HTML documents, want exactly %d", len(selected), documentLimit)
	}
	catalogMetadata, err := LoadCatalogMetadata(sourceRoot, selected)
	if err != nil {
		return BuildReport{}, err
	}

	extractor := options.Extractor
	ownedExtractor := false
	if extractor == nil {
		extractor, err = NewBrowserExtractor(ctx, BrowserExtractorOptions{
			ScriptPath: options.WorkerScript,
			NodeBinary: options.NodeBinary,
			Stderr:     options.WorkerStderr,
		})
		if err != nil {
			return BuildReport{}, err
		}
		ownedExtractor = true
	}
	closed := false
	defer func() {
		if ownedExtractor && !closed {
			_ = extractor.Close()
		}
	}()

	report := BuildReport{
		Schema:            BuildReportSchema,
		SourceRoot:        sourceRoot,
		DocumentLimit:     documentLimit,
		DocumentsSelected: len(selected),
		ExtractorVersion:  ExtractorVersion,
	}
	fallbacks := make(map[string]HTMLMetadata, len(selected))
	occurrences := make([]Occurrence, 0, 64_000)
	for index, htmlPath := range selected {
		if err := ctx.Err(); err != nil {
			return BuildReport{}, err
		}
		metadata := catalogMetadata[htmlPath]
		result, err := extractor.Extract(ctx, ExtractRequest{
			SourceRoot:   sourceRoot,
			HTMLPath:     htmlPath,
			Encoding:     metadata.CatalogEncoding,
			Charset:      metadata.CatalogCharset,
			NativeSample: index%10 == 0,
		})
		if err != nil {
			return BuildReport{}, fmt.Errorf("extract %s: %w", htmlPath, err)
		}
		report.DocumentsProcessed++
		fallbacks[htmlPath] = result.Metadata
		report.OccurrencesSeen += result.OccurrencesSeen
		report.SelectorsVerified += result.SelectorsVerified
		report.SelectorsRejected += result.SelectorsRejected

		if result.RejectedReason != "" || !result.HasText {
			report.DocumentsRejected++
		} else {
			report.DocumentsWithText++
			documentOccurrences, err := validateExtractedOccurrences(htmlPath, result)
			if err != nil {
				return BuildReport{}, fmt.Errorf("validate extraction for %s: %w", htmlPath, err)
			}
			occurrences = append(occurrences, documentOccurrences...)
		}
		if options.Progress != nil {
			options.Progress(index+1, len(selected), htmlPath)
		}
	}
	if report.DocumentsProcessed != documentLimit {
		return BuildReport{}, fmt.Errorf("processed %d documents, want %d", report.DocumentsProcessed, documentLimit)
	}

	stats, err := extractor.Stats(ctx)
	if err != nil {
		return BuildReport{}, fmt.Errorf("read browser worker stats: %w", err)
	}
	if ownedExtractor {
		if err := extractor.Close(); err != nil {
			return BuildReport{}, fmt.Errorf("stop browser worker: %w", err)
		}
		closed = true
	}
	if strings.TrimSpace(stats.SelectorEngineRevision) == "" {
		return BuildReport{}, errors.New("browser worker did not report a selector engine revision")
	}
	if strings.TrimSpace(stats.ChromiumVersion) == "" {
		return BuildReport{}, errors.New("browser worker did not report a Chromium version")
	}
	report.SelectorEngineRevision = stats.SelectorEngineRevision
	report.ChromiumVersion = stats.ChromiumVersion
	report.DOMRoundTripsVerified = stats.DOMRoundTripsVerified
	report.NativeNavigationsChecked = stats.NativeNavigationsChecked
	report.NativeNavigationsVerified = stats.NativeNavigationsVerified
	if stats.NativeNavigationsChecked != stats.NativeNavigationsVerified {
		return BuildReport{}, fmt.Errorf("only %d of %d sampled native Text Fragment navigations verified", stats.NativeNavigationsVerified, stats.NativeNavigationsChecked)
	}
	if stats.DOMRoundTripsVerified != report.SelectorsVerified {
		return BuildReport{}, fmt.Errorf("browser worker stats report %d verified selectors, document results report %d", stats.DOMRoundTripsVerified, report.SelectorsVerified)
	}
	if report.SelectorsVerified > 0 && stats.NativeNavigationsChecked == 0 {
		return BuildReport{}, errors.New("browser worker performed no sampled native Text Fragment navigations")
	}

	metadata, fallbackCount := MergeMetadataFallback(selected, catalogMetadata, fallbacks)
	report.DocumentsMetadataFallback = fallbackCount
	items, err := ProjectItems(metadata, occurrences)
	if err != nil {
		return BuildReport{}, fmt.Errorf("project endpoint pairs: %w", err)
	}
	for _, item := range items {
		switch item.RangeKind {
		case RangeKindWord:
			report.WordItems++
		case RangeKindGrapheme3:
			report.Grapheme3Items++
		default:
			return BuildReport{}, fmt.Errorf("projected unknown range kind %q", item.RangeKind)
		}
	}
	report.CatalogItems = len(items)
	if report.CatalogItems != report.WordItems+report.Grapheme3Items {
		return BuildReport{}, errors.New("projected item counts are inconsistent")
	}

	generatedAt := options.GeneratedAt
	if generatedAt.IsZero() {
		generatedAt = time.Now().UTC()
	} else {
		generatedAt = generatedAt.UTC()
	}
	report.GeneratedAt = generatedAt.Format(time.RFC3339)
	catalog, err := FormatCatalog(items, generatedAt)
	if err != nil {
		return BuildReport{}, err
	}
	report, err = CommitCatalog(options.OutputDirectory, catalog, report)
	if err != nil {
		return BuildReport{}, err
	}
	return report, nil
}

func validateExtractedOccurrences(htmlPath string, result ExtractResult) ([]Occurrence, error) {
	if result.OccurrencesSeen < 0 || result.SelectorsVerified < 0 || result.SelectorsRejected < 0 {
		return nil, errors.New("worker returned negative counts")
	}
	if result.SelectorsVerified+result.SelectorsRejected != result.OccurrencesSeen {
		return nil, errors.New("selector verified and rejected counts do not cover occurrences seen")
	}
	if len(result.Occurrences) > result.OccurrencesSeen {
		return nil, errors.New("worker returned more occurrence records than occurrences seen")
	}

	documentID := DocumentID(htmlPath)
	all := append([]Occurrence(nil), result.Occurrences...)
	seenIndexes := make(map[int]struct{}, len(all))
	seenIdentityOrdinals := make(map[string]struct{}, len(all))
	verifiedRecords := 0
	for index := range all {
		occurrence := &all[index]
		if occurrence.Index < 0 {
			return nil, errors.New("occurrence index must not be negative")
		}
		if _, duplicate := seenIndexes[occurrence.Index]; duplicate {
			return nil, fmt.Errorf("duplicate occurrence index %d", occurrence.Index)
		}
		seenIndexes[occurrence.Index] = struct{}{}
		identityText := IdentityText(occurrence.ExactText)
		if !utf8.ValidString(occurrence.ExactText) || identityText == "" {
			return nil, fmt.Errorf("occurrence %d has empty or invalid exact text", occurrence.Index)
		}
		if occurrence.IdentityText != "" && occurrence.IdentityText != identityText {
			return nil, fmt.Errorf("occurrence %d identity text does not match exact text", occurrence.Index)
		}
		if occurrence.DuplicateOrdinal < 0 {
			return nil, fmt.Errorf("occurrence %d has a negative duplicate ordinal", occurrence.Index)
		}
		ordinalKey := identityText + "\x00" + fmt.Sprint(occurrence.DuplicateOrdinal)
		if _, duplicate := seenIdentityOrdinals[ordinalKey]; duplicate {
			return nil, fmt.Errorf("occurrence %d repeats an identity ordinal", occurrence.Index)
		}
		seenIdentityOrdinals[ordinalKey] = struct{}{}
		occurrence.IdentityText = identityText
		occurrence.DocumentID = documentID
		occurrence.OccurrenceID = OccurrenceID(documentID, identityText, occurrence.DuplicateOrdinal)
		if !hasTerminalPeriod(occurrence.ExactText) {
			return nil, fmt.Errorf("occurrence %d does not retain its terminal period", occurrence.Index)
		}
		if occurrence.SentenceGraphemes <= 0 {
			return nil, fmt.Errorf("occurrence %d has invalid sentence grapheme count", occurrence.Index)
		}
		occurrence.HTMLPath = htmlPath
		occurrence.DocumentID = documentID
		if !occurrence.Selector.Verified {
			continue
		}
		verifiedRecords++
		encoded, err := SerializeSelector(occurrence.Selector)
		if err != nil {
			return nil, fmt.Errorf("occurrence %d selector: %w", occurrence.Index, err)
		}
		if occurrence.Selector.Encoded == "" {
			occurrence.Selector.Encoded = encoded
		}
		if err := ValidateSelector(occurrence.Selector.Encoded); err != nil {
			return nil, fmt.Errorf("occurrence %d selector encoding: %w", occurrence.Index, err)
		}
		seenKinds := make(map[RangeKind]struct{}, len(occurrence.Endpoints))
		for endpointIndex := range occurrence.Endpoints {
			endpoint := &occurrence.Endpoints[endpointIndex]
			if endpoint.RangeKind != RangeKindWord && endpoint.RangeKind != RangeKindGrapheme3 {
				return nil, fmt.Errorf("occurrence %d has unknown endpoint range kind %q", occurrence.Index, endpoint.RangeKind)
			}
			if _, duplicate := seenKinds[endpoint.RangeKind]; duplicate {
				return nil, fmt.Errorf("occurrence %d repeats endpoint range kind %q", occurrence.Index, endpoint.RangeKind)
			}
			seenKinds[endpoint.RangeKind] = struct{}{}
			if strings.TrimSpace(endpoint.StartSurface) == "" || strings.TrimSpace(endpoint.EndSurface) == "" {
				return nil, fmt.Errorf("occurrence %d has empty endpoint surface", occurrence.Index)
			}
			endpoint.StartKey = KanaSoundKey(endpoint.StartSurface)
			endpoint.EndKey = KanaSoundKey(endpoint.EndSurface)
			if endpoint.StartKey == "" || endpoint.EndKey == "" {
				return nil, fmt.Errorf("occurrence %d has empty normalized endpoint key", occurrence.Index)
			}
		}
	}
	if verifiedRecords != result.SelectorsVerified {
		return nil, errors.New("verified occurrence records do not match worker verified count")
	}

	eligible := make([]Occurrence, 0, verifiedRecords)
	for _, occurrence := range all {
		if occurrence.Selector.Verified && len(occurrence.Endpoints) != 0 {
			eligible = append(eligible, occurrence)
		}
	}
	sort.SliceStable(eligible, func(i, j int) bool { return eligible[i].Index < eligible[j].Index })
	return eligible, nil
}

func hasTerminalPeriod(value string) bool {
	value = strings.TrimRight(value, " \t\r\n\f\v\u00a0\u3000")
	return strings.HasSuffix(value, "。") || strings.HasSuffix(value, "．") || strings.HasSuffix(value, "｡")
}

func resolvedDirectory(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", errors.New("directory is empty")
	}
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%q is not a directory", value)
	}
	return filepath.Clean(resolved), nil
}
