# Code Review Rules

## Comment Labels

| Label | Severity                                          | SA required |
| ----- | ------------------------------------------------- | ----------- |
| `[H]` | Critical — must be fixed before merging           | Yes         |
| `[M]` | Major                                             | Yes         |
| `[L]` | Minor                                             | Yes         |
| `[D]` | Discuss — bring to call/daily                     | No          |
| `[Q]` | Question — informational                          | No          |

**SA** (Suggested Action) — a concrete fix suggestion, required for `[H]`, `[M]`, `[L]`.

## What to Check

- **Architecture** — correct layer (controller/service/module), no cross-module imports except via `index.ts`
- **TypeScript** — no `as` assertions, proper DTO types, no `any`
- **NestJS** — business logic in services not controllers, `ConfigService` not `process.env`, DTOs validated
- **Code style** — naming conventions, constants for magic values, object params for 2+ args
- **Security** — no secrets in code, input validated via DTOs

## Output Format

Group by file, skip files with no issues.

```
## Review

### `path/to/file.ts`
- [H] Description of the issue
  SA: Concrete fix

- [L] Minor style issue
  SA: How to fix
```

If no issues found: `✅ No issues found`
