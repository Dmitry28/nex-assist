# Land Auctions Module

Scrapes land auction listings from [gcn.by](https://gcn.by), diffs them against the previous run, and sends a Telegram summary.

---

## How it works

```
Cron trigger (or HTTP POST /run)
  → LandAuctionsService.run()
      1. GcnParserService   — fetch current listings from gcn.by (Puppeteer)
      2. SnapshotService    — read previous listings from disk
      3. Diff               — detect new / removed / special listings
      4. ListingNotifierService — send Telegram summary + per-listing messages
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
| `SnapshotService` | Infrastructure: read/write JSON snapshots to `./data/` |
| `ListingNotifierService` | Domain: format land-auction captions/summaries, delegate sends to `TelegramService` |

`TelegramService` lives in the shared `TelegramModule` — this module only does formatting.

---

## Key design decisions

**Dynamic cron** — `SchedulerRegistry` + `CronJob` in `onModuleInit` instead of the `@Cron` decorator, because decorators are evaluated before `ConfigModule` loads the env-based schedule.

**Concurrent run guard** — `isRunning` flag (safe in Node.js single-threaded model). Concurrent HTTP call gets `409 Conflict`.

**Dry-run mode** — if `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` are absent, `TelegramService` logs to console instead of calling the API. The app starts and runs normally without credentials.

**Special listings** — listings whose title contains `'заболо'` (`SPECIAL_KEYWORD`) are tracked separately as the Заболоть area filter.

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `SCRAPE_URL` | gcn.by land auctions page | URL to scrape |
| `SCRAPE_CRON` | `0 8 * * *` (08:00 daily) | Cron expression |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_CHAT_ID` | — | Target chat/channel ID |

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `land_auctions_all.json` | All current listings (used for next-run diff) |
| `land_auctions_new.json` | New listings from the last run |
| `land_auctions_removed.json` | Removed listings from the last run |
| `land_auctions_special.json` | All special (Заболоть) listings |

The `./data/` directory is created automatically on first write.

---

## HTTP API

`POST /api/v1/land-auctions/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
