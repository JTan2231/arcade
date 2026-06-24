#!/bin/sh
set -eu

cd "$(dirname "$0")"

section() {
	printf '\n==> %s\n' "$1"
}

if ! command -v go >/dev/null 2>&1; then
	printf 'go is required but was not found in PATH\n' >&2
	exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
	printf 'bun is required but was not found in PATH\n' >&2
	exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arcade-ci.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

section "Installing frontend dependencies"
(cd web/frontend && bun ci)

section "Checking frontend"
(cd web/frontend && bun run check)

section "Building frontend"
(cd web/frontend && bun run build)

section "Checking Go formatting"
find . -type f -name '*.go' ! -path './.git/*' -print | sort | while IFS= read -r file; do
	gofmt -l "$file"
done >"$tmp_dir/gofmt.out"

if [ -s "$tmp_dir/gofmt.out" ]; then
	printf 'The following Go files need gofmt:\n' >&2
	cat "$tmp_dir/gofmt.out" >&2
	exit 1
fi

section "Checking module tidiness"
go mod tidy -diff

section "Running go vet"
go vet ./...

section "Running tests"
go test ./...

section "Building arcade binary"
go build -trimpath -o "$tmp_dir/arcade" ./cmd/arcade

section "CI checks passed"
