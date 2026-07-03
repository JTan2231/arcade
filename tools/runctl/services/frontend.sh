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

require_command bun

cd "$repo_root/web/frontend"

printf 'Starting frontend dev server on http://127.0.0.1:5173\n'
exec bun run dev --host 127.0.0.1 --port 5173 --strictPort
