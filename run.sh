#!/bin/sh
set -eu

cd "$(dirname "$0")"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arcade-run.XXXXXX")" || exit 1

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '%s is required but was not found in PATH\n' "$1" >&2
		exit 1
	fi
}

terminate_process() {
	pid="$1"
	if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
		return
	fi

	if command -v pkill >/dev/null 2>&1; then
		pkill -TERM -P "$pid" 2>/dev/null || true
	fi

	kill "$pid" 2>/dev/null || true
}

cleanup() {
	status=$?
	trap - INT TERM EXIT

	terminate_process "${frontend_pid:-}"
	terminate_process "${backend_pid:-}"
	wait 2>/dev/null || true
	rm -rf "$tmp_dir"
	exit "$status"
}

trap cleanup INT TERM EXIT

require_command go
require_command bun

if [ "${ARCADE_ADDR:-}" != "" ] && [ "$ARCADE_ADDR" != ":8080" ]; then
	printf 'ARCADE_ADDR=%s does not match the Vite proxy target http://localhost:8080\n' "$ARCADE_ADDR" >&2
	printf 'Unset ARCADE_ADDR or update web/frontend/vite.config.ts for this dev runner.\n' >&2
	exit 1
fi

export ARCADE_ADDR="${ARCADE_ADDR:-:8080}"

printf 'Building backend\n'
go build -o "$tmp_dir/arcade" ./cmd/arcade

printf 'Starting backend on http://localhost%s\n' "$ARCADE_ADDR"
"$tmp_dir/arcade" &
backend_pid=$!

printf 'Starting frontend dev server\n'
(cd web/frontend && exec bun run dev) &
frontend_pid=$!

printf '\nOpen the Vite dev server URL shown above. Press Ctrl-C to stop both processes.\n\n'

while :; do
	if ! kill -0 "$backend_pid" 2>/dev/null; then
		wait "$backend_pid"
		exit $?
	fi

	if ! kill -0 "$frontend_pid" 2>/dev/null; then
		wait "$frontend_pid"
		exit $?
	fi

	sleep 1
done
