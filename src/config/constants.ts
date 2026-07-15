/**
 * Default values for app configuration.
 *
 * Used in both app.config.ts (runtime fallbacks) and validation.schema.ts (Joi defaults)
 * to keep them in sync without duplication.
 */
export const LAND_AUCTIONS_DEFAULTS = {
  SCRAPE_URL: 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/',
  /** Default cron: every day at 08:00 UTC */
  SCRAPE_CRON: '0 8 * * *',
} as const;

export const KUFAR_DEFAULTS = {
  GARAGES_URL:
    'https://re.kufar.by/l/grodnenskaya-oblast/kupit/garazh?cur=BYR&gbx=b%3A23.725981746227706%2C53.57183301832253%2C23.94948485902068%2C53.75128104662766&size=30',
  LAND_URL:
    'https://re.kufar.by/l/grodnenskaya-oblast/kupit/uchastok?cur=BYR&gbx=b%3A23.63247006323345%2C53.454666565957595%2C24.079476288819368%2C53.81379430265694&size=30',
  HOUSES_URL:
    'https://re.kufar.by/l/grodnenskaya-oblast/kupit/dom?cur=BYR&gbx=b%3A23.656203109090203%2C53.45970346998098%2C24.10320933467615%2C53.81878831030225&size=30',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk) */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const REALT_DEFAULTS = {
  // Each URL combines:
  //   - `addressV2` — Grodno region UUID (matches kufar's `grodnenskaya-oblast` segment)
  //   - `coords` — bbox mirroring kufar's gbx for the matching property type
  //     (kufar `b:west,south,east,north` → realt `coords=south&coords=west&coords=north&coords=east`).
  PLOTS_URL:
    'https://realt.by/grodno-region/sale/plots/map/?addressV2=%5B%7B%22stateRegionUuid%22%3A%22499f04f0-7b00-11eb-8943-0cc47adabd66%22%7D%5D&coords=53.454666565957595&coords=23.63247006323345&coords=53.81379430265694&coords=24.079476288819368&sortType=createdAt',
  GARAGE_URL:
    'https://realt.by/grodno-region/sale/garage/map/?addressV2=%5B%7B%22stateRegionUuid%22%3A%22499f04f0-7b00-11eb-8943-0cc47adabd66%22%7D%5D&coords=53.57183301832253&coords=23.725981746227706&coords=53.75128104662766&coords=23.94948485902068&sortType=createdAt',
  COTTAGES_URL:
    'https://realt.by/grodno-region/sale/cottages/map/?addressV2=%5B%7B%22stateRegionUuid%22%3A%22499f04f0-7b00-11eb-8943-0cc47adabd66%22%7D%5D&coords=53.45970346998098&coords=23.656203109090203&coords=53.81878831030225&coords=24.10320933467615&sortType=createdAt',
  // No dacha bbox in kufar — reuse the houses bbox (same Grodno-region area).
  DACHI_URL:
    'https://realt.by/grodno-region/sale/dachi/map/?addressV2=%5B%7B%22stateRegionUuid%22%3A%22499f04f0-7b00-11eb-8943-0cc47adabd66%22%7D%5D&coords=53.45970346998098&coords=23.656203109090203&coords=53.81878831030225&coords=24.10320933467615&sortType=createdAt',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk) */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const AV_BY_DEFAULTS = {
  // Volkswagen Atlas, year 2023+, engine <= 2.0L
  ATLAS_URL:
    'https://cars.av.by/filter?brands[0][brand]=1216&brands[0][model]=5980&brands[0][generation]=13256&year[min]=2023&engine_capacity[max]=2000',
  // Volkswagen Atlas Cross Sport, year 2023+, engine <= 2.0L
  ATLAS_CROSS_SPORT_URL:
    'https://cars.av.by/filter?brands[0][brand]=1216&brands[0][model]=10265&brands[0][generation]=13810&year[min]=2023&engine_capacity[max]=2000',
  /** Minimum interval between runs — protects ScrapFly free-tier budget (1000 credits/mo). */
  MIN_RUN_INTERVAL_HOURS: 47,
} as const;

