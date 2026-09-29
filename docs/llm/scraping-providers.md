# Scraping Providers — Operations

Why the chain is ordered the way it is lives in `src/common/scraping/scraping.module.ts`.
This page is for reading the daily-scrape logs and checking provider accounts.

## Chain and limits

Order: ScraperAPI → ZenRows → Scrape.do → ScrapingAnt → ScrapFly.

| Provider    | Free allowance    | Resets                              |
| ----------- | ----------------- | ----------------------------------- |
| ScraperAPI  | 1000 requests/mo  | monthly; free plan refuses anti-bot |
| ZenRows     | 5000 credits/mo   | billing cycle starts on the 3rd     |
| Scrape.do   | 1000 credits/mo   | around the 16th (as of 09.2026)     |
| ScrapingAnt | largest free tier | monthly                             |
| ScrapFly    | one-time grant    | does not refill                     |

## Log lines that are not bugs

A spent or refused provider is skipped for the rest of the run, and the request falls through
to the next one. The run only fails if every provider in the chain fails.

bamper.by passes only through ZenRows, Scrape.do or ScrapFly (the browser, ScraperAPI and
ScrapingAnt are all blocked). When all three are spent, every feed fails with
`Cloudflare challenge not resolved after all retries`. That is why bamper runs only in
production: dev and prod share the keys.

| Log                                                         | Meaning                                                |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `zenrows" out of quota ... HTTP 402`                        | credits used up until the cycle reset                  |
| `Scrape.do rejected the token (HTTP 401)`                   | token valid, account out of credits (`IsActive:false`) |
| `scraperapi" cannot serve this request on its plan ... 403` | free plan, anti-bot request                            |
| `ScrapingAnt was detected by the target site (HTTP 423)`    | bamper.by blocks it; ScrapFly takes over               |
| `ScrapingAnt does not support proxy_country="by"`           | Belarus is not in its country list                     |

In the `Commit updated snapshots via PR` step, lines such as `Telegram down` or
`... is behind Cloudflare` come from jest, not from the scrape.

## Checking an account

```bash
# Scrape.do: remaining requests; IsActive:false means out of credits
curl "https://api.scrape.do/info?token=$SCRAPE_DO_API_KEY"

# ZenRows: usage for the current cycle
curl -H "X-API-Key: $ZENROWS_API_KEY" https://api.zenrows.com/v1/subscriptions/self/details
```

The keys in the local `.env` are empty. The real values are GitHub Actions secrets.

## Provider quirks

- **ScrapingAnt** has no render-wait parameter, so `renderWaitMs` is sent as an awaited
  `js_snippet`. Without the wait, bid.cars sometimes came back as a 254 KB shell with no cards,
  and BidCars aborted on 0 listings (25.09 and 27.09.2026).
