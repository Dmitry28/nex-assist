# Land Auctions Module

Scrapes land auction listings from two sources, diffs them against the previous run, and sends a Telegram summary:

- **[gcn.by](https://gcn.by)** — structured per-lot pages (price, area, photos, archive sale prices)
- **[grodnorik.gov.by](https://grodnorik.gov.by/ru/auctions/)** — Гродненский райисполком auction notices, published as PDF/DOC files on a single page

Both report into the same Telegram feed but are scraped, diffed and persisted independently, so a change in one can never mark the other's items as new or removed.

---

## How it works

```
Cron trigger (or HTTP POST /run)
  → LandAuctionsService.run()
      1. GcnParserService       — fetch current listings from gcn.by (Puppeteer)
         GrodnorikParserService — fetch notices from grodnorik.gov.by (plain fetch)
      2. SnapshotService    — read previous listings/notices from disk
      3. Diff               — detect new / removed / special listings, new notices
      4. ListingNotifierService — send Telegram summary + per-listing/per-notice messages
      5. SnapshotService    — persist updated snapshots to disk
```

**Notification comes before persistence.**
If Telegram is down the summary send throws → snapshots are NOT updated → listings remain "new" on the next run → no items are silently missed.

---

## Services

| Service | Responsibility |
|---|---|
| `LandAuctionsService` | Orchestration: cron scheduling, run guard, diff logic, error reporting |
| `GcnParserService` | Infrastructure: Puppeteer scraping of the catalog and detail pages |
| `GrodnorikParserService` | Infrastructure: plain-fetch scraping of the райисполком notices page |
| `ListingNotifierService` | Domain: format land-auction captions/summaries, delegate sends to `TelegramService` |

Shared services (from `src/common/`):
- `SnapshotService` — generic read/write JSON snapshots to `./data/`
- `TelegramService` (via `TelegramModule`) — low-level Telegram API wrapper

---

## Key design decisions

**Dynamic cron** — `SchedulerRegistry` + `CronJob` in `onModuleInit` instead of the `@Cron` decorator, because decorators are evaluated before `ConfigModule` loads the env-based schedule.

**Concurrent run guard** — `isRunning` flag (safe in Node.js single-threaded model). Concurrent HTTP call gets `409 Conflict`. A watchdog timer resets the flag if the scrape hangs beyond `RUN_TIMEOUT_MS` (10 min).

**Dry-run mode** — if `TELEGRAM_TOKEN` / `TELEGRAM_LAND_AUCTIONS_CHAT_ID` are absent, `TelegramService` logs to console instead of calling the API. The app starts and runs normally without credentials.

**Special listings** — listings whose title contains `'заболо'` (`SPECIAL_KEYWORD`) are tracked separately as the Заболоть area filter.

**grodnorik: additions only** — a notice leaving the page means it moved to the site's own archive, not that anything was sold, so removals are not reported. All notice types are tracked (plots, пустующие дома, незавершёнка, электронные торги): volume is ~1–2 per month and the type is visible in the title, so a keyword filter would only risk dropping real plots.

**grodnorik: empty result = outage** — the parser never throws; a failed fetch or a layout change yields `[]`, which leaves the previous snapshot untouched. Overwriting it would make the next successful run re-announce all ~60 notices.

**grodnorik: no Puppeteer** — the page is fully server-rendered. Notices are matched by their `/materialy/aukciony/` file path rather than by CSS class, because the page body is freeform WYSIWYG markup that changes with every edit.

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `SCRAPE_URL` | gcn.by land auctions page | URL to scrape |
| `GRODNORIK_URL` | grodnorik.gov.by auctions page | Second source URL |
| `SCRAPE_CRON` | `0 8 * * *` (08:00 daily) | Cron expression |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_LAND_AUCTIONS_CHAT_ID` | — | Target chat/channel ID |
| `API_KEY` | — | API key for `POST /run` (optional; omit to allow all) |

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `land_auctions_all.json` | All current listings (used for next-run diff) |
| `land_auctions_new.json` | New listings from the last run |
| `land_auctions_removed.json` | Removed listings from the last run |
| `land_auctions_special.json` | All special (Заболоть) listings |
| `land_auctions_grodnorik.json` | All notices currently listed on grodnorik.gov.by |

The `./data/` directory is created automatically on first write.

---

## HTTP API

`POST /api/v1/land-auctions/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
