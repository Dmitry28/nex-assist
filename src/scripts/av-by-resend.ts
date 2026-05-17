/**
 * One-off: read local av-by snapshot files and re-send each entry to Telegram
 * as a "new" notification. Useful right after a baseline run to populate the
 * channel with the listings that were silenced.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/av-by-resend.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/scripts/av-by-resend.ts
 */
import { promises as fs } from 'fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildNewCaption } from '../modules/av-by/av-by-format';
import { AvByNotifierService } from '../modules/av-by/av-by-notifier.service';
import type {
  AvByFeedResult,
  AvByResult,
  AvBySnapshotEntry,
} from '../modules/av-by/dto/av-by-listing.dto';

interface FeedSpec {
  feedKey: string;
  label: string;
  file: string;
}

const FEEDS: FeedSpec[] = [
  { feedKey: 'atlas', label: 'VW Atlas', file: './data/av_by_atlas_all.json' },
  {
    feedKey: 'atlas_cross_sport',
    label: 'VW Atlas Cross Sport',
    file: './data/av_by_atlas_cross_sport_all.json',
  },
];

const DRY_RUN = process.argv.includes('--dry-run');
const log = new Logger('AvByResend');

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const feedResults: AvByFeedResult[] = [];
    for (const spec of FEEDS) {
      const raw = await fs.readFile(spec.file, 'utf8');
      const entries = JSON.parse(raw) as AvBySnapshotEntry[];
      feedResults.push({
        feedKey: spec.feedKey,
        label: spec.label,
        total: entries.length,
        newListings: entries,
        soldListings: [],
        priceChanges: [],
        isBaseline: false,
      });
      log.log(`[${spec.feedKey}] loaded ${entries.length} entries`);
    }

    const result: AvByResult = { feeds: feedResults, skipped: false };

    if (DRY_RUN) {
      log.log('\n--- DRY RUN — captions preview ---');
      for (const f of feedResults) {
        for (const [i, l] of f.newListings.entries()) {
          log.log(`\n========== ${f.label} ${i + 1}/${f.newListings.length} ==========`);
          log.log(buildNewCaption(l, f.label, i + 1, f.newListings.length));
        }
      }
      log.log('\n--- end dry run ---');
      return;
    }

    log.log('Sending to Telegram...');
    const notifier = app.get(AvByNotifierService);
    await notifier.notifyRunResult(result);
    log.log('Done.');
  } finally {
    await app.close();
  }
}

main().catch(err => {
  log.error(err);
  process.exit(1);
});
