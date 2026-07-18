package aozoracatalog

// BuildReport is the commit marker for catalog.jsonl. Upload verifies the
// recorded size and digest before it sends any request.
type BuildReport struct {
	Schema                    string `json:"schema"`
	SourceRoot                string `json:"source_root"`
	DocumentLimit             int    `json:"document_limit"`
	DocumentsSelected         int    `json:"documents_selected"`
	DocumentsProcessed        int    `json:"documents_processed"`
	DocumentsWithText         int    `json:"documents_with_text"`
	DocumentsRejected         int    `json:"documents_rejected"`
	DocumentsMetadataFallback int    `json:"documents_metadata_fallback"`
	OccurrencesSeen           int    `json:"occurrences_seen"`
	SelectorsVerified         int    `json:"selectors_verified"`
	SelectorsRejected         int    `json:"selectors_rejected"`
	WordItems                 int    `json:"word_items"`
	Grapheme3Items            int    `json:"grapheme3_items"`
	CatalogItems              int    `json:"catalog_items"`
	CatalogBytes              int64  `json:"catalog_bytes"`
	CatalogSHA256             string `json:"catalog_sha256"`
	ExtractorVersion          string `json:"extractor_version"`
	SelectorEngineRevision    string `json:"selector_engine_revision"`
	ChromiumVersion           string `json:"chromium_version"`
	DOMRoundTripsVerified     int    `json:"dom_round_trips_verified,omitempty"`
	NativeNavigationsChecked  int    `json:"native_navigations_checked,omitempty"`
	NativeNavigationsVerified int    `json:"native_navigations_verified,omitempty"`
	GeneratedAt               string `json:"generated_at"`
}
