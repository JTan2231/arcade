package app

import (
	"os"
	"strings"
)

type Config struct {
	Addr                  string
	DatabaseURL           string
	CatalogImportToken    string
	DevPersistentSessions bool
}

func LoadConfig() Config {
	databaseURL := firstNonEmpty(
		os.Getenv("ARCADE_DATABASE_URL"),
		os.Getenv("DATABASE_URL"),
		"postgres://localhost:5432/arcade?sslmode=disable",
	)
	addr := firstNonEmpty(os.Getenv("ARCADE_ADDR"), addrFromPort(os.Getenv("PORT")), ":8080")

	return Config{
		Addr:                  addr,
		DatabaseURL:           databaseURL,
		CatalogImportToken:    os.Getenv("ARCADE_CATALOG_IMPORT_TOKEN"),
		DevPersistentSessions: truthyEnv(os.Getenv("ARCADE_DEV_PERSIST_SESSIONS")),
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

func truthyEnv(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "t", "true", "y", "yes", "on":
		return true
	default:
		return false
	}
}
