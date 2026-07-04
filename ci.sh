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

configure_ci_caches() {
	ci_cache_dir="$tmp_dir/cache"

	mkdir -p \
		"$ci_cache_dir/bun" \
		"$ci_cache_dir/go-build" \
		"$ci_cache_dir/go-mod" \
		"$ci_cache_dir/go-tmp" \
		"$ci_cache_dir/ms-playwright" \
		"$ci_cache_dir/node-compile" \
		"$ci_cache_dir/tmp" \
		"$ci_cache_dir/xdg" || return 1

	export TMPDIR="$ci_cache_dir/tmp"
	export XDG_CACHE_HOME="$ci_cache_dir/xdg"
	export GOCACHE="$ci_cache_dir/go-build"
	export GOMODCACHE="$ci_cache_dir/go-mod"
	export GOTMPDIR="$ci_cache_dir/go-tmp"
	export NODE_COMPILE_CACHE="$ci_cache_dir/node-compile"
	export PLAYWRIGHT_BROWSERS_PATH="$ci_cache_dir/ms-playwright"
	export ARCADE_BUN_CACHE_DIR="$ci_cache_dir/bun"
	export BUN_INSTALL_CACHE_DIR="$ci_cache_dir/bun"
}

bun_ci() {
	if [ "${ARCADE_BUN_CACHE_DIR:-}" != "" ]; then
		bun install --frozen-lockfile --cache-dir "$ARCADE_BUN_CACHE_DIR"
	else
		bun ci
	fi
}

cleanup() {
	status=$?
	trap - EXIT INT TERM

	if [ "${tmp_dir:-}" != "" ] && [ -d "$tmp_dir" ]; then
		chmod -R u+w "$tmp_dir" >/dev/null 2>&1 || true
	fi

	if [ "${ci_worktree_path:-}" != "" ]; then
		git worktree remove --force "$ci_worktree_path" >/dev/null 2>&1 || {
			rm -rf "$ci_worktree_path"
			git worktree prune >/dev/null 2>&1 || true
		}
	fi

	rm -rf "$tmp_dir"
	exit "$status"
}

usage() {
	cat <<'EOF'
Usage: ./ci.sh [all|frontend|backend|runctl|scenarios|e2e|test|generated-docs]
       ./ci.sh [--all|--frontend|--backend|--runctl|--scenarios|--e2e|--test|--generated-docs]

Runs all CI checks by default in an isolated temporary worktree.
EOF
}

run_in_isolated_worktree() {
	require_command git || return 1

	base_commit="$(git rev-parse --verify HEAD)" || return 1
	tmp_index="$tmp_dir/snapshot.index"
	ci_worktree_path="$tmp_dir/worktree"

	section "CI: preparing isolated worktree"
	GIT_INDEX_FILE="$tmp_index" git read-tree "$base_commit" || return 1
	GIT_INDEX_FILE="$tmp_index" git add -A -- . || return 1
	tree="$(GIT_INDEX_FILE="$tmp_index" git write-tree)" || return 1
	snapshot_commit="$(printf 'arcade ci snapshot\n' | git commit-tree "$tree" -p "$base_commit")" || return 1

	git worktree add --detach "$ci_worktree_path" "$snapshot_commit" || return 1

	section "CI: running checks in isolated worktree"
	ARCADE_CI_IN_WORKTREE=1 "$ci_worktree_path/ci.sh" "$@"
}

run_frontend() {
	require_command bun || return 1

	section "Frontend: installing dependencies"
	(cd web/frontend && bun_ci) || return 1

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

run_runctl() {
	require_command go || return 1

	section "Run controller: checking shell syntax"
	sh -n run.sh tools/runctl/services/backend.sh tools/runctl/services/frontend.sh || return 1

	section "Run controller: checking Go formatting"
	(cd tools/runctl && find . -type f -name '*.go' -print | sort | while IFS= read -r file; do
		gofmt -l "$file"
	done) >"$tmp_dir/runctl-gofmt.out" || return 1

	if [ -s "$tmp_dir/runctl-gofmt.out" ]; then
		printf 'The following run controller Go files need gofmt:\n' >&2
		cat "$tmp_dir/runctl-gofmt.out" >&2
		return 1
	fi

	section "Run controller: checking module tidiness"
	(cd tools/runctl && go mod tidy -diff) || return 1

	section "Run controller: running go vet"
	(cd tools/runctl && go vet ./...) || return 1

	section "Run controller: running tests"
	(cd tools/runctl && go test ./...) || return 1
}

run_scenarios() {
	require_command bun || return 1

	section "Scenarios: installing dependencies"
	(cd test && bun_ci) || return 1

	section "Scenarios: checking formatting"
	(cd test && bun run format:check) || return 1

	section "Scenarios: type checking"
	(cd test && bun run check) || return 1
}

run_e2e() {
	require_command go || return 1
	require_command bun || return 1
	require_command psql || return 1

	section "E2E: running browser suite"
	(cd test && bun run e2e) || return 1
}

run_generated_docs() {
	require_command bun || return 1

	if [ ! -d web/frontend/node_modules/typescript ]; then
		section "Generated docs: installing frontend dependencies"
		(cd web/frontend && bun_ci) || return 1
	fi

	section "Generated docs: frontend event handler inventory"
	scripts/generate-frontend-event-docs.sh || return 1
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arcade-ci.XXXXXX")" || exit 1
trap cleanup EXIT INT TERM

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
	runctl | run | devtools | --runctl | --run | --devtools)
		target="runctl"
		;;
	scenarios | scenario | --scenarios | --scenario)
		target="scenarios"
		;;
	e2e | test | --e2e | --test)
		target="e2e"
		;;
	generated-docs | docs | --generated-docs | --docs)
		target="generated-docs"
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

