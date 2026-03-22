# Car Auctions Module

Scrapes car auction listings from [bid.cars](https://bid.cars), diffs them against the previous run, and sends a Telegram summary.

---

## How it works

```
Cron trigger (or HTTP POST /run)
  → CarAuctionsService.run()
      1. BidCarsParserService  — fetch current listings from bid.cars (Puppeteer)
      2. SnapshotService       — read previous listings from disk
      3. Diff                  — detect new / removed listings
      4. CarAuctionsNotifierService — send Telegram summary + per-listing messages
      5. SnapshotService       — persist updated snapshots to disk
```

**Notification comes before persistence.**
If Telegram is down the summary send throws → snapshots are NOT updated → listings remain "new" on the next run → no items are silently missed.

---

## Services

| Service | Responsibility |
|---|---|
| `CarAuctionsService` | Orchestration: cron scheduling, run guard, diff logic, error reporting |
| `BidCarsParserService` | Infrastructure: Puppeteer scraping of the bid.cars search results page |
| `CarAuctionsNotifierService` | Domain: format car-auction captions/summaries, delegate sends to `TelegramService` |

Shared services (from `src/common/`):
- `SnapshotService` — generic read/write JSON snapshots to `./data/`
- `TelegramService` (via `TelegramModule`) — low-level Telegram API wrapper

---

## Parser approach

Uses URL-based card detection: finds all `<a href*="/lot/">` links instead of relying on CSS class names. This is resilient to front-end rebuilds that rename CSS classes.

If 0 results are returned, check:
1. Lot detail URLs still contain `/lot/`
2. The page loads within `PAGE_TIMEOUT_MS`
3. The search URL still returns results

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `CAR_AUCTIONS_SCRAPE_URL` | bid.cars VW Atlas filter URL | URL to scrape |
| `CAR_AUCTIONS_SCRAPE_CRON` | `0 9 * * *` (09:00 UTC daily) | Cron expression |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_CAR_AUCTIONS_CHAT_ID` | — | Target chat/channel ID |

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `car_auctions_all.json` | All current listings (used for next-run diff) |
| `car_auctions_new.json` | New listings from the last run |
| `car_auctions_removed.json` | Removed listings from the last run |

---

## HTTP API

`POST /api/v1/car-auctions/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
