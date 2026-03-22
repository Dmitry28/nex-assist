#!/bin/bash
# Triggers the dev scrape workflow on GitHub Actions.
# Scheduled via launchd — see scripts/com.land-scraper.dev-trigger.plist

# Skip weekends
DAY=$(date +%u)  # 1=Mon ... 7=Sun
if [ "$DAY" -ge 6 ]; then
  exit 0
fi

/opt/homebrew/bin/gh workflow run daily-scrape.yml \
  --repo Dmitry28/nex-assist \
  --ref dev
