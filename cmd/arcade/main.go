package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"arcade/internal/app"
	"arcade/internal/migrations"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	config := app.LoadConfig()

	db, err := pgxpool.New(ctx, config.DatabaseURL)
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

	server, err := app.NewServer(ctx, db, config)
	if err != nil {
		log.Fatalf("build server: %v", err)
	}

	httpServer := &http.Server{
		Addr:              config.Addr,
		Handler:           server.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("arcade listening on http://localhost%s", config.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
