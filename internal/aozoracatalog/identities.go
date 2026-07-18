package aozoracatalog

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

const (
	documentIdentityNamespace   = "aozora-document-v2\x00"
	occurrenceIdentityNamespace = "aozora-occurrence-v2\x00"
	pairIdentityNamespace       = "aozora-pair-document-v2\x00"
	pairExternalIDPrefix        = "pair-document-v2:"
)

// KanaSoundKey applies the grouping-key normalization from the Aozora brief:
// NFKD, Katakana letters and iteration marks to Hiragana, then NFC. It does
// not alter literal endpoint surfaces used by browser selectors.
func KanaSoundKey(value string) string {
	decomposed := norm.NFKD.String(value)
	converted := strings.Map(func(r rune) rune {
		switch {
		case r >= '\u30a1' && r <= '\u30f6':
			return r - 0x60
		case r >= '\u30fd' && r <= '\u30fe':
			return r - 0x60
		default:
			return r
		}
	}, decomposed)
	return norm.NFC.String(converted)
}

// IdentityText canonicalizes exact rendered sentence text for occurrence
// identity. All Unicode whitespace runs become one U+0020 before trimming and
// NFC normalization.
func IdentityText(exactSentenceText string) string {
	var result strings.Builder
	result.Grow(len(exactSentenceText))
	pendingSpace := false
	wroteText := false
	for _, r := range exactSentenceText {
		if unicode.IsSpace(r) {
			if wroteText {
				pendingSpace = true
			}
			continue
		}
		if pendingSpace {
			result.WriteByte(' ')
			pendingSpace = false
		}
		result.WriteRune(r)
		wroteText = true
	}
	return norm.NFC.String(result.String())
}

// NormalizeOccurrenceIdentityText is the explicit-name form of IdentityText.
func NormalizeOccurrenceIdentityText(exactSentenceText string) string {
	return IdentityText(exactSentenceText)
}

// DuplicateOrdinals returns each identity text's zero-based occurrence number
// among equal texts in the supplied document order.
func DuplicateOrdinals(identityTexts []string) []int {
	ordinals := make([]int, len(identityTexts))
	seen := make(map[string]int, len(identityTexts))
	for i, identityText := range identityTexts {
		ordinals[i] = seen[identityText]
		seen[identityText]++
	}
	return ordinals
}

// AssignOccurrenceIdentities derives canonical identity text, duplicate
// ordinals, and stable IDs in occurrence Index order. Equal indexes retain
// their input order.
func AssignOccurrenceIdentities(documentID string, occurrences []Occurrence) {
	order := make([]int, len(occurrences))
	for i := range occurrences {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool {
		return occurrences[order[i]].Index < occurrences[order[j]].Index
	})

	seen := make(map[string]int, len(occurrences))
	for _, occurrenceIndex := range order {
		occurrence := &occurrences[occurrenceIndex]
		occurrence.DocumentID = documentID
		occurrence.IdentityText = IdentityText(occurrence.ExactText)
		occurrence.DuplicateOrdinal = seen[occurrence.IdentityText]
		seen[occurrence.IdentityText]++
		occurrence.OccurrenceID = OccurrenceID(documentID, occurrence.IdentityText, occurrence.DuplicateOrdinal)
	}
}

// FinalizeOccurrenceIdentities validates identity text and duplicate ordinals
// supplied by the browser worker, then fills the Go-owned document and
// occurrence digests without renumbering. Preserving the worker ordinal is
// essential when an earlier duplicate occurrence was rejected and therefore
// is absent from the eligible occurrence slice.
func FinalizeOccurrenceIdentities(documentID string, occurrences []Occurrence) error {
	seenIDs := make(map[string]struct{}, len(occurrences))
	for index := range occurrences {
		occurrence := &occurrences[index]
		identityText := IdentityText(occurrence.ExactText)
		if occurrence.IdentityText != identityText {
			return fmt.Errorf("occurrence %d identity text is inconsistent with exact text", occurrence.Index)
		}
		if occurrence.DuplicateOrdinal < 0 {
			return fmt.Errorf("occurrence %d has a negative duplicate ordinal", occurrence.Index)
		}
		if occurrence.DocumentID != "" && occurrence.DocumentID != documentID {
			return fmt.Errorf("occurrence %d has an inconsistent document ID", occurrence.Index)
		}
		wantID := OccurrenceID(documentID, identityText, occurrence.DuplicateOrdinal)
		if occurrence.OccurrenceID != "" && occurrence.OccurrenceID != wantID {
			return fmt.Errorf("occurrence %d has an inconsistent occurrence ID", occurrence.Index)
		}
		if _, duplicate := seenIDs[wantID]; duplicate {
			return fmt.Errorf("duplicate occurrence ID %q", wantID)
		}
		seenIDs[wantID] = struct{}{}
		occurrence.DocumentID = documentID
		occurrence.OccurrenceID = wantID
	}
	return nil
}

// DocumentID returns the stable lowercase SHA-256 identity for an exact
// source-relative HTML path.
func DocumentID(htmlPath string) string {
	return identityDigest(documentIdentityNamespace + htmlPath)
}

// OccurrenceID returns the stable identity for a sentence occurrence. The
// selector is deliberately not an input.
func OccurrenceID(documentID, identityText string, duplicateOrdinal int) string {
	payload := occurrenceIdentityNamespace + documentID + "\x00" + identityText + "\x00" + strconv.Itoa(duplicateOrdinal)
	return identityDigest(payload)
}

// PairDocumentExternalID returns the representative-independent Arcade item
// identity for an endpoint pair in one document.
func PairDocumentExternalID(documentID string, rangeKind RangeKind, startKey, endKey string) string {
	payload := pairIdentityNamespace + documentID + "\x00" + string(rangeKind) + "\x00" + startKey + "\x00" + endKey
	return pairExternalIDPrefix + identityDigest(payload)
}

func identityDigest(payload string) string {
	digest := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(digest[:])
}
