# Architecture

## Project Structure

```
src/
├── config/           # Environment config (registerAs namespaced configs)
├── common/
│   ├── filters/      # Global exception filters
│   ├── interceptors/ # Global interceptors
│   ├── guards/       # Auth/throttle guards
│   ├── decorators/   # Custom decorators
│   ├── pipes/        # Custom pipes
│   └── dto/          # Shared DTOs (pagination, etc.)
└── modules/          # Feature modules (domain-driven)
    └── <feature>/
        ├── dto/
        ├── entities/
        ├── <feature>.controller.ts
        ├── <feature>.service.ts
        └── <feature>.module.ts
```

## Module Rules

- Each feature = one NestJS module in `src/modules/<feature>/`
- Module exports only what other modules explicitly need
- `@Global()` only for truly app-wide shared modules (e.g., DatabaseModule)
- Barrel exports via `index.ts` inside each module folder

## Layer Responsibilities

| Layer       | Responsibility                                 |
| ----------- | ---------------------------------------------- |
| Controller  | HTTP only — parse request, call service, return |
| Service     | Business logic — no HTTP, no Express/NestJS req |
| Module      | Wire dependencies, declare exports              |
| DTO         | Input validation via `class-validator`         |
| Entity      | Database schema / domain model                 |

## Config Access

Always inject `ConfigService` — never use `process.env` directly inside modules:

```typescript
// ✅
constructor(private config: ConfigService) {}
this.config.get<string>('app.name')

// ❌
process.env.APP_NAME
```

## Adding a New Feature Module

1. Create `src/modules/<feature>/` with controller, service, module files
2. Add DTOs in `src/modules/<feature>/dto/`
3. Import module in `src/app.module.ts`
4. Add config namespace in `src/config/` if new env vars needed
5. Add new env vars to `.env.example` and `src/config/validation.schema.ts`
