package aozoracatalog

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"
)

type projectionKey struct {
	documentID string
	rangeKind  RangeKind
	startKey   string
	endKey     string
}

type projectionCandidate struct {
	occurrence       Occurrence
	endpoint         Endpoint
	encodedSelector  string
	sentenceClusters int
}

type projectionGroup struct {
	metadata          DocumentMetadata
	members           map[string]struct{}
	representative    projectionCandidate
	hasRepresentative bool
}

// ProjectDocument projects occurrences from one reading page. It is a
// convenient wrapper around ProjectItems for build orchestration that handles
// one browser-worker response at a time.
func ProjectDocument(metadata DocumentMetadata, occurrences []Occurrence) ([]ProjectedItem, error) {
	prepared := append([]Occurrence(nil), occurrences...)
	for i := range prepared {
		if prepared[i].HTMLPath != "" && prepared[i].HTMLPath != metadata.HTMLPath {
			return nil, fmt.Errorf("occurrence %d belongs to %q, not %q", prepared[i].Index, prepared[i].HTMLPath, metadata.HTMLPath)
		}
		prepared[i].HTMLPath = metadata.HTMLPath
	}
	return ProjectItems(map[string]DocumentMetadata{metadata.HTMLPath: metadata}, prepared)
}

// ProjectItems groups eligible occurrences by document and normalized
// endpoint pair, chooses deterministic representatives, and returns rows
// sorted by external ID. Unverified selectors are intentionally omitted.
func ProjectItems(metadataByPath map[string]DocumentMetadata, occurrences []Occurrence) ([]ProjectedItem, error) {
	prepared, err := prepareOccurrences(metadataByPath, occurrences)
	if err != nil {
		return nil, err
	}

	groups := make(map[projectionKey]*projectionGroup)
	for _, occurrence := range prepared {
		if !occurrence.Selector.Verified {
			continue
		}
		if occurrence.ExactText == "" {
			return nil, fmt.Errorf("verified occurrence %s has empty exact text", occurrence.OccurrenceID)
		}
		encodedSelector, err := SerializeSelector(occurrence.Selector)
		if err != nil {
			return nil, fmt.Errorf("occurrence %s selector: %w", occurrence.OccurrenceID, err)
		}
		if err := ValidateSelector(encodedSelector); err != nil {
			return nil, fmt.Errorf("occurrence %s selector: %w", occurrence.OccurrenceID, err)
		}
		sentenceClusters := occurrence.SentenceGraphemes
		if sentenceClusters < 0 {
			return nil, fmt.Errorf("occurrence %s has negative sentence grapheme count", occurrence.OccurrenceID)
		}
		if sentenceClusters == 0 {
			sentenceClusters = GraphemeCount(occurrence.ExactText)
		}

		seenEndpointKinds := make(map[RangeKind]struct{}, len(occurrence.Endpoints))
		for _, endpoint := range occurrence.Endpoints {
			if _, duplicate := seenEndpointKinds[endpoint.RangeKind]; duplicate {
				return nil, fmt.Errorf("occurrence %s has duplicate %q endpoints", occurrence.OccurrenceID, endpoint.RangeKind)
			}
			seenEndpointKinds[endpoint.RangeKind] = struct{}{}
			normalized, err := normalizeEndpoint(endpoint)
			if err != nil {
				return nil, fmt.Errorf("occurrence %s: %w", occurrence.OccurrenceID, err)
			}
			key := projectionKey{
				documentID: occurrence.DocumentID,
				rangeKind:  normalized.RangeKind,
				startKey:   normalized.StartKey,
				endKey:     normalized.EndKey,
			}
			group := groups[key]
			if group == nil {
				group = &projectionGroup{
					metadata: metadataByPath[occurrence.HTMLPath],
					members:  make(map[string]struct{}),
				}
				groups[key] = group
			}
			group.members[occurrence.OccurrenceID] = struct{}{}
			candidate := projectionCandidate{
				occurrence:       occurrence,
				endpoint:         normalized,
				encodedSelector:  encodedSelector,
				sentenceClusters: sentenceClusters,
			}
			if !group.hasRepresentative || representativeLess(candidate, group.representative) {
				group.representative = candidate
				group.hasRepresentative = true
			}
		}
	}

	items := make([]ProjectedItem, 0, len(groups))
	for key, group := range groups {
		if !group.hasRepresentative {
			continue
		}
		representative := group.representative
		metadata := group.metadata
		items = append(items, ProjectedItem{
			ExternalID:                 PairDocumentExternalID(key.documentID, key.rangeKind, key.startKey, key.endKey),
			Name:                       ProjectedItemName(metadata.WorkName, representative.endpoint.StartSurface, representative.endpoint.EndSurface),
			HTMLPath:                   metadata.HTMLPath,
			TextSelector:               representative.encodedSelector,
			RangeKind:                  key.rangeKind,
			StartKey:                   key.startKey,
			EndKey:                     key.endKey,
			WorkID:                     metadata.WorkID,
			WorkName:                   metadata.WorkName,
			AuthorNames:                SortedUniqueStrings(metadata.AuthorNames),
			SentenceGraphemes:          representative.sentenceClusters,
			OccurrenceCount:            len(group.members),
			DocumentID:                 key.documentID,
			RepresentativeOccurrenceID: representative.occurrence.OccurrenceID,
			SelectorVerified:           representative.occurrence.Selector.Verified,
		})
	}
	SortProjectedItems(items)
	return items, nil
}

