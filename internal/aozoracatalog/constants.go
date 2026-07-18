package aozoracatalog

const (
	documentLimit           = 100
	maxCatalogArtifactBytes = 60 << 20

	CatalogSourceSlug = "aozora-period-ranges-v2"
	CatalogSourceName = "Aozora Period Ranges"
	CatalogTemplate   = "https://www.aozora.gr.jp/{html_path}#:~:text={text_selector}"
	ExtractorVersion  = "aozora-catalog-v2"
	BuildReportSchema = "aozora.arcade-build.v2"
)

// DocumentLimit is the deliberately fixed input scope for the initial
// catalogue. It is exported for command reporting and black-box tests; there
// is intentionally no corresponding CLI flag.
const DocumentLimit = documentLimit

// MaxCatalogArtifactBytes leaves space under Arcade's 64 MiB multipart limit
// for multipart boundaries and request headers.
const MaxCatalogArtifactBytes = maxCatalogArtifactBytes
