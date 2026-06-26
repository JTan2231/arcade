package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"arcade/internal/catalogimport"
	"arcade/internal/migrations"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultDatabaseURL = "postgres://localhost:5432/arcade?sslmode=disable"

func main() {
	var filePath string
	var databaseURL string
	var groupID string
	var ownerUserID string
	var dryRun bool

	flag.StringVar(&filePath, "file", "", "normalized arcade.catalog_import.v1 JSONL file")
	flag.StringVar(&databaseURL, "database-url", firstNonEmpty(os.Getenv("ARCADE_DATABASE_URL"), os.Getenv("DATABASE_URL"), defaultDatabaseURL), "Postgres connection URL")
	flag.StringVar(&groupID, "group-id", "", "target group UUID for group-scoped imports")
	flag.StringVar(&ownerUserID, "owner-user-id", "", "optional provenance user UUID for newly inserted sources")
	flag.BoolVar(&dryRun, "dry-run", false, "validate without writing to the database")
	flag.Parse()

	if strings.TrimSpace(filePath) == "" {
		log.Fatal("-file is required")
	}
	if ownerUserID != "" && !catalogimport.ValidUUID(ownerUserID) {
		log.Fatal("-owner-user-id must be a UUID")
	}
	if groupID != "" && !catalogimport.ValidUUID(groupID) {
		log.Fatal("-group-id must be a UUID")
	}

	file, err := os.Open(filePath)
	if err != nil {
		log.Fatalf("open import file: %v", err)
	}
	defer file.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var owner *string
	if ownerUserID != "" {
		owner = &ownerUserID
	}
	opts := catalogimport.Options{
		DryRun:      dryRun,
		GroupID:     groupID,
		OwnerUserID: owner,
		AllowGlobal: true,
	}

	var result catalogimport.Result
	if dryRun {
		_, parsed, err := catalogimport.ParseJSONL(file, opts)
		result = parsed
		if err != nil {
			log.Fatalf("parse import file: %v", err)
		}
		if len(result.Errors) == 0 {
			result.Status = "completed"
		}
	} else {
		db, err := pgxpool.New(ctx, databaseURL)
		if err != nil {
			log.Fatalf("configure database: %v", err)
		}
		defer db.Close()

		if err := db.Ping(ctx); err != nil {
			log.Fatalf("connect database: %v", err)
		}
		if err := migrations.Run(ctx, db); err != nil {
			log.Fatalf("run migrations: %v", err)
		}

		result, err = catalogimport.ImportJSONL(ctx, db, file, opts)
		if err != nil {
			var validationErr catalogimport.ValidationError
			if !errors.As(err, &validationErr) {
				log.Fatalf("import catalog: %v", err)
			}
			result = validationErr.Result
		}
	}

	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		log.Fatalf("write result: %v", err)
	}
	if len(result.Errors) > 0 {
		fmt.Fprintln(os.Stderr, "catalog import validation failed")
		os.Exit(1)
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
