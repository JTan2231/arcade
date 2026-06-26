#!/bin/sh
set -u

cd "$(dirname "$0")"

section() {
	printf '\n==> %s\n' "$1"
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '%s is required but was not found in PATH\n' "$1" >&2
		return 1
	fi
}

run_frontend() {
	require_command bun || return 1

	section "Frontend: installing dependencies"
	(cd web/frontend && bun ci) || return 1

	section "Frontend: checking formatting"
	(cd web/frontend && bun run format:check) || return 1

	section "Frontend: linting TypeScript and React"
	(cd web/frontend && bun run lint) || return 1

	section "Frontend: linting CSS"
	(cd web/frontend && bun run lint:css) || return 1

	section "Frontend: checking unused code"
	(cd web/frontend && bun run check:dead) || return 1

	section "Frontend: type checking"
	(cd web/frontend && bun run check) || return 1

	section "Frontend: building"
	(cd web/frontend && bun run build) || return 1
}

run_backend() {
	require_command go || return 1
	go_packages="$(go list ./... | grep -v '/web/frontend/node_modules/')" || return 1

	section "Backend: checking Go formatting"
	find . -type f -name '*.go' ! -path './.git/*' ! -path './web/frontend/node_modules/*' -print | sort | while IFS= read -r file; do
		gofmt -l "$file"
	done >"$tmp_dir/gofmt.out" || return 1

	if [ -s "$tmp_dir/gofmt.out" ]; then
		printf 'The following Go files need gofmt:\n' >&2
		cat "$tmp_dir/gofmt.out" >&2
		return 1
	fi

	section "Backend: checking module tidiness"
	go mod tidy -diff || return 1

	section "Backend: running go vet"
	go vet $go_packages || return 1

	section "Backend: running tests"
	go test $go_packages || return 1

	section "Backend: building arcade binary"
	go build -trimpath -o "$tmp_dir/arcade" ./cmd/arcade || return 1
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arcade-ci.XXXXXX")" || exit 1
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

frontend_status=0
backend_status=0

run_frontend || frontend_status=$?
run_backend || backend_status=$?

section "CI summary"

if [ "$frontend_status" -eq 0 ]; then
	printf 'Frontend: passed\n'
else
	printf 'Frontend: failed\n' >&2
fi

if [ "$backend_status" -eq 0 ]; then
	printf 'Backend: passed\n'
else
	printf 'Backend: failed\n' >&2
fi

if [ "$frontend_status" -ne 0 ] || [ "$backend_status" -ne 0 ]; then
	exit 1
fi

section "CI checks passed"