func prepareOccurrences(metadataByPath map[string]DocumentMetadata, occurrences []Occurrence) ([]Occurrence, error) {
	prepared := append([]Occurrence(nil), occurrences...)
	byPath := make(map[string][]int)
	for i := range prepared {
		occurrence := &prepared[i]
		if occurrence.HTMLPath == "" {
			return nil, fmt.Errorf("occurrence %d has no HTML path", occurrence.Index)
		}
		metadata, ok := metadataByPath[occurrence.HTMLPath]
		if !ok {
			return nil, fmt.Errorf("occurrence %d has no metadata for %q", occurrence.Index, occurrence.HTMLPath)
		}
		if metadata.HTMLPath == "" {
			return nil, fmt.Errorf("metadata for %q has no HTML path", occurrence.HTMLPath)
		}
		if metadata.HTMLPath != occurrence.HTMLPath {
			return nil, fmt.Errorf("metadata key %q contains HTML path %q", occurrence.HTMLPath, metadata.HTMLPath)
		}
		expectedDocumentID := DocumentID(occurrence.HTMLPath)
		if occurrence.DocumentID != "" && occurrence.DocumentID != expectedDocumentID {
			return nil, fmt.Errorf("occurrence %d has document ID inconsistent with %q", occurrence.Index, occurrence.HTMLPath)
		}
		byPath[occurrence.HTMLPath] = append(byPath[occurrence.HTMLPath], i)
	}

	for htmlPath, positions := range byPath {
		documentOccurrences := make([]Occurrence, len(positions))
		for i, position := range positions {
			documentOccurrences[i] = prepared[position]
		}
		if err := ensureOccurrenceIdentities(DocumentID(htmlPath), documentOccurrences); err != nil {
			return nil, fmt.Errorf("occurrences for %q: %w", htmlPath, err)
		}
		for i, position := range positions {
			prepared[position] = documentOccurrences[i]
		}
	}
	return prepared, nil
}

func ensureOccurrenceIdentities(documentID string, occurrences []Occurrence) error {
	assignedIDs := 0
	assignedTexts := 0
	for _, occurrence := range occurrences {
		if occurrence.OccurrenceID != "" {
			assignedIDs++
		}
		if occurrence.IdentityText != "" {
			assignedTexts++
		}
	}
	if assignedIDs == 0 && assignedTexts == 0 {
		AssignOccurrenceIdentities(documentID, occurrences)
		return nil
	}
	if assignedIDs != 0 && assignedIDs != len(occurrences) || assignedTexts != len(occurrences) {
		return errors.New("mixed preassigned and unassigned occurrence identities")
	}
	return FinalizeOccurrenceIdentities(documentID, occurrences)
}

func normalizeEndpoint(endpoint Endpoint) (Endpoint, error) {
	if endpoint.RangeKind != RangeKindWord && endpoint.RangeKind != RangeKindGrapheme3 {
		return Endpoint{}, fmt.Errorf("unknown endpoint range kind %q", endpoint.RangeKind)
	}
	if endpoint.StartSurface == "" || endpoint.EndSurface == "" {
		return Endpoint{}, errors.New("endpoint surfaces must be nonempty")
	}
	startKey := KanaSoundKey(endpoint.StartSurface)
	endKey := KanaSoundKey(endpoint.EndSurface)
	if endpoint.StartKey != "" && endpoint.StartKey != startKey {
		return Endpoint{}, fmt.Errorf("start key %q does not normalize from surface %q", endpoint.StartKey, endpoint.StartSurface)
	}
	if endpoint.EndKey != "" && endpoint.EndKey != endKey {
		return Endpoint{}, fmt.Errorf("end key %q does not normalize from surface %q", endpoint.EndKey, endpoint.EndSurface)
	}
	endpoint.StartKey = startKey
	endpoint.EndKey = endKey
	return endpoint, nil
}

