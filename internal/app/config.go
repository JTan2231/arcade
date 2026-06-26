package app

import "os"

type Config struct {
	Addr               string
	DatabaseURL        string
	CatalogImportToken string
}

func LoadConfig() Config {
	databaseURL := firstNonEmpty(
		os.Getenv("ARCADE_DATABASE_URL"),
		os.Getenv("DATABASE_URL"),
		"postgres://localhost:5432/arcade?sslmode=disable",
	)
	addr := firstNonEmpty(os.Getenv("ARCADE_ADDR"), addrFromPort(os.Getenv("PORT")), ":8080")

	return Config{
		Addr:               addr,
		DatabaseURL:        databaseURL,
		CatalogImportToken: os.Getenv("ARCADE_CATALOG_IMPORT_TOKEN"),
	}
}

func addrFromPort(port string) string {
	if port == "" {
		return ""
	}
	return ":" + port
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
