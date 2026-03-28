/**
 * Scrapes the last 30 sold land plots from gcn.by archive and sends a report to Telegram.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/archive-report.ts          # dry run
 *   npx ts-node -r tsconfig-paths/register src/scripts/archive-report.ts --send   # send to Telegram
 */
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import puppeteer from 'puppeteer';

const ARCHIVE_URL = 'https://gcn.by/arhiv-aukczionov/';
const TARGET_COUNT = 30;
const CONCURRENCY = 3;
const TIMEOUT_MS = 30_000;
const SEND = process.argv.includes('--send');

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function telegramSend(token: string, chatId: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          const parsed = JSON.parse(data) as { ok: boolean; description?: string };
          if (parsed.ok) resolve();
          else reject(new Error(`Telegram error: ${parsed.description ?? data}`));
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

interface ArchiveUrl {
  url: string;
}

interface SoldLot {
  address: string;
  salePrice: string;
  sourceUrl: string;
}

/** Parse lots from an archive detail page's inner text. Handles both single-lot and multi-lot pages. */
function parseLotsFromText(text: string, sourceUrl: string): SoldLot[] {
  // Multi-lot page: lines starting with "—" each describe one lot
  // e.g. "— по ул. Подкрыжакская, 14А площадью 0,0756 га, начальная цена 19 498,00 руб. Цена продажи 74,8 тыс. руб."
  const dashLines = text.match(/^[—–-]\s*.+$/gm);
  if (dashLines && dashLines.length > 0) {
    return dashLines
      .map(line => {
        const addrMatch = line.match(/^[—–-]\s*(.+?)\s+площадью/i);
        const priceMatch = line.match(/Цена продажи\s*(.+?)(?:;|$)/i);
        return {
          address: addrMatch?.[1]?.trim() ?? 'Не найден',
          salePrice: priceMatch?.[1]?.trim() ?? 'Не найдена',
          sourceUrl,
        };
      })
      .filter(l => l.salePrice !== 'Не найдена' || l.address !== 'Не найден');
  }

  // Single-lot page
  const salePriceMatch = text.match(/Цена продажи\s*(.+?)(?:\r?\n|$)/);
  const salePrice = salePriceMatch?.[1]?.trim() ?? 'Не найдена';

  // Try explicit "Адрес:" field first
  const addrField = text.match(/Адрес:\s*(.+)/);
  let address = addrField?.[1]?.trim();

  if (!address) {
    // Extract from lot-type phrase: "земельный участок X площадью" or "жилой дом X площадью"
    const lotMatch = text.match(
      /(?:земельный участок|жилой дом|незавершён\S+(?:\s+\S+)?)\s+(.+?)(?=\s+площадью|\s+начальная|\s*,\s*начальная)/i,
    );
    address = lotMatch?.[1]?.trim();
  }

  if (!address) {
    // Last resort: grab the "На продажу ..." intro sentence
    const introMatch = text.match(/На продажу[^\n.]+/i);
    address = introMatch?.[0]?.trim();
  }

  return [{ address: address ?? 'Не найден', salePrice, sourceUrl }];
}

async function run(): Promise<void> {
  const env = loadEnv();
  const token = process.env.TELEGRAM_TOKEN ?? env['TELEGRAM_TOKEN'] ?? '';
  const chatId =
    process.env.TELEGRAM_LAND_AUCTIONS_CHAT_ID ?? env['TELEGRAM_LAND_AUCTIONS_CHAT_ID'] ?? '';

  if (SEND && (!token || !chatId)) {
    throw new Error('TELEGRAM_TOKEN or TELEGRAM_LAND_AUCTIONS_CHAT_ID not set');
  }

  console.info(`Mode: ${SEND ? 'SEND to Telegram' : 'DRY RUN (pass --send to actually send)'}\n`);

  console.info('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const archiveUrls: ArchiveUrl[] = [];

  try {
    // --- Collect archive listing URLs ---
    const listPage = await browser.newPage();
    let pageNum = 1;

    while (archiveUrls.length < TARGET_COUNT) {
      const url = pageNum === 1 ? ARCHIVE_URL : `${ARCHIVE_URL}page/${pageNum}/`;
      console.info(`Scanning archive page ${pageNum}...`);

      try {
        await listPage.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });
      } catch {
        console.warn(`Archive page ${pageNum} failed to load, stopping`);
        break;
      }

      const pageItems = await listPage.evaluate(() =>
        Array.from(document.querySelectorAll('.auction')).map(el => {
          const anchor = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find(
            a => !!a.textContent?.trim(),
          );
          return {
            title: anchor?.textContent?.trim() ?? '',
            url: anchor?.href ?? '',
          };
        }),
      );

      if (pageItems.length === 0) break;

      for (const item of pageItems) {
        if (!item.url) continue;
        const titleLower = item.title.toLowerCase();
        // Ownership auctions for land plots or unfinished houses (not lease, not other property)
        if (
          (!titleLower.includes('земельного участка') && !titleLower.includes('незавершён')) ||
          titleLower.includes('аренд') ||
          titleLower.includes('нежилог')
        )
          continue;
        archiveUrls.push({ url: item.url });
        if (archiveUrls.length >= TARGET_COUNT) break;
      }

      pageNum++;
    }

    await listPage.close();
    console.info(`Fetching details for ${archiveUrls.length} archive pages...\n`);

    // --- Fetch details with concurrency pool ---
    const allLots: SoldLot[] = [];
    const mutex: SoldLot[] = allLots;
    const queue = [...archiveUrls];
    const poolSize = Math.min(CONCURRENCY, archiveUrls.length);
    const pages = await Promise.all(Array.from({ length: poolSize }, () => browser.newPage()));
    let fetched = 0;

    await Promise.all(
      pages.map(async page => {
        while (queue.length > 0) {
          const entry = queue.shift();
          if (!entry) break;

          try {
            await page.goto(entry.url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });
          } catch {
            console.warn(`Detail page failed: ${entry.url}`);
            fetched++;
            continue;
          }

          const text = await page.evaluate(() => document.body.innerText);
          const lots = parseLotsFromText(text, entry.url);
          mutex.push(...lots);
          fetched++;
          console.info(
            `[${fetched}/${archiveUrls.length}] ${entry.url.split('/').at(-2) ?? ''} → ${lots.length} lot(s)`,
          );
        }
        await page.close();
      }),
    );

    // Take the first TARGET_COUNT lots
    const report = allLots.slice(0, TARGET_COUNT);

    // --- Print report to console for review ---
    console.info(`\n${'='.repeat(60)}`);
    console.info(`REPORT: ${report.length} sold lots`);
    console.info('='.repeat(60));
    report.forEach((lot, i) => {
      console.info(`\n${i + 1}. ${lot.address}`);
      console.info(`   Цена продажи: ${lot.salePrice}`);
      console.info(`   ${lot.sourceUrl}`);
    });
    console.info('\n' + '='.repeat(60));

    if (!SEND) {
      console.info('\nDRY RUN complete. Run with --send to post to Telegram.');
      return;
    }

    // --- Format and send to Telegram ---
    const date = new Date().toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const lines = report.map(
      (l, i) =>
        `${i + 1}. 📍 ${l.address}\n💰 ${l.salePrice}\n🔗 <a href="${l.sourceUrl}">Подробнее</a>`,
    );

    const chunkSize = 10;
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
      const header =
        i === 0 ? `🏡 <b>Последние ${report.length} проданных участков</b> (по ${date})\n\n` : '';
      chunks.push(header + lines.slice(i, i + chunkSize).join('\n\n'));
    }

    console.info(`\nSending ${chunks.length} message(s) to Telegram...`);
    for (const chunk of chunks) {
      await telegramSend(token, chatId, chunk);
      await new Promise(r => setTimeout(r, 500));
    }
    console.info('Done.');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('archive-report failed:', err);
  process.exit(1);
});