if [ "${ARCADE_CI_IN_WORKTREE:-}" != "1" ]; then
	run_in_isolated_worktree "$@"
	exit $?
fi

configure_ci_caches || exit 1

frontend_status=0
backend_status=0
runctl_status=0
scenarios_status=0
e2e_status=0
generated_docs_status=0
e2e_blocked_by_scenarios=0
generated_docs_blocked_by_frontend=0
run_frontend_checks=0
run_backend_checks=0
run_runctl_checks=0
run_scenario_checks=0
run_e2e_checks=0
run_generated_docs_checks=0

case "$target" in
all)
	run_frontend_checks=1
	run_backend_checks=1
	run_runctl_checks=1
	run_scenario_checks=1
	run_e2e_checks=1
	run_generated_docs_checks=1
	;;
frontend)
	run_frontend_checks=1
	run_generated_docs_checks=1
	;;
backend)
	run_backend_checks=1
	;;
runctl)
	run_runctl_checks=1
	;;
scenarios)
	run_scenario_checks=1
	;;
e2e)
	run_scenario_checks=1
	run_e2e_checks=1
	;;
generated-docs)
	run_generated_docs_checks=1
	;;
esac

if [ "$run_frontend_checks" -eq 1 ]; then
	run_frontend || frontend_status=$?
fi

if [ "$run_backend_checks" -eq 1 ]; then
	run_backend || backend_status=$?
fi

if [ "$run_runctl_checks" -eq 1 ]; then
	run_runctl || runctl_status=$?
fi

if [ "$run_scenario_checks" -eq 1 ]; then
	run_scenarios || scenarios_status=$?
fi

if [ "$run_e2e_checks" -eq 1 ]; then
	if [ "$run_scenario_checks" -eq 1 ] && [ "$scenarios_status" -ne 0 ]; then
		e2e_blocked_by_scenarios=1
		e2e_status=1
	else
		run_e2e || e2e_status=$?
	fi
fi

if [ "$run_generated_docs_checks" -eq 1 ]; then
	if [ "$run_frontend_checks" -eq 1 ] && [ "$frontend_status" -ne 0 ]; then
		generated_docs_blocked_by_frontend=1
	else
		run_generated_docs || generated_docs_status=$?
	fi
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

if [ "$run_runctl_checks" -eq 1 ]; then
	if [ "$runctl_status" -eq 0 ]; then
		printf 'Run controller: passed\n'
	else
		printf 'Run controller: failed\n' >&2
	fi
else
	printf 'Run controller: skipped\n'
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
	if [ "$e2e_blocked_by_scenarios" -eq 1 ]; then
		printf 'E2E: skipped because scenario checks failed\n' >&2
	elif [ "$e2e_status" -eq 0 ]; then
		printf 'E2E: passed\n'
	else
		printf 'E2E: failed\n' >&2
	fi
else
	printf 'E2E: skipped\n'
fi

if [ "$run_generated_docs_checks" -eq 1 ]; then
	if [ "$generated_docs_blocked_by_frontend" -eq 1 ]; then
		printf 'Generated docs: skipped because frontend checks failed\n' >&2
	elif [ "$generated_docs_status" -eq 0 ]; then
		printf 'Generated docs: passed\n'
	else
		printf 'Generated docs: failed\n' >&2
	fi
else
	printf 'Generated docs: skipped\n'
fi

if [ "$frontend_status" -ne 0 ] || [ "$backend_status" -ne 0 ] || [ "$runctl_status" -ne 0 ] || [ "$scenarios_status" -ne 0 ] || [ "$e2e_status" -ne 0 ] || [ "$generated_docs_status" -ne 0 ]; then
	exit 1
fi

section "CI checks passed"
