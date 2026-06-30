#!/bin/sh
set -eu

usage() {
	cat <<'EOF'
Usage: scripts/prod-db-readonly.sh [psql arguments...]

Connects to the production Postgres database with session-level read-only
defaults. Set ARCADE_PROD_DATABASE_URL, PROD_DATABASE_URL, or DATABASE_URL to
the production connection URL before running it.

Examples:
  DATABASE_URL='postgres://...' scripts/prod-db-readonly.sh
  DATABASE_URL='postgres://...' scripts/prod-db-readonly.sh -c 'select now();'

This wrapper protects against accidental writes. For hard enforcement, use a
database role that only has read privileges.
EOF
}

case "${1:-}" in
-h | --help)
	usage
	exit 0
	;;
esac

if ! command -v psql >/dev/null 2>&1; then
	printf 'psql is required but was not found in PATH\n' >&2
	exit 1
fi

database_url="${ARCADE_PROD_DATABASE_URL:-${PROD_DATABASE_URL:-${DATABASE_URL:-}}}"
if [ "$database_url" = "" ]; then
	printf 'Set ARCADE_PROD_DATABASE_URL, PROD_DATABASE_URL, or DATABASE_URL to the production Postgres connection URL.\n' >&2
	exit 2
fi

readonly_options="-c default_transaction_read_only=on -c statement_timeout=30000 -c idle_in_transaction_session_timeout=300000"
if [ "${PGOPTIONS:-}" != "" ]; then
	readonly_options="$PGOPTIONS $readonly_options"
fi

export PGOPTIONS="$readonly_options"

exec psql \
	--no-psqlrc \
	--set=ON_ERROR_STOP=1 \
	--set=PROMPT1='arcade-prod-readonly %/%R%x%# ' \
	--set=PROMPT2='arcade-prod-readonly %/%R%x%# ' \
	"$database_url" \
	"$@"
