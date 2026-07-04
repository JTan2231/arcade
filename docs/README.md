# Arcade Docs

This directory captures project-level notes that are broader than a single
package.

- [Data model](data-model.md): current Postgres schema, relationships, and
  important constraints.
- [Architecture](architecture.md): deployable package layout, request flow,
  domain boundaries, and frontend shape.
- [Tech stack](tech-stack.md): backend, database, frontend, configuration, and
  runtime dependency choices.
- [Database migrations](database-migrations.md): how migration files are named,
  applied, tested, and operated.
- [Frontend cache](frontend-cache.md): in-memory frontend query cache behavior,
  key conventions, invalidation rules, and mutation guidance.
- [Testing](testing.md): design and implementation of the TypeScript/YAML
  scenario harness under `test/`, plus the local locator diagnostic CLI.
- [Frontend style](frontend-style.md): color tokens, palette usage rules, and
  frontend visual validation notes.
- [Generated frontend event handlers](generated/frontend-event-handlers.md):
  static JSX inventory of frontend handler props by accessible region and label.