export const BID_CARS_DEFAULTS = {
  SCRAPE_URL:
    'https://bid.cars/ru/search/results?search-type=filters&status=Active&type=Automobile&make=Volkswagen&model=Atlas&year-from=2023&year-to=2027&auction-type=All&odometer-to=60000&start-code=Run+and+Drive&engine-size-to=2',
  /** Default cron: every day at 09:00 UTC */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const KUFAR_RENT_FLAT_DEFAULTS = {
  /**
   * travel.kufar.by short-term rental search — narrow bbox in central Grodno
   * (approx. Советская 10 ± 350 m), apartments/houses for rent (`bkcl=rn:20600,20601,1,0`).
   * Dates (`bkcin` / `bkcout`) are injected at runtime — see kufar-rent-flat-dates.ts.
   *
   * The bbox is intentionally tight: we want to be paged only when a new lot appears
   * in this exact area. Most days return 0 listings — that's the steady state and the
   * service handles it gracefully (skips diff so the snapshot is never reset).
   */
  GRODNO_URL:
    'https://travel.kufar.by/l/grodno/arendovat?address=%D0%93%D1%80%D0%BE%D0%B4%D0%BD%D0%BE&bkcl=rn%3A20600%2C20601%2C1%2C0&bku=1&gbx=b%3A23.86182364392963%2C53.716814868074984%2C23.868765200860164%2C53.722414865744966&size=30&sort=rtg',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk). Cron is wired off — trigger via POST. */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const KUFAR_RENT_LONG_DEFAULTS = {
  /**
   * re.kufar.by long-term apartment rental search — narrow bbox in central Grodno.
   * Same domain/SSR structure as the `kufar` (for-sale) module: listings live in
   * `__NEXT_DATA__` → `props.initialState.listing.ads`.
   */
  GRODNO_URL:
    'https://re.kufar.by/l/grodno/snyat/kvartiru?cur=USD&gbx=b%3A23.86183751859784%2C53.717136202923456%2C23.86882199087261%2C53.72273615760897&size=30',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk). Cron is wired off — trigger via POST. */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const GHB_DEFAULTS = {
  /** "Прейскурант РБ" page on ghb.by — server-rendered HTML with all жилые/офисные объекты. */
  PRICE_LIST_URL: 'https://ghb.by/ru/construction/price_apartments/',
  /** "Продажа квартир и домов" page — currently a placeholder; we ping on content change. */
  APARTMENTS_PAGE_URL: 'https://ghb.by/ru/construction/apartments/',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk). Cron is wired off — trigger via POST. */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const POGORANY_DEFAULTS = {
  /** Tilda store API — returns the full product list for the ЖК Погораны catalog. */
  STORE_API_URL: 'https://store.tildacdn.com/api/getproductslist/?storepartuid=856309636292',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk). Cron is wired off — trigger via POST. */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const BAMPER_DEFAULTS = {
  /**
   * bamper.by used-parts searches for the VW Atlas Cross Sport, one URL per part.
   * `god_2023-2026` is a path-segment year filter (2024+ is the facelift generation that
   * fits the owner's 2025 car; 2023 is kept as a slightly wider net). `?sort=DATE-DESC`
   * surfaces the newest listings first. The whole site sits behind Cloudflare, so the
   * parser drives it with Puppeteer (see BidCars for the same approach).
   */
  REAR_BUMPER_URL:
    'https://bamper.by/zchbu/zapchast_bamper-zadniy/marka_volkswagen/model_atlascrosssport/god_2023-2026/?sort=DATE-DESC',
  TAILGATE_URL:
    'https://bamper.by/zchbu/zapchast_kryshka-bagazhnika-dver-3-5/marka_volkswagen/model_atlascrosssport/god_2023-2026/?sort=DATE-DESC',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk). Cron is wired off — trigger via POST. */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const MOSTY_JOBS_DEFAULTS = {
  /**
   * gsz.gov.by state vacancy bank search — Гродненская область (region=12380),
   * Мостовский район (district=14712), newest first, 50 per page.
   * The parser appends `&page=N` and walks pages until a 404.
   */
  GSZ_SEARCH_URL:
    'https://gsz.gov.by/registration/vacancy-search/?region=12380&district=14712&sort_by=sort_published_at_desc&paginate_by=50',
  /** rabota.by (hh.ru Belarus) search — г. Мосты (area=2302), server-rendered HTML. */
  RABOTA_SEARCH_URL: 'https://rabota.by/search/vacancy?area=2302',
  /** joblab.by commercial job board — г. Мосты (srcity=54), RSS feed. */
  JOBLAB_RSS_URL: 'https://joblab.by/vacancy.php?srcity=54&submit=rss',
  /** kufar.by job ads (cat=6010) in Мосты (rgn=3, ar=72) — public JSON API, usually empty. */
  KUFAR_SEARCH_URL:
    'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=6010&rgn=3&ar=72&lang=ru&size=30&sort=lst.d',
  /**
   * e-rabota.by (Evroopt career) vacancies API — the parser appends
   * `&skillazCity=<id>` per city (see EVROOPT_CITY_IDS). Behind a JS
   * verification page, fetched via Puppeteer.
   */
  EVROOPT_API_URL: 'https://static.erabota.by/api/vacancies?page=1&perPage=50',
  /** Мостовская ЦРБ own vacancies page — static Bitrix HTML list. */
  CRB_URL: 'https://mostycrb.by/company/vakansii/',
  /** e-vacancy.by upcoming электронные ярмарки вакансий — paginated static HTML. */
  FAIRS_URL: 'https://e-vacancy.by/markets/',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk). Cron is wired off — trigger via POST. */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const APP_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: 3000,
  APP_NAME: 'land-scraper',
  /** Allow all origins by default. Override in production via CORS_ORIGIN env var. */
  CORS_ORIGIN: '*',
  /** Rate limiter window in milliseconds (60 seconds). */
  THROTTLE_TTL: 60_000,
  /** Maximum requests per window per IP. */
  THROTTLE_LIMIT: 100,
} as const;
