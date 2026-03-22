# Git Message Format Guide

Based on [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)

## Common Rules

- Use lowercase for all messages
- Be clear and concise
- Use imperative mood ("add feature" not "added feature")

## Types

- `feat` — new feature
- `fix` — bug fix
- `refactor` — code refactoring without behavior change
- `perf` — performance improvement
- `style` — formatting only
- `test` — adding or updating tests
- `docs` — documentation
- `build` — build system or dependencies
- `ci` — CI/CD configuration
- `chore` — maintenance tasks

## 1. Commit Message Format

```
<type>: <description>
```

- Max 100 characters
- Header only (no body needed for simple commits)

### Examples

```
feat: add scraper module for land listings
fix: handle Telegram 429 rate limit with retry
chore: update dependencies
test: add health endpoint e2e test
```

## 2. PR Description Format

```
## Summary

### User impact
- feat: what the user sees or can now do (skip if no user-facing changes)

### Technical impact
- refactor: architectural or internal changes
- build: dependency or tooling changes

## Test plan
- [ ] What to test manually
- [ ] Edge cases to verify
```

**User impact** — visible changes: new features, UI changes, API changes, bug fixes affecting behaviour.
**Technical impact** — internal changes: refactors, dependency updates, CI, tooling, performance, infrastructure.
Skip a section entirely if there's nothing to put there.
