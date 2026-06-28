#!/bin/sh
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if ! command -v bun >/dev/null 2>&1; then
	printf 'bun is required to generate frontend event docs\n' >&2
	exit 1
fi

if [ ! -d web/frontend/node_modules/typescript ]; then
	printf 'Installing frontend dependencies for TypeScript parser\n'
	(cd web/frontend && bun ci)
fi

(cd web/frontend && bun ../../scripts/generate-frontend-event-docs.mjs)
