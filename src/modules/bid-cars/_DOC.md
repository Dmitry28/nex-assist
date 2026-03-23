# bid-cars Module

Scrapes car auction listings from [bid.cars](https://bid.cars), diffs them against the previous run, and sends a Telegram summary.

---

## How it works

```
Cron trigger (or HTTP POST /run)
  → BidCarsService.run()
      1. BidCarsParserService  — fetch active listings (Puppeteer)
      2. SnapshotService       — read previous snapshots from disk
      3. Diff                  — detect new / removed listings
      4. BidCarsParserService  — look up sold prices (Ended → Archived fallback)
      5. BidCarsNotifierService — send Telegram summary + per-listing messages
      6. SnapshotService       — persist updated snapshots to disk
```

**Always-persist strategy** — snapshots are saved after every run, regardless of whether Telegram succeeded. bid.cars returns the full current state each time, so diffs can always be reconstructed on the next run. This differs from Kufar, which only persists what was successfully notified.

---

## Services

| Service | Responsibility |
|---|---|
| `BidCarsService` | Orchestration: cron, run guard, diff, sold price enrichment, error reporting |
| `BidCarsParserService` | Infrastructure: Puppeteer scraping (browser pooled across calls per cycle) |
| `BidCarsNotifierService` | Domain: format captions/summaries, delegate sends to `TelegramService` |

Shared services (from `src/common/`):
- `SnapshotService` — generic read/write JSON snapshots to `./data/`
- `TelegramService` (via `TelegramModule`) — low-level Telegram API wrapper

---

## Sold price tracking

When a listing disappears from active results it moves to `bid_cars_removed.json`. On each subsequent run, the service fetches the **Ended** search page (same filters, `status=Ended`) and matches by VIN to find the final sold price. If not found there, it falls back to the **Archived** search page. Retries continue for up to `SOLD_LOOKUP_RETENTION_DAYS` (14 days). A follow-up Telegram notification is sent when a price is found.

---

## Parser approach

Uses URL-based card detection: finds all `<a href*="/lot/">` links — resilient to CSS class renames. VIN and lot ID are parsed from the URL, not the DOM.

If 0 results are returned, check:
1. Lot detail URLs still contain `/lot/`
2. The page loads within `PAGE_TIMEOUT_MS`
3. The search URL still returns results (try opening it in a browser)

**Browser pooling** — one Puppeteer instance is reused across all `fetchListings` calls within a scrape cycle (active + ended + archived). It reconnects automatically if it crashes.

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `BID_CARS_SCRAPE_URL` | bid.cars VW Atlas filter URL | Active listings URL (`status=Active`) |
| `BID_CARS_SCRAPE_CRON` | `0 9 * * *` (09:00 UTC daily) | Cron expression |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_BID_CARS_CHAT_ID` | — | Target chat/channel ID |

`endedUrl` and `archivedUrl` are derived automatically from `BID_CARS_SCRAPE_URL` — no separate config needed.

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `bid_cars_all.json` | Current active listings (used for next-run diff) |
| `bid_cars_new.json` | New listings from the last run |
| `bid_cars_removed.json` | Removed listings with sold price tracking (kept for 14 days) |

---

## HTTP API

`POST /api/v1/bid-cars/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
