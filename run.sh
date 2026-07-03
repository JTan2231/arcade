#!/bin/sh
set -eu

repo_root="$(CDPATH= cd "$(dirname "$0")" && pwd)"

if ! command -v go >/dev/null 2>&1; then
	printf 'go is required but was not found in PATH\n' >&2
	exit 1
fi

cd "$repo_root/tools/runctl"
export ARCADE_RUN_REPO_ROOT="$repo_root"
exec go run . "$@"
