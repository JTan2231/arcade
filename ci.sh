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

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arcade-ci.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

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

if command -v node >/dev/null 2>&1; then
	section "Checking frontend JavaScript syntax"
	node --check web/static/app.js
else
	section "Skipping frontend JavaScript syntax check"
	printf 'node was not found in PATH\n'
fi

section "CI checks passed"
