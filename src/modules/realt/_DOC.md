# realt Module

Scrapes real-estate listings from [realt.by](https://realt.by) for the configured feeds, diffs them, and sends Telegram notifications. Currently tracks **plots only**, but the feed array is extensible.

---

## How it works

```
HTTP POST /api/v1/realt/run
  → RealtService.run()
      For each feed:
        1. RealtParserService   — fetch listings (native fetch, no Puppeteer)
        2. SnapshotService      — read previous snapshot from disk
        3. Diff                 — detect new listings and price changes
      4. RealtNotifierService   — send Telegram summary + per-listing messages
      5. SnapshotService        — persist updated snapshots to disk
```

**Notify-then-persist strategy** — a listing is only saved to the snapshot after its Telegram notification is successfully delivered. If Telegram fails, the listing remains "new" and is retried on the next run.

---

## Services

| Service | Responsibility |
|---|---|
| `RealtService` | Orchestration: run guard, per-feed diff, persist decision |
| `RealtParserService` | Infrastructure: fetch HTML, parse `__NEXT_DATA__` JSON, paginate |
| `RealtNotifierService` | Domain: format captions/summaries, send via `TelegramService` |

---

## Parser approach

realt.by SSR pages embed all listing data in `<script id="__NEXT_DATA__">`. The parser reads `props.pageProps.objects[]` and `props.pageProps.pagination` directly — no Puppeteer.

Pagination is page-based: `?page=N` until `page * pageSize >= totalCount` or `MAX_PAGES` is reached.

**No time window**: the search URL already returns the full filtered result set (e.g. all plots in a region/bbox), regardless of listing age. The first run creates a baseline; subsequent runs only diff.

---

## Feeds

Feeds are configured in `realt.config.ts` as an array of `{ key, url }` objects. Each feed maps to a separate snapshot file `realt_<key>_all.json`. Current feeds: `plots`.

---

## Price change detection

A price change is detected only when **both** BYN and USD prices differ from the previous snapshot. If either currency is unchanged, the seller didn't change the price — the other just fluctuated with the exchange rate. realt.by exposes both directly via `priceRates["840"]` (USD) and `priceRates["933"]` (BYN).

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `REALT_PLOTS_URL` | hardcoded Grodno-region plots search | Search URL for the `plots` feed |
| `REALT_SCRAPE_CRON` | `0 9 * * *` | Reserved (cron currently disabled) |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_REALT_CHAT_ID` | — | Target chat/channel ID |

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `realt_plots_all.json` | Plot listings snapshot |

Each entry includes `firstSeenAt` and `lastSeenAt` timestamps for tracking.

---

## HTTP API

`POST /api/v1/realt/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
