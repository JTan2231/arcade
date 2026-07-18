package aozoracatalog

// RangeKind identifies the endpoint segmentation used for a projected item.
type RangeKind string

const (
	RangeKindWord      RangeKind = "word"
	RangeKindGrapheme3 RangeKind = "grapheme3"
)

// SelectorKind describes the structural form of a Text Fragment selector.
type SelectorKind string

const (
	SelectorKindExact           SelectorKind = "exact"
	SelectorKindRange           SelectorKind = "range"
	SelectorKindContextualExact SelectorKind = "contextual_exact"
	SelectorKindContextualRange SelectorKind = "contextual_range"
)

// DocumentMetadata is the metadata retained for one selected reading page.
// Identifiers intentionally remain strings so leading zeroes are preserved.
type DocumentMetadata struct {
	HTMLPath          string   `json:"html_path"`
	WorkID            string   `json:"work_id,omitempty"`
	WorkName          string   `json:"work_name,omitempty"`
	AuthorNames       []string `json:"author_names,omitempty"`
	CatalogEncoding   string   `json:"catalog_encoding,omitempty"`
	CatalogCharset    string   `json:"catalog_charset,omitempty"`
	MetadataFallback  bool     `json:"metadata_fallback,omitempty"`
	catalogRolesKnown bool
}

// Document combines selected source metadata with its stable identity.
type Document struct {
	ID       string
	Metadata DocumentMetadata
}

// DOMPoint and DOMRange are transient browser-worker coordinates. They are
// kept only long enough to verify a selector and are never projected to item
// data.
type DOMPoint struct {
	Path   []int `json:"path"`
	Offset int   `json:"offset"`
}

type DOMRange struct {
	Start DOMPoint `json:"start"`
	End   DOMPoint `json:"end"`
}

// Selector is the raw, literal Text Fragment model returned by the browser
// worker together with its canonical encoded value and verification result.
type Selector struct {
	Kind     SelectorKind `json:"kind"`
	Prefix   string       `json:"prefix,omitempty"`
	Start    string       `json:"start"`
	End      string       `json:"end,omitempty"`
	Suffix   string       `json:"suffix,omitempty"`
	Encoded  string       `json:"encoded,omitempty"`
	Strategy string       `json:"strategy,omitempty"`
	Verified bool         `json:"verified"`
}

// RawSelector is an alias matching the terminology used in the build brief.
type RawSelector = Selector

// Endpoint preserves literal endpoint surfaces separately from their
// normalized grouping/filter keys.
type Endpoint struct {
	RangeKind    RangeKind `json:"range_kind"`
	StartSurface string    `json:"start_surface"`
	EndSurface   string    `json:"end_surface"`
	StartKey     string    `json:"start_key"`
	EndKey       string    `json:"end_key"`
}

// Occurrence is an in-memory period-terminated sentence occurrence. The
// browser-owned fields use JSON tags matching the worker protocol; Go fills
// HTMLPath, DocumentID, and OccurrenceID before projection.
type Occurrence struct {
	Index             int        `json:"index"`
	ExactText         string     `json:"exact_text"`
	IdentityText      string     `json:"identity_text"`
	DuplicateOrdinal  int        `json:"duplicate_ordinal"`
	SentenceGraphemes int        `json:"sentence_graphemes"`
	Range             DOMRange   `json:"range"`
	Selector          Selector   `json:"selector"`
	Endpoints         []Endpoint `json:"endpoints"`
	HTMLPath          string     `json:"-"`
	DocumentID        string     `json:"-"`
	OccurrenceID      string     `json:"-"`
}

// ProjectedItem is one pair-per-document row ready for Arcade formatting.
// Internal provenance fields are deliberately excluded from JSON; output.go
// is responsible for constructing the explicit catalogue item data object.
type ProjectedItem struct {
	ExternalID                 string
	Name                       string
	HTMLPath                   string
	TextSelector               string
	RangeKind                  RangeKind
	StartKey                   string
	EndKey                     string
	WorkID                     string
	WorkName                   string
	AuthorNames                []string
	SentenceGraphemes          int
	OccurrenceCount            int
	DocumentID                 string
	RepresentativeOccurrenceID string
	SelectorVerified           bool
}
