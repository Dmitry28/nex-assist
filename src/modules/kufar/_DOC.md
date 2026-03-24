# kufar Module

Scrapes real-estate listings from [kufar.by](https://re.kufar.by) across multiple configured feeds, diffs them, and sends Telegram notifications.

---

## How it works

```
Cron trigger (or HTTP POST /run)
  → KufarService.run()
      For each feed:
        1. KufarParserService   — fetch recent listings (native fetch, no Puppeteer)
        2. SnapshotService      — read previous snapshot from disk
        3. Diff                 — detect new listings and price changes
      4. KufarNotifierService   — send Telegram summary + per-listing messages
      5. SnapshotService        — persist updated snapshots to disk
```

**Notify-then-persist strategy** — a listing is only saved to the snapshot after its Telegram notification is successfully delivered. If Telegram fails, the listing remains "new" and will be retried on the next run. This differs from BidCars, which always persists.

---

## Services

| Service | Responsibility |
|---|---|
| `KufarService` | Orchestration: cron, run guard, per-feed diff, persist decision |
| `KufarParserService` | Infrastructure: fetch HTML, parse `__NEXT_DATA__` JSON, paginate |
| `KufarNotifierService` | Domain: format captions/summaries, send via `TelegramService` |

---

## Parser approach

Kufar SSR pages embed all listing data in a `<script id="__NEXT_DATA__">` JSON block. The parser reads this directly — no Puppeteer, no DOM interaction, no JavaScript execution needed.

Pagination follows cursor tokens from the same JSON. Stops when listings are older than `LOOKBACK_HOURS` (48h) or `MAX_PAGES` is reached.

---

## Feeds

Feeds are configured in `kufar.config.ts` as an array of `{ key, url }` objects. Each feed maps to a separate snapshot file `kufar_<key>_all.json`. Current feeds: `garazh`, `uchastok`, `dom`.

---

## Price change detection

A price change is detected only when **both** BYN and USD prices differ from the previous snapshot. If either currency is unchanged, it means the seller didn't change the price — the other just fluctuated with the exchange rate. `effectivePrice` treats 0 and `undefined` as equivalent to avoid false positives on missing prices. When no numeric price is set, the listing shows "Договорная" (negotiable).

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `KUFAR_SCRAPE_CRON` | `0 9 * * *` (09:00 UTC daily) | Cron expression |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_KUFAR_CHAT_ID` | — | Target chat/channel ID |

Feed URLs are hardcoded in `kufar.config.ts`.

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `kufar_garazh_all.json` | Garage listings snapshot |
| `kufar_uchastok_all.json` | Plot listings snapshot |
| `kufar_dom_all.json` | House listings snapshot |

Each entry includes `firstSeenAt` and `lastSeenAt` timestamps for tracking.

---

## HTTP API

`POST /api/v1/kufar/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
