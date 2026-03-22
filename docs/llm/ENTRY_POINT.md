# Project Entry Point

## About

**land-scraper** — NestJS v11 application for scraping and monitoring land listings. Sends Telegram notifications when new listings appear or existing ones are removed.

## Key Commands

```bash
npm run start:dev    # dev server with hot-reload
npm run build        # compile TypeScript
npm run start:prod   # run production build
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm test             # unit tests
npm run test:e2e     # e2e tests
npm run test:cov     # tests with coverage
```

## Key Files

- `package.json` — dependencies and scripts (NestJS v11, class-validator, joi, helmet, throttler, swagger)
- `src/main.ts` — entry point, bootstrap (helmet, CORS, Swagger, shutdown hooks)
- `src/app.module.ts` — root module (ConfigModule, ThrottlerModule, global pipes/filters/interceptors)
- `src/config/app.config.ts` — namespaced app config
- `src/config/validation.schema.ts` — Joi env validation

## Core Rules

- Each solution should be simple, clear and concise
- **No over-engineering**
- Follow existing NestJS module structure

## Workflow

Follow the [Workflow Loop](docs/llm/rules/workflow.md) for every task: Plan → Implement → Verify → Fix.

## Auto-Memory (MEMORY.md)

MEMORY.md is always loaded into every session. To avoid wasting instruction budget:

- **Never duplicate** what is already in skills, docs/llm/, or code
- **Only store** unique insights: user preferences, debugging findings, non-obvious decisions
- **Keep concise** — under 200 lines

## Quick Reference

| Topic                  | Doc                                        |
| ---------------------- | ------------------------------------------ |
| Code style             | `docs/llm/rules/code-style.md`             |
| TypeScript             | `docs/llm/rules/typescript.md`             |
| Architecture           | `docs/llm/rules/architecture.md`           |
| Development philosophy | `docs/llm/rules/development-philosophy.md` |
| Code review            | `docs/llm/rules/code-review.md`            |
| Workflow               | `docs/llm/rules/workflow.md`               |
