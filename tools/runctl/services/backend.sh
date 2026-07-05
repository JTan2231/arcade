#!/bin/sh
set -eu

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '%s is required but was not found in PATH\n' "$1" >&2
		exit 1
	fi
}

repo_root="${ARCADE_RUN_REPO_ROOT:-}"
if [ "$repo_root" = "" ]; then
	script_dir="$(CDPATH= cd "$(dirname "$0")" && pwd)"
	repo_root="$(CDPATH= cd "$script_dir/../../.." && pwd)"
fi

require_command go

cd "$repo_root"

if [ "${ARCADE_ADDR:-}" != "" ] && [ "$ARCADE_ADDR" != ":8080" ]; then
	printf 'ARCADE_ADDR=%s does not match the Vite proxy target http://localhost:8080\n' "$ARCADE_ADDR" >&2
	printf 'Unset ARCADE_ADDR or update web/frontend/vite.config.ts for this dev runner.\n' >&2
	exit 1
fi

export ARCADE_ADDR="${ARCADE_ADDR:-:8080}"
export ARCADE_DEV_PERSIST_SESSIONS="${ARCADE_DEV_PERSIST_SESSIONS:-1}"

state_dir="${ARCADE_RUN_STATE_DIR:-$repo_root/.arcade/run}"
bin_dir="$state_dir/backend"
mkdir -p "$bin_dir"

printf 'Building backend\n'
go build -o "$bin_dir/arcade" ./cmd/arcade

printf 'Starting backend on http://localhost:8080\n'
exec "$bin_dir/arcade"
