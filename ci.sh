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

usage() {
	cat <<'EOF'
Usage: ./ci.sh [all|frontend|backend|scenarios|e2e|test]
       ./ci.sh [--all|--frontend|--backend|--scenarios|--e2e|--test]

Runs all CI checks by default.
EOF
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

run_scenarios() {
	require_command bun || return 1

	section "Scenarios: installing dependencies"
	(cd test && bun ci) || return 1

	section "Scenarios: checking formatting"
	(cd test && bun run format:check) || return 1

	section "Scenarios: type checking"
	(cd test && bun run check) || return 1
}

run_e2e() {
	require_command go || return 1
	require_command bun || return 1
	require_command psql || return 1

	run_scenarios || return 1

	section "Scenarios: running browser suite"
	(cd test && bun run e2e) || return 1
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arcade-ci.XXXXXX")" || exit 1
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

target="all"
if [ "$#" -gt 1 ]; then
	usage >&2
	exit 2
fi

if [ "$#" -eq 1 ]; then
	case "$1" in
	all | --all)
		target="all"
		;;
	frontend | front | --frontend | --front)
		target="frontend"
		;;
	backend | back | --backend | --back)
		target="backend"
		;;
	scenarios | scenario | --scenarios | --scenario)
		target="scenarios"
		;;
	e2e | test | --e2e | --test)
		target="e2e"
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		printf 'Unknown CI target: %s\n\n' "$1" >&2
		usage >&2
		exit 2
		;;
	esac
fi

frontend_status=0
backend_status=0
scenarios_status=0
e2e_status=0
run_frontend_checks=0
run_backend_checks=0
run_scenario_checks=0
run_e2e_checks=0

case "$target" in
all)
	run_frontend_checks=1
	run_backend_checks=1
	run_scenario_checks=1
	;;
frontend)
	run_frontend_checks=1
	;;
backend)
	run_backend_checks=1
	;;
scenarios)
	run_scenario_checks=1
	;;
e2e)
	run_e2e_checks=1
	;;
esac

if [ "$run_frontend_checks" -eq 1 ]; then
	run_frontend || frontend_status=$?
fi

if [ "$run_backend_checks" -eq 1 ]; then
	run_backend || backend_status=$?
fi

if [ "$run_scenario_checks" -eq 1 ]; then
	run_scenarios || scenarios_status=$?
fi

if [ "$run_e2e_checks" -eq 1 ]; then
	run_e2e || e2e_status=$?
fi

section "CI summary"

if [ "$run_frontend_checks" -eq 1 ]; then
	if [ "$frontend_status" -eq 0 ]; then
		printf 'Frontend: passed\n'
	else
		printf 'Frontend: failed\n' >&2
	fi
else
	printf 'Frontend: skipped\n'
fi

if [ "$run_backend_checks" -eq 1 ]; then
	if [ "$backend_status" -eq 0 ]; then
		printf 'Backend: passed\n'
	else
		printf 'Backend: failed\n' >&2
	fi
else
	printf 'Backend: skipped\n'
fi

if [ "$run_scenario_checks" -eq 1 ]; then
	if [ "$scenarios_status" -eq 0 ]; then
		printf 'Scenarios: passed\n'
	else
		printf 'Scenarios: failed\n' >&2
	fi
else
	printf 'Scenarios: skipped\n'
fi

if [ "$run_e2e_checks" -eq 1 ]; then
	if [ "$e2e_status" -eq 0 ]; then
		printf 'E2E: passed\n'
	else
		printf 'E2E: failed\n' >&2
	fi
else
	printf 'E2E: skipped\n'
fi

if [ "$frontend_status" -ne 0 ] || [ "$backend_status" -ne 0 ] || [ "$scenarios_status" -ne 0 ] || [ "$e2e_status" -ne 0 ]; then
	exit 1
fi

section "CI checks passed"
