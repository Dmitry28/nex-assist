# realt Module

Scrapes real-estate listings from [realt.by](https://realt.by) for the configured feeds, diffs them, and sends Telegram notifications. Tracks **plots, garages, houses (cottages), and dachas**.

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

Pagination is page-based: `?page=N` until `page * pageSize >= totalCount` or `MAX_PAGES` (30) is reached, with a 1 s pause between pages. A page that fails mid-feed sets the `truncated` flag rather than silently shortening the inventory.

**No time window.** Every feed is diffed in full. Unlike kufar, realt.by's `updatedAt` *does*
move on most seller edits, so the 48 h window was catching price changes here — measured against
a 2-day-old snapshot there were no missed ones. It still lost listings whose `updatedAt` predates
their appearance in the feed (3 of 4 newly-seen objects had stamps older than 48 h).

Dropping the window anyway keeps both modules on one rule and removes any dependence on
timestamp semantics the sites can change without notice. The largest feed is ~250 objects, so a
full diff costs 9 page requests.

---

## Feeds

Feeds are configured in `realt.config.ts` as an array of `{ key, url, linkPath }` objects (`linkPath` is the URL segment for canonical listing URLs — differs per property type). Each feed maps to a separate snapshot file `realt_<key>_all.json`.

| Feed | Area | Covers | `linkPath` |
|---|---|---|---|
| `plots` | Grodno region | Участки | `sale-plots` |
| `garage` | Grodno region | Гаражи | `sale-garage` |
| `dom` | Grodno region | Дома/коттеджи | `sale-cottages` |
| `dacha` | Grodno region | Дачи | `sale-dachi` |
| `grodno-plots` | Grodno "bridge zone" | Участки | `sale-plots` |
| `grodno-dom` | Grodno "bridge zone" | Дома/коттеджи | `sale-cottages` |
| `grodno-dacha` | Grodno "bridge zone" | Дачи | `sale-dachi` |
| `grodno-taunhaus` | Grodno "bridge zone" | Таунхаусы, проданные как квартиры (keyword-filtered) | `sale-flats` |

### Townhouses

realt.by has no townhouse section (`/sale/townhouses/` 404s). Most are filed under `cottages`
and already covered — 20 in the region feed, 3 inside the zone. A minority are sold as flats
and live in `sale/flats`, which `grodno-taunhaus` watches with a keyword filter
(see `common/utils/keyword-filter.ts`): unfiltered it is 70 flats in the zone for 2 townhouses.

### Grodno "bridge zone"

A narrower bbox over the Grodno city core (`coords=53.6689&23.7020&53.7590&23.8137`), watched as an investment target — a bridge is planned there within ~2 years, so the goal is to spot cheap plots, dachas and old houses early. Mirrors `KUFAR_DEFAULTS.GRODNO_*`; unlike kufar (which lumps everything into `dom`), realt.by splits the types, so the zone needs three feeds.

The bbox sits fully **inside** the region bboxes, so the same ad is notified from both the region and the zone feed. That is intentional — the region feeds dilute the zone (region cottages: 252 objects vs 26 inside the zone) and can hit `MAX_PAGES` before reaching it.

---

## Price change detection

Identical to kufar — both modules use `common/utils/price-change.ts`. A change counts only
when **both** currency figures move, **in the same direction**, and **each by at least 2 %**.
realt.by exposes the two figures directly via `priceRates["840"]` (USD) and `priceRates["933"]`
(BYN). See the kufar `_DOC.md` for the measurements behind the rule.

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `REALT_PLOTS_URL` | hardcoded Grodno-region plots search | Search URL for the `plots` feed |
| `REALT_GARAGE_URL` | hardcoded Grodno-region garages search | Search URL for the `garage` feed |
| `REALT_COTTAGES_URL` | hardcoded Grodno-region houses search | Search URL for the `dom` feed |
| `REALT_DACHI_URL` | hardcoded Grodno-region dachas search | Search URL for the `dacha` feed |
| `REALT_GRODNO_PLOTS_URL` | hardcoded bridge-zone plots search | Search URL for the `grodno-plots` feed |
| `REALT_GRODNO_COTTAGES_URL` | hardcoded bridge-zone houses search | Search URL for the `grodno-dom` feed |
| `REALT_GRODNO_DACHI_URL` | hardcoded bridge-zone dachas search | Search URL for the `grodno-dacha` feed |
| `REALT_GRODNO_TOWNHOUSE_URL` | hardcoded bridge-zone flats search | Search URL for the `grodno-taunhaus` feed |
| `REALT_SCRAPE_CRON` | `0 9 * * *` | Reserved (cron currently disabled) |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_REALT_CHAT_ID` | — | Target chat/channel ID |

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `realt_plots_all.json` | Plot listings snapshot |
| `realt_garage_all.json` | Garage listings snapshot |
| `realt_dom_all.json` | House (cottage) listings snapshot |
| `realt_dacha_all.json` | Dacha listings snapshot |
| `realt_grodno-plots_all.json` | Bridge-zone plot listings snapshot |
| `realt_grodno-dom_all.json` | Bridge-zone house listings snapshot |
| `realt_grodno-dacha_all.json` | Bridge-zone dacha listings snapshot |
| `realt_grodno-taunhaus_all.json` | Bridge-zone townhouse-in-flats snapshot |

Each entry includes `firstSeenAt` and `lastSeenAt` timestamps for tracking.

---

## HTTP API

`POST /api/v1/realt/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
