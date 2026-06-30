package main

import (
	"strings"
	"testing"
)

func TestIsLocalPostgresTarget(t *testing.T) {
	tests := []struct {
		name        string
		databaseURL string
		want        bool
	}{
		{
			name:        "localhost",
			databaseURL: "postgres://localhost:5432/arcade?sslmode=disable",
			want:        true,
		},
		{
			name:        "loopback ipv4",
			databaseURL: "postgres://127.0.0.1:5432/arcade?sslmode=disable",
			want:        true,
		},
		{
			name:        "loopback ipv6",
			databaseURL: "postgres://[::1]:5432/arcade?sslmode=disable",
			want:        true,
		},
		{
			name:        "unix socket",
			databaseURL: "postgres:///arcade?host=/var/run/postgresql",
			want:        true,
		},
		{
			name:        "remote",
			databaseURL: "postgres://db.example.com:5432/arcade?sslmode=require",
			want:        false,
		},
		{
			name:        "not a postgres URL",
			databaseURL: "https://localhost/arcade",
			want:        false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isLocalPostgresTarget(test.databaseURL); got != test.want {
				t.Fatalf("isLocalPostgresTarget() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestValidateOptionsRejectsUnsafeTargetByDefault(t *testing.T) {
	err := validateOptions(mirrorOptions{
		prodURL:  "postgres://prod.example.com/arcade",
		localURL: "postgres://db.example.com/arcade",
	})
	if err == nil {
		t.Fatal("validateOptions succeeded for a non-local target")
	}
	if !strings.Contains(err.Error(), "refusing to truncate non-local target") {
		t.Fatalf("validateOptions error = %q", err)
	}
}

func TestValidateOptionsAllowsExplicitNonlocalTarget(t *testing.T) {
	err := validateOptions(mirrorOptions{
		prodURL:             "postgres://prod.example.com/arcade",
		localURL:            "postgres://db.example.com/arcade",
		allowNonlocalTarget: true,
	})
	if err != nil {
		t.Fatalf("validateOptions() = %v", err)
	}
}

func TestValidateOptionsRejectsUserAuthConflict(t *testing.T) {
	err := validateOptions(mirrorOptions{
		prodURL:          "postgres://prod.example.com/arcade",
		localURL:         "postgres://localhost/arcade",
		preserveUserAuth: true,
		localPassword:    "password123",
	})
	if err == nil {
		t.Fatal("validateOptions succeeded with conflicting user auth options")
	}
}

func TestUserSelectSQLSanitizesAuthByDefault(t *testing.T) {
	query := userSelectSQL(mirrorOptions{})

	for _, want := range []string{
		"local.arcade.invalid",
		"'disabled'",
		"'ARCD' || upper(replace(id::text, '-', ''))",
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("default user select missing %q in %s", want, query)
		}
	}
}

func TestUserSelectSQLCanSetSharedLocalPassword(t *testing.T) {
	query := userSelectSQL(mirrorOptions{localPassword: "bcrypt'quote"})

	if !strings.Contains(query, "'bcrypt''quote' as password_hash") {
		t.Fatalf("shared password hash was not SQL-quoted in %s", query)
	}
}

func TestUserSelectSQLCanPreserveProductionAuth(t *testing.T) {
	query := userSelectSQL(mirrorOptions{preserveUserAuth: true})

	for _, want := range []string{
		"email as email",
		"password_hash as password_hash",
		"friend_code as friend_code",
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("preserved user select missing %q in %s", want, query)
		}
	}
	if strings.Contains(query, "local.arcade.invalid") {
		t.Fatalf("preserved user select still sanitizes email in %s", query)
	}
}

func TestMissingVersions(t *testing.T) {
	missing := missingVersions(
		[]string{"001_init.sql", "002_next.sql", "003_latest.sql"},
		[]string{"001_init.sql", "003_latest.sql"},
	)
	if got := strings.Join(missing, ","); got != "002_next.sql" {
		t.Fatalf("missingVersions() = %q", got)
	}
}
