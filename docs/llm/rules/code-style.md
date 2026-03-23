# Code Style

## Naming

- Descriptive variable names with auxiliary verbs: `isLoading`, `hasError`, `hasPermission`
- NestJS conventions: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.dto.ts`, `*.entity.ts`, `*.filter.ts`
- **Named exports** for all modules, services, and utilities
- File names: kebab-case (`scraper.service.ts`)
- Classes: PascalCase (`ScraperService`)

## Constants

- Magic numbers and strings must be extracted to constants with descriptive names
- Use `DEFAULTS` object for default values (except booleans)

## Function Parameters

2+ parameters → use object parameter:

```typescript
// ❌
function processData(data: string, options: Options, config: Config) {}

// ✅
function processData(params: { data: string; options: Options; config: Config }) {}
```

## NestJS Specifics

- One class per file
- DTOs use `class-validator` decorators — always `@IsString()`, `@IsEmail()` etc.
- Services contain business logic only — no HTTP concerns
- Controllers handle HTTP only — delegate to services
- Use `ConfigService` to access env vars — never `process.env` directly in modules

## Comments

- Prefixes: `TODO`, `FIXME`, `NOTE`
- Always in English
- Never remove relevant existing comments
- `TODO` and `FIXME` must include a **priority** and clear description

## General

- Remove dead code when noticed
