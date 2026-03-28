/**
 * Scrapes last 30 sold land lots from gcn.by archive and computes statistics.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/archive-stats.ts          # dry run
 *   npx ts-node -r tsconfig-paths/register src/scripts/archive-stats.ts --send   # send to Telegram
 */
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import puppeteer from 'puppeteer';

const ARCHIVE_URL = 'https://gcn.by/arhiv-aukczionov/';
const TARGET_PAGES = 30;
const CONCURRENCY = 3;
const TIMEOUT_MS = 30_000;
const SEND = process.argv.includes('--send');

// ── env ───────────────────────────────────────────────────────────────────────

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

// ── types ─────────────────────────────────────────────────────────────────────

type LotType = 'участок' | 'дом+участок';

interface Lot {
  address: string;
  salePriceRaw: string;
  price: number | null; // тыс. руб.
  type: LotType;
  month: string; // "YYYY-MM"
  sourceUrl: string;
}

// ── scraping ──────────────────────────────────────────────────────────────────

function detectType(urlSlug: string): LotType {
  return urlSlug.includes('nezavershyon') ? 'дом+участок' : 'участок';
}

function parseMonth(url: string): string {
  const m = url.match(/\/(\d{4})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}` : 'unknown';
}

function parsePrice(raw: string): number | null {
  if (!raw || raw === 'Не найдена') return null;
  // "42 тыс. руб." → 42, "22,2 тыс. руб." → 22.2, "74,8 тыс. руб.;" → 74.8
  const m = raw.match(/([\d\s,]+)\s*тыс/);
  if (!m) return null;
  return parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
}

function parseLotsFromText(text: string, sourceUrl: string, type: LotType, month: string): Lot[] {
  const dashLines = text.match(/^[—–-]\s*.+$/gm);
  if (dashLines && dashLines.length > 0) {
    return dashLines.map(line => {
      const addrMatch = line.match(/^[—–-]\s*(.+?)\s+площадью/i);
      const priceMatch = line.match(/Цена продажи\s*(.+?)(?:;|$)/i);
      const raw = priceMatch?.[1]?.trim() ?? 'Не найдена';
      return {
        address: addrMatch?.[1]?.trim() ?? 'Не найден',
        salePriceRaw: raw,
        price: parsePrice(raw),
        type,
        month,
        sourceUrl,
      };
    });
  }

  const salePriceMatch = text.match(/Цена продажи\s*(.+?)(?:\r?\n|$)/);
  const raw = salePriceMatch?.[1]?.trim() ?? 'Не найдена';

  const addrField = text.match(/Адрес:\s*(.+)/);
  let address = addrField?.[1]?.trim();
  if (!address) {
    const lotMatch = text.match(
      /(?:земельный участок|жилой дом|незавершён\S+(?:\s+\S+)?)\s+(.+?)(?=\s+площадью|\s+начальная|\s*,\s*начальная)/i,
    );
    address = lotMatch?.[1]?.trim();
  }
  if (!address) {
    const introMatch = text.match(/На продажу[^\n.]+/i);
    address = introMatch?.[0]?.trim();
  }

  return [
    {
      address: address ?? 'Не найден',
      salePriceRaw: raw,
      price: parsePrice(raw),
      type,
      month,
      sourceUrl,
    },
  ];
}

async function scrapeArchive(): Promise<Lot[]> {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const archiveUrls: { url: string; type: LotType; month: string }[] = [];

  try {
    const listPage = await browser.newPage();
    let pageNum = 1;

    while (archiveUrls.length < TARGET_PAGES) {
      const url = pageNum === 1 ? ARCHIVE_URL : `${ARCHIVE_URL}page/${pageNum}/`;
      console.log(`  Archive page ${pageNum}...`);
      try {
        await listPage.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });
      } catch {
        break;
      }

      const items = await listPage.evaluate(() =>
        Array.from(document.querySelectorAll('.auction')).map(el => {
          const anchor = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find(
            a => !!a.textContent?.trim(),
          );
          return { title: anchor?.textContent?.trim() ?? '', url: anchor?.href ?? '' };
        }),
      );

      if (items.length === 0) break;

      for (const item of items) {
        if (!item.url) continue;
        const t = item.title.toLowerCase();
        if (
          (!t.includes('земельного участка') && !t.includes('незавершён')) ||
          t.includes('аренд') ||
          t.includes('нежилог')
        )
          continue;
        const slug = item.url.split('/').filter(Boolean).at(-1) ?? '';
        archiveUrls.push({ url: item.url, type: detectType(slug), month: parseMonth(item.url) });
        if (archiveUrls.length >= TARGET_PAGES) break;
      }
      pageNum++;
    }
    await listPage.close();

    console.log(`  Fetching details for ${archiveUrls.length} pages...`);
    const lots: Lot[] = [];
    const queue = [...archiveUrls];
    const poolSize = Math.min(CONCURRENCY, archiveUrls.length);
    const pages = await Promise.all(Array.from({ length: poolSize }, () => browser.newPage()));
    let done = 0;

    await Promise.all(
      pages.map(async page => {
        while (queue.length > 0) {
          const entry = queue.shift();
          if (!entry) break;
          try {
            await page.goto(entry.url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });
          } catch {
            done++;
            continue;
          }
          const text = await page.evaluate(() => document.body.innerText);
          lots.push(...parseLotsFromText(text, entry.url, entry.type, entry.month));
          done++;
          process.stdout.write(`\r  [${done}/${archiveUrls.length}] fetched`);
        }
        await page.close();
      }),
    );

    console.log('');
    return lots;
  } finally {
    await browser.close();
  }
}

// ── statistics ────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function fmt(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

function buildStats(lots: Lot[]): string {
  const withPrice = lots.filter(l => l.price !== null) as (Lot & { price: number })[];
  const prices = withPrice.map(l => l.price);
  const sorted = [...prices].sort((a, b) => a - b);

  const cheapest = withPrice.reduce((a, b) => (a.price < b.price ? a : b));
  const priciest = withPrice.reduce((a, b) => (a.price > b.price ? a : b));

  // By type
  const byType = (type: LotType) => withPrice.filter(l => l.type === type).map(l => l.price);
  const plotPrices = byType('участок');
  const housePrices = byType('дом+участок');

  // By month (only months with ≥2 priced lots)
  const monthMap = new Map<string, number[]>();
  for (const l of withPrice) {
    if (!monthMap.has(l.month)) monthMap.set(l.month, []);
    monthMap.get(l.month)!.push(l.price);
  }
  const monthOrder = ['2025-11', '2025-12', '2026-01', '2026-02'];
  const monthLabel: Record<string, string> = {
    '2025-11': 'Ноябрь 2025',
    '2025-12': 'Декабрь 2025',
    '2026-01': 'Январь 2026',
    '2026-02': 'Февраль 2026',
  };

  // Price buckets
  const buckets = [
    { label: 'до 30 тыс.', min: 0, max: 30 },
    { label: '30–60 тыс.', min: 30, max: 60 },
    { label: '60–100 тыс.', min: 60, max: 100 },
    { label: '100–150 тыс.', min: 100, max: 150 },
    { label: 'от 150 тыс.', min: 150, max: Infinity },
  ];

  const lines: string[] = [];

  lines.push(`📊 <b>Статистика продаж участков gcn.by</b>`);
  lines.push(`Выборка: ${lots.length} лотов · ${withPrice.length} с ценой`);
  lines.push('');

  // Overall
  lines.push(`<b>💰 Цены (тыс. руб.)</b>`);
  lines.push(`Мин: <b>${fmt(sorted[0])}</b> · Макс: <b>${fmt(sorted[sorted.length - 1])}</b>`);
  lines.push(`Среднее: <b>${fmt(avg(prices))}</b> · Медиана: <b>${fmt(median(prices))}</b>`);
  lines.push('');

  // By type
  lines.push(`<b>🏷 По типу объекта</b>`);
  if (plotPrices.length > 0)
    lines.push(
      `Участок (${plotPrices.length}): avg <b>${fmt(avg(plotPrices))}</b> тыс., медиана <b>${fmt(median(plotPrices))}</b> тыс.`,
    );
  if (housePrices.length > 0)
    lines.push(
      `Дом+участок (${housePrices.length}): avg <b>${fmt(avg(housePrices))}</b> тыс., медиана <b>${fmt(median(housePrices))}</b> тыс.`,
    );
  lines.push('');

  // Monthly trend
  lines.push(`<b>📅 Средняя цена по месяцам</b>`);
  for (const m of monthOrder) {
    const mp = monthMap.get(m);
    if (!mp || mp.length < 2) continue;
    lines.push(`${monthLabel[m]}: <b>${fmt(avg(mp))}</b> тыс. (${mp.length} лотов)`);
  }
  lines.push('');

  // Buckets
  lines.push(`<b>📈 Распределение цен</b>`);
  for (const b of buckets) {
    const count = prices.filter(p => p >= b.min && p < b.max).length;
    if (count === 0) continue;
    const bar = '█'.repeat(Math.round((count / withPrice.length) * 10));
    lines.push(`${b.label}: ${bar} ${count}`);
  }
  lines.push('');

  // Record holders
  lines.push(`<b>🏆 Рекорды</b>`);
  lines.push(`Дороже всего: <b>${fmt(priciest.price)} тыс.</b> — ${priciest.address}`);
  lines.push(`🔗 <a href="${priciest.sourceUrl}">ссылка</a>`);
  lines.push(`Дешевле всего: <b>${fmt(cheapest.price)} тыс.</b> — ${cheapest.address}`);
  lines.push(`🔗 <a href="${cheapest.sourceUrl}">ссылка</a>`);

  // No-sale rate
  const noSale = lots.length - withPrice.length;
  if (noSale > 0) {
    lines.push('');
    lines.push(`⚠️ Без цены продажи: ${noSale} лотов (торги не состоялись или данные отсутствуют)`);
  }

  return lines.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const env = loadEnv();
  const token = process.env.TELEGRAM_TOKEN ?? env['TELEGRAM_TOKEN'] ?? '';
  const chatId =
    process.env.TELEGRAM_LAND_AUCTIONS_CHAT_ID ?? env['TELEGRAM_LAND_AUCTIONS_CHAT_ID'] ?? '';

  if (SEND && (!token || !chatId))
    throw new Error('TELEGRAM_TOKEN or TELEGRAM_LAND_AUCTIONS_CHAT_ID not set');

  console.log(`Mode: ${SEND ? 'SEND to Telegram' : 'DRY RUN (pass --send to actually send)'}\n`);

  const lots = await scrapeArchive();
  const report = lots.slice(0, TARGET_PAGES);
  const statsText = buildStats(report);

  console.log('\n' + '='.repeat(60));
  console.log(statsText.replace(/<[^>]+>/g, ''));
  console.log('='.repeat(60));

  if (!SEND) {
    console.log('\nDRY RUN complete. Run with --send to post to Telegram.');
    return;
  }

  console.log('\nSending to Telegram...');
  await telegramSend(token, chatId, statsText);
  console.log('Done.');
}

run().catch(err => {
  console.error('archive-stats failed:', err);
  process.exit(1);
});
