# land-scraper

NestJS v11 application.

## Requirements

- Node.js >= 20.11 (recommended: use [nvm](https://github.com/nvm-sh/nvm))
- npm >= 10
- Docker (optional)

## Getting started

```bash
# Use correct Node.js version
nvm use

# Install dependencies
npm install

# Copy env file and fill in values
cp .env.example .env

# Start in development mode (watch)
npm run start:dev
```

## Docker

```bash
# Development (hot-reload)
docker compose up

# Production
docker compose -f docker-compose.prod.yml up
```

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Start with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm run start:prod` | Run compiled build |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix lint errors |
| `npm run format` | Run Prettier |
| `npm test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run e2e tests |

## Project structure

```
src/
├── config/          # Environment config (app.config.ts, validation.schema.ts)
├── common/
│   ├── filters/     # Exception filters (global)
│   └── interceptors/# Response interceptors (global)
└── modules/         # Feature modules
    └── health/      # GET /api/v1/health
```

## Environment variables

See `.env.example` for all available variables.

## API

All routes are prefixed with `/api/v1`.

Swagger docs available at `/api/docs` (development only).

Successful responses:
```json
{ "data": { ... }, "timestamp": "2026-01-01T00:00:00.000Z" }
```

Error responses:
```json
{ "statusCode": 400, "timestamp": "...", "path": "/api/v1/...", "message": "..." }
```