func representativeLess(left, right projectionCandidate) bool {
	leftRank := selectorPreferenceRank(left.occurrence.Selector)
	rightRank := selectorPreferenceRank(right.occurrence.Selector)
	if leftRank != rightRank {
		return leftRank < rightRank
	}
	if len(left.encodedSelector) != len(right.encodedSelector) {
		return len(left.encodedSelector) < len(right.encodedSelector)
	}
	if left.sentenceClusters != right.sentenceClusters {
		return left.sentenceClusters < right.sentenceClusters
	}
	return left.occurrence.OccurrenceID < right.occurrence.OccurrenceID
}

func selectorPreferenceRank(selector Selector) int {
	switch inferSelectorKind(selector) {
	case SelectorKindExact:
		return 0
	case SelectorKindRange:
		return 1
	case SelectorKindContextualExact:
		return 2
	case SelectorKindContextualRange:
		return 3
	default:
		return 4
	}
}

// ProjectedItemName constructs the short visible title from literal endpoint
// surfaces, never from normalized filter keys or the full sentence.
func ProjectedItemName(workName, startSurface, endSurface string) string {
	endpointSummary := startSurface + " … " + endSurface
	if workName == "" {
		return endpointSummary
	}
	return workName + " — " + endpointSummary
}

// SortProjectedItems applies the required stable external-ID ordering.
func SortProjectedItems(items []ProjectedItem) {
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].ExternalID < items[j].ExternalID
	})
}

