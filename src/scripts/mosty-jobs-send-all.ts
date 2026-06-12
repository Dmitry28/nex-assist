/**
 * One-off: read the local mosty-jobs snapshot and send ALL vacancies to the
 * Telegram chat as a compact digest (multiple messages, each within the
 * Telegram length limit). Useful right after a baseline run to populate the
 * chat with the vacancies that were silenced.
 *
 * `--sources=joblab,kufar` (or SEND_ALL_SOURCES env) limits the digest
 * to those sources AND drops vacancies whose title+employer duplicates an
 * entry from a non-selected source — for "send only what's new since the
 * previous digest" after adding a source.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/mosty-jobs-send-all.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/scripts/mosty-jobs-send-all.ts
 *   npx ts-node -r tsconfig-paths/register src/scripts/mosty-jobs-send-all.ts --sources=joblab,kufar
 */
import { promises as fs } from 'fs';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { escapeHtml, TELEGRAM_MESSAGE_LIMIT } from '../common/utils/telegram';
import { LOCALE, TIMEZONE } from '../common/utils/locale';
import { DATA_FILE, SOURCE_LABELS } from '../modules/mosty-jobs/constants';
import {
  isJobSnapshotEntry,
  JOB_SOURCES,
  type JobSnapshotEntry,
  type JobSource,
} from '../modules/mosty-jobs/dto/job-vacancy.dto';
import { dedupeKey } from '../modules/mosty-jobs/mosty-jobs-dedupe';
import { TelegramService } from '../modules/telegram/telegram.service';

const DRY_RUN = process.argv.includes('--dry-run');
const log = new Logger('MostyJobsSendAll');

const parseSourcesArg = (): JobSource[] | null => {
  const raw =
    process.argv.find(a => a.startsWith('--sources='))?.slice('--sources='.length) ??
    process.env.SEND_ALL_SOURCES;
  if (!raw) return null;
  const requested = raw.split(',').map(s => s.trim());
  const valid = (JOB_SOURCES as readonly string[]).filter((s): s is JobSource =>
    requested.includes(s),
  );
  if (valid.length === 0)
    throw new Error(`No valid sources in "${raw}" (known: ${JOB_SOURCES.join(', ')})`);
  return valid;
};

/** Drop the region/district prefix — every vacancy here is in Мостовский район anyway. */
const shortAddress = (address: string): string =>
  address.replace(/^Гродненская область,\s*/i, '').replace(/^Мостовский район,\s*/i, '');

const buildVacancyBlock = (v: JobSnapshotEntry): string => {
  const lines = [`💼 <a href="${v.url}">${escapeHtml(v.title)}</a>`];
  const details = [v.salary, v.employer].filter((s): s is string => Boolean(s));
  if (details.length > 0) lines.push(escapeHtml(details.join(' · ')));
  if (v.address) lines.push(`📍 ${escapeHtml(shortAddress(v.address))}`);
  return lines.join('\n');
};

/** Pack vacancy blocks into as few messages as fit within the Telegram limit. */
const buildDigestMessages = (vacancies: JobSnapshotEntry[]): string[] => {
  const messages: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const vacancy of vacancies) {
    const block = buildVacancyBlock(vacancy);
    // +2 for the blank line between blocks; keep headroom for the part header.
    if (currentLength + block.length + 2 > TELEGRAM_MESSAGE_LIMIT - 100 && current.length > 0) {
      messages.push(current.join('\n\n'));
      current = [];
      currentLength = 0;
    }
    current.push(block);
    currentLength += block.length + 2;
  }
  if (current.length > 0) messages.push(current.join('\n\n'));

  return messages.map((body, i) => `<b>Часть ${i + 1}/${messages.length}</b>\n\n${body}`);
};

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isJobSnapshotEntry)) {
      throw new Error(`${DATA_FILE} has unexpected shape`);
    }
    const allEntries = parsed;
    log.log(`Loaded ${allEntries.length} vacancies from ${DATA_FILE}`);

    const selectedSources = parseSourcesArg() ?? [...JOB_SOURCES];
    let vacancies = allEntries.filter(v => selectedSources.includes(v.source));

    // With a source filter, drop cross-source duplicates of NON-selected
    // sources — those were already delivered in a previous digest.
    if (selectedSources.length < JOB_SOURCES.length) {
      const knownKeys = new Set(
        allEntries.filter(v => !selectedSources.includes(v.source)).map(dedupeKey),
      );
      const before = vacancies.length;
      vacancies = vacancies.filter(v => !knownKeys.has(dedupeKey(v)));
      log.log(
        `Sources: ${selectedSources.join(', ')} — ${vacancies.length} unique (${before - vacancies.length} duplicates dropped)`,
      );
    }
    if (vacancies.length === 0) {
      log.log('Nothing to send');
      return;
    }

    // Stable source order keeps the digest readable.
    const ordered = JOB_SOURCES.flatMap(source => vacancies.filter(v => v.source === source));

    const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
    const counts = JOB_SOURCES.filter(s => ordered.some(v => v.source === s))
      .map(s => `${SOURCE_LABELS[s]}: ${ordered.filter(v => v.source === s).length}`)
      .join(' · ');
    const header = `<b>💼 Все текущие вакансии · Мостовский район · ${date}</b>\n\nВсего: <b>${ordered.length}</b> (${counts})`;
    const messages = [header, ...buildDigestMessages(ordered)];

    log.log(`Prepared ${messages.length} messages`);

    if (DRY_RUN) {
      log.log('\n--- DRY RUN — messages preview ---');
      for (const [i, m] of messages.entries()) {
        log.log(`\n========== message ${i + 1}/${messages.length} (${m.length} chars) ==========`);
        log.log(m);
      }
      log.log('\n--- end dry run ---');
      return;
    }

    const chatId = app.get(ConfigService).get<string>('mostyJobs.chatId');
    if (!chatId) throw new Error('TELEGRAM_MOSTY_JOBS_CHAT_ID is not set');

    const telegram = app.get(TelegramService);
    let sent = 0;
    for (const [i, message] of messages.entries()) {
      const ok = await telegram.sendMessage(chatId, message);
      if (!ok) throw new Error(`Failed to send message ${i + 1}/${messages.length}`);
      sent++;
      log.log(`Sent ${sent}/${messages.length}`);
    }
    log.log('Done.');
  } finally {
    await app.close();
  }
}

main().catch(err => {
  log.error(err);
  process.exit(1);
});
