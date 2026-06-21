package app

import "os"

type Config struct {
	Addr           string
	DatabaseURL    string
	DevUsername    string
	DevDisplayName string
}

func LoadConfig() Config {
	databaseURL := firstNonEmpty(
		os.Getenv("ARCADE_DATABASE_URL"),
		os.Getenv("DATABASE_URL"),
		"postgres://localhost:5432/arcade?sslmode=disable",
	)

	return Config{
		Addr:           firstNonEmpty(os.Getenv("ARCADE_ADDR"), ":8080"),
		DatabaseURL:    databaseURL,
		DevUsername:    firstNonEmpty(os.Getenv("ARCADE_DEV_USERNAME"), "local"),
		DevDisplayName: firstNonEmpty(os.Getenv("ARCADE_DEV_DISPLAY_NAME"), "Local Player"),
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
