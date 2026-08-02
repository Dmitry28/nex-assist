# townhouses Module

Every townhouse on sale in Grodno, in one place. Fuses the primary (developer) market with
both resale portals, diffs the result, and notifies **the pogorany chat** — townhouses are one
topic for the owner, so everything about them lands in a single channel.

---

## Why a separate module

No single site has a complete view, and the pieces live in four different places:

| # | Source | What it holds |
|---|---|---|
| 1 | `prometr.by` | Primary market — all three Grodno developments |
| 2 | kufar `kupit/dom/taunhaus` | Resale, dedicated sub-category (~10) |
| 3 | realt `sale/cottages/taunhaus` | Resale, dedicated sub-category (~18) |
| 4 | kufar/realt flats + keyword filter | Townhouses filed as "квартира в блокированном доме" |

Source 4 exists because those listings appear in neither dedicated sub-category. It covers the
whole city/region rather than a bbox — the goal is every townhouse in Grodno — so the keyword
filter in `common/utils/keyword-filter.ts` is what keeps it usable: ~705 kufar and ~543 realt
flats reduce to a handful. The filter reads title, description and address, since the wording
usually sits in the description.

Note the sub-categories sit **under houses** — `kupit/dom/taunhaus`, not `kupit/taunhaus`. The
bare path returns zero ads, which is easy to misread as "the site has no townhouse category".

---

## Why prometr.by for the primary market

Grodno's townhouse developers publish no prices of their own:

| Development | Developer | Site | Prices? |
|---|---|---|---|
| ЖК Погораны | ОДО «Айрон» | pogorany.by, airon.by | Only via the `pogorany` module's Tilda catalogue |
| ЖК Белые Росы | ООО «МиллениумСити» | millenium-city.by | No — phone number only |
| ЖК Роял Парк | ООО «АстоСтрой» | astostroi.by | No — phone number only, and sold out |

prometr.by is the one source carrying per-unit figures for all three.

**Overlap with the `pogorany` module is intentional.** That module reads the developer's own
catalogue in more detail; this one sees the whole complex. They notify the same chat, so a
Погораны unit can appear twice — accepted in exchange for neither view having gaps.

---

## Parser approach

prometr.by is plain server-rendered HTML with no `__NEXT_DATA__`, so it is parsed with
targeted regexes, the way the `ghb` module handles ghb.by.

Two levels: a complex page lists its buildings (`…/dom-2-1_1303/`), and each building page
carries the "Квартиры в этом доме" table.

**The complex page has no unit table.** It does contain the string `flats-in__row`, but only
inside a stylesheet — matching the bare class name yields phantom rows. The parser splits on
the opening tag instead, and a test pins that behaviour.

Unit ids come from the trailing `-<id>` of the slug (`4-komnatnaya-185-8-38539`); the earlier
`_1420` is the building, shared by several units.

kufar and realt are read through their existing parser services, provided directly rather than
imported from those modules — they hold no module state.

---

## Identity and de-duplication

`uid` is `"<source>:<native id>"`. Prefixing matters: a kufar ad id and a prometr unit id can
collide, and all sources share one snapshot file.

The same property is often listed on both kufar and realt. They word titles differently, so
identical **price + area** is the join key; the first source collected wins. Listings without
both are never merged.

---

## Price change detection

Uses the shared `common/utils/price-change.ts`. prometr quotes **BYN only**, so it takes the
single-currency path: there is no second figure to cross-check and no conversion to drift, so
any move is the seller's. kufar and realt carry both currencies and take the stricter rule
(same direction, ≥ 2 % each).

---

## Failure handling

Each source is fetched inside its own guard, and `failed` covers two cases: a thrown error,
and a **degraded** fetch. The degraded signal matters because the parsers swallow HTTP errors
and return an empty list — without it a dead site reports "0" and is indistinguishable from a
site with nothing on it. kufar and realt surface it via `truncated` (now set on any failed
page, including the first); prometr returns it per complex.

A failed source is called out in the summary rather than counted as zero. Its listings simply
stay in the snapshot untouched, so the diff never reads the outage as listings being withdrawn.

**Notify-then-persist**: a listing is saved only after its Telegram message is delivered, so a
failed send is retried next run.

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `TOWNHOUSES_KUFAR_URL` | kufar townhouse sub-category | Resale source 2 |
| `TOWNHOUSES_REALT_URL` | realt townhouse sub-category | Resale source 3 |
| `TOWNHOUSES_KUFAR_FLATS_URL` | kufar flats, bridge-zone bbox | Keyword-filtered source 4 |
| `TOWNHOUSES_REALT_FLATS_URL` | realt flats, bridge-zone bbox | Keyword-filtered source 4 |
| `TELEGRAM_TOKEN` | — | Bot token (optional; omit for dry-run) |
| `TELEGRAM_POGORANY_CHAT_ID` | — | Target chat — shared with the `pogorany` module |

Complex URLs are hardcoded in `townhouses.config.ts`.

---

## Data files (`./data/`)

| File | Contents |
|---|---|
| `townhouses_all.json` | All sources in one snapshot, keyed by namespaced `uid` |

---

## HTTP API

`POST /api/v1/townhouses/run` — trigger a scrape immediately. Returns `409` if one is already
in progress.