// SortedUniqueStrings returns nonempty, trimmed strings in bytewise lexical
// order. It is used for deterministic contributor arrays.
func SortedUniqueStrings(values []string) []string {
	unique := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			unique[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(unique))
	for value := range unique {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

// GraphemeCount counts extended grapheme clusters for item metadata. The
// browser worker normally supplies Intl.Segmenter counts; this implementation
// covers the Unicode boundary rules relevant to the Japanese corpus and is a
// deterministic fallback for tests and hand-built occurrences.
func GraphemeCount(value string) int {
	runes := []rune(value)
	if len(runes) == 0 {
		return 0
	}
	count := 1
	regionalRun := 0
	if isRegionalIndicator(runes[0]) {
		regionalRun = 1
	}
	for i := 1; i < len(runes); i++ {
		if graphemeBoundary(runes, i, regionalRun) {
			count++
		}
		if isRegionalIndicator(runes[i]) {
			if isRegionalIndicator(runes[i-1]) {
				regionalRun++
			} else {
				regionalRun = 1
			}
		} else {
			regionalRun = 0
		}
	}
	return count
}

func graphemeBoundary(runes []rune, index, regionalRun int) bool {
	previous, current := runes[index-1], runes[index]
	if previous == '\r' && current == '\n' {
		return false
	}
	if isGraphemeControl(previous) || isGraphemeControl(current) {
		return true
	}
	if hangulNoBreak(previous, current) {
		return false
	}
	if isGraphemeExtend(current) || current == '\u200d' || unicode.Is(unicode.Mc, current) {
		return false
	}
	if isPrepend(previous) {
		return false
	}
	if isExtendedPictographic(current) && previous == '\u200d' {
		for cursor := index - 2; cursor >= 0; cursor-- {
			if isGraphemeExtend(runes[cursor]) {
				continue
			}
			if isExtendedPictographic(runes[cursor]) {
				return false
			}
			break
		}
	}
	if isRegionalIndicator(previous) && isRegionalIndicator(current) && regionalRun%2 == 1 {
		return false
	}
	return true
}

func isGraphemeControl(r rune) bool {
	if r == '\u200c' || r == '\u200d' || isGraphemeExtend(r) || isPrepend(r) {
		return false
	}
	return unicode.Is(unicode.Cc, r) || unicode.Is(unicode.Cf, r) || unicode.Is(unicode.Zl, r) || unicode.Is(unicode.Zp, r)
}

func isGraphemeExtend(r rune) bool {
	return unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Me, r) || unicode.Is(unicode.Other_Grapheme_Extend, r) || r == '\u200c' ||
		r >= '\ufe00' && r <= '\ufe0f' || r >= '\U000e0100' && r <= '\U000e01ef' ||
		r >= '\U0001f3fb' && r <= '\U0001f3ff' || r >= '\U000e0020' && r <= '\U000e007f'
}

func isRegionalIndicator(r rune) bool {
	return unicode.Is(unicode.Regional_Indicator, r)
}

func isExtendedPictographic(r rune) bool {
	if r >= '\U0001f000' && r <= '\U0001faff' {
		return true
	}
	switch {
	case r == '\u00a9', r == '\u00ae', r == '\u203c', r == '\u2049', r == '\u2122', r == '\u2139',
		r >= '\u2194' && r <= '\u2199', r >= '\u21a9' && r <= '\u21aa',
		r >= '\u231a' && r <= '\u231b', r == '\u2328', r == '\u2388', r == '\u23cf',
		r >= '\u23e9' && r <= '\u23f3', r >= '\u23f8' && r <= '\u23fa', r == '\u24c2',
		r >= '\u25aa' && r <= '\u25ab', r == '\u25b6', r == '\u25c0', r >= '\u25fb' && r <= '\u25fe',
		r >= '\u2600' && r <= '\u2604', r == '\u260e', r == '\u2611', r >= '\u2614' && r <= '\u2615',
		r == '\u2618', r == '\u261d', r == '\u2620', r >= '\u2622' && r <= '\u2623', r == '\u2626',
		r == '\u262a', r >= '\u262e' && r <= '\u262f', r >= '\u2638' && r <= '\u263a',
		r == '\u2640', r == '\u2642', r >= '\u2648' && r <= '\u2653', r >= '\u265f' && r <= '\u2660',
		r == '\u2663', r >= '\u2665' && r <= '\u2666', r == '\u2668', r == '\u267b',
		r >= '\u267e' && r <= '\u267f', r >= '\u2692' && r <= '\u2697', r == '\u2699',
		r >= '\u269b' && r <= '\u269c', r >= '\u26a0' && r <= '\u26a1', r == '\u26a7',
		r >= '\u26aa' && r <= '\u26ab', r >= '\u26b0' && r <= '\u26b1', r >= '\u26bd' && r <= '\u26be',
		r >= '\u26c4' && r <= '\u26c5', r == '\u26c8', r >= '\u26ce' && r <= '\u26cf',
		r == '\u26d1', r >= '\u26d3' && r <= '\u26d4', r >= '\u26e9' && r <= '\u26ea',
		r >= '\u26f0' && r <= '\u26f5', r >= '\u26f7' && r <= '\u26fa', r == '\u26fd',
		r == '\u2702', r == '\u2705', r >= '\u2708' && r <= '\u270d', r == '\u270f', r == '\u2712',
		r == '\u2714', r == '\u2716', r == '\u271d', r == '\u2721', r == '\u2728',
		r >= '\u2733' && r <= '\u2734', r == '\u2744', r == '\u2747', r == '\u274c', r == '\u274e',
		r >= '\u2753' && r <= '\u2755', r == '\u2757', r >= '\u2763' && r <= '\u2764',
		r >= '\u2795' && r <= '\u2797', r == '\u27a1', r == '\u27b0', r == '\u27bf',
		r >= '\u2934' && r <= '\u2935', r >= '\u2b05' && r <= '\u2b07', r >= '\u2b1b' && r <= '\u2b1c',
		r == '\u2b50', r == '\u2b55', r == '\u3030', r == '\u303d', r == '\u3297', r == '\u3299':
		return true
	default:
		return false
	}
}

func isPrepend(r rune) bool {
	return unicode.Is(unicode.Prepended_Concatenation_Mark, r)
}

func hangulNoBreak(previous, current rune) bool {
	previousType := hangulType(previous)
	currentType := hangulType(current)
	return previousType == 'L' && (currentType == 'L' || currentType == 'V' || currentType == 'A' || currentType == 'B') ||
		(previousType == 'V' || previousType == 'A') && (currentType == 'V' || currentType == 'T') ||
		(previousType == 'T' || previousType == 'B') && currentType == 'T'
}

func hangulType(r rune) rune {
	switch {
	case r >= '\u1100' && r <= '\u115f' || r >= '\ua960' && r <= '\ua97c':
		return 'L'
	case r >= '\u1160' && r <= '\u11a7' || r >= '\ud7b0' && r <= '\ud7c6':
		return 'V'
	case r >= '\u11a8' && r <= '\u11ff' || r >= '\ud7cb' && r <= '\ud7fb':
		return 'T'
	case r >= '\uac00' && r <= '\ud7a3':
		if (r-'\uac00')%28 == 0 {
			return 'A' // LV syllable
		}
		return 'B' // LVT syllable
	default:
		return 0
	}
}
