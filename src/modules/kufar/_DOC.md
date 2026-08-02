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

Pagination follows cursor tokens from the same JSON until the feed's inventory is exhausted or `MAX_PAGES` (40) is reached. Pages are fetched 1.5 s apart — Kufar returned HTTP 429 on page 12 when walked back-to-back. A page that fails mid-feed sets the `truncated` flag rather than silently shortening the inventory.

**No time window.** Every feed is diffed in full. `list_time` is the publish/bump time, not a
"last modified" stamp — a seller can cut the price and it stays put, so filtering by age drops
most of what we watch for.

Measured against a **2-day-old** snapshot (so a recent edit could not have aged out of the
window): of 56 genuine price changes, **0** carried a `list_time` within 48 h, and 74 of 85
never-recorded listings likewise. A daily 48 h window would have caught none of them.

An earlier measurement against a 17-day-old snapshot was inconclusive: the window is applied
daily, so a stamp that looks old today may well have been fresh on the day the run saw it.

---

## Feeds

Feeds are configured in `kufar.config.ts` as an array of `{ key, url }` objects. Each feed maps to a separate snapshot file `kufar_<key>_all.json`.

| Feed | Area | Covers |
|---|---|---|
| `garazh` | Grodno oblast | Гаражи |
| `uchastok` | Grodno oblast | Участки |
| `dom` | Grodno oblast | Дома, дачи, коттеджи, таунхаусы |
| `grodno-uchastok` | Grodno "bridge zone" | Участки |
| `grodno-dom` | Grodno "bridge zone" | Дома, дачи, коттеджи, таунхаусы |
| `grodno-taunhaus` | Grodno "bridge zone" | Таунхаусы, проданные как квартиры (keyword-filtered) |
| `neman-uchastok` | Neman reservoir | Участки |
| `neman-dom` | Neman reservoir | Дома, дачи, коттеджи |

### Townhouses

Kufar has no townhouse category either (`kupit/taunhaus` returns zero ads). Most townhouses
are filed under `dom` with `house_type_for_sell = Таунхаус` and are already covered — 13 were
found in the oblast feed. A minority are sold as flats ("квартира в блокированном доме") and
live in `kupit/kvartiru`, which no houses feed reaches. The `grodno-taunhaus` feed watches
that category with a keyword filter (see `common/utils/keyword-filter.ts`): unfiltered it is
86 flats in the zone for 2 townhouses.

Note the category segment is `kvartiru` — `kvartira` and `kvartiry` both 404.

**Kufar has no separate `dacha` / `kottedzh` category** — both URLs return zero ads. Дачи and коттеджи live inside `kupit/dom`, distinguished by the `house_type_for_sell` ad parameter (`Дом`, `Коттедж`, `Дача`, `Таунхаус`, `Часть дома`). So `dom` is the only feed needed for all of them.

### Grodno "bridge zone"

A narrower bbox over the Grodno city core (`23.7020,53.6689,23.8137,53.7590`), watched as an investment target — a bridge is planned there within ~2 years, so the goal is to spot cheap plots, dachas and old houses early.

The bbox sits fully **inside** the oblast bboxes, so these listings also appear in the oblast feeds — the same ad will be notified twice. That is intentional: the oblast feeds are region-wide and dilute the zone (page 1 of the oblast `dom` feed had 1 of 30 ads inside this bbox), and can hit `MAX_PAGES` before reaching it. Separate feeds guarantee the zone is never truncated away.

### Neman reservoir zone

A second investment area east of the city — the Гродненское море / Neman backwater around
Квасовка–Березовое (`23.9847,53.4182,24.2082,53.5993`). **Waterfront plots are the target**;
houses and dachas there sit on the same land, so `neman-dom` is tracked alongside. No garage
feed — the area has none.

The bbox uses kufar's `/l/belarus/` scope rather than an oblast segment: the bbox does the
filtering, and the wider scope avoids losing listings filed under a neighbouring region.

---

## Price change detection

Shared with realt via `common/utils/price-change.ts`. A change counts only when **both**
currency figures move, **in the same direction**, and **each by at least 2 %**.

Both figures are conversions of one base price the site does not expose, so a seller edit
scales them together while exchange-rate drift does not. Requiring both to move already
covers listings priced in BYN or USD (the base figure stays put). The direction and 2 %
checks cover listings quoted in a third currency, where drift moves both.

Measured against the 16.07 snapshot, the old "both figures moved" rule flagged 34 kufar and
16 realt listings; 13 and 6 of those were pure drift — including unrelated listings sharing
an identical -2.58 % / +0.69 % signature, which only a rate change can produce.

Deliberate trade-off: genuine edits below 2 % are not reported. When no numeric price is set
the listing shows "Договорная" (negotiable); a price appearing or disappearing is always
reported, since there is no percentage to compare.

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `KUFAR_GARAGES_URL` | hardcoded oblast garages search | Search URL for the `garazh` feed |
| `KUFAR_LAND_URL` | hardcoded oblast plots search | Search URL for the `uchastok` feed |
| `KUFAR_HOUSES_URL` | hardcoded oblast houses search | Search URL for the `dom` feed |
| `KUFAR_GRODNO_LAND_URL` | hardcoded bridge-zone plots search | Search URL for the `grodno-uchastok` feed |
| `KUFAR_GRODNO_HOUSES_URL` | hardcoded bridge-zone houses search | Search URL for the `grodno-dom` feed |
| `KUFAR_GRODNO_TOWNHOUSE_URL` | hardcoded bridge-zone flats search | Search URL for the `grodno-taunhaus` feed |
| `KUFAR_NEMAN_LAND_URL` | hardcoded reservoir plots search | Search URL for the `neman-uchastok` feed |
| `KUFAR_NEMAN_HOUSES_URL` | hardcoded reservoir houses search | Search URL for the `neman-dom` feed |
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
| `kufar_grodno-uchastok_all.json` | Bridge-zone plot listings snapshot |
| `kufar_grodno-dom_all.json` | Bridge-zone house listings snapshot |
| `kufar_grodno-taunhaus_all.json` | Bridge-zone townhouse-in-flats snapshot |
| `kufar_neman-uchastok_all.json` | Reservoir plot listings snapshot |
| `kufar_neman-dom_all.json` | Reservoir house listings snapshot |

Each entry includes `firstSeenAt` and `lastSeenAt` timestamps for tracking.

---

## HTTP API

`POST /api/v1/kufar/run` — trigger a scrape immediately (returns the full result JSON).
Returns `409` if a scrape is already in progress.
