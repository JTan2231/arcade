Use ci.sh to validate any code changes.

Refer docs/ before any code or design questions or tasks.

`./run.sh` is the local dev process controller. With no args it starts the
backend and frontend in the background and exits; use `./run.sh status`,
`./run.sh restart backend|frontend|all`, `./run.sh stop [backend|frontend|all]`,
`./run.sh logs`, and `./run.sh tail` to inspect or control them. The service
commands live in `tools/runctl/services/*.sh`, and runtime state/logs live under
ignored `.arcade/`. Stop services with `./run.sh stop` when done debugging.

`locator.ts` is a script for rendering specific elements in the frontend. Use this extensively when approaching frontend work.
