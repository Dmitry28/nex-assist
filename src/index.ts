import puppeteer, { Browser, Page } from 'puppeteer';
import { promises as fs } from 'fs';
import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  throw new Error('TELEGRAM_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables');
}

const token: string = process.env.TELEGRAM_TOKEN;
const chatId: string = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(token, { polling: false });

const SCRAPE_URL = 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/';
const DATA_FILE = './src/data/all_items.json';
const NEW_ITEMS_FILE = './src/data/new_items.json';
const REMOVED_ITEMS_FILE = './src/data/removed_items.json';
const SPECIAL_ITEMS_FILE = './src/data/zabolot_items.json';
const CONCURRENCY = 4;

interface Item {
  title: string | undefined;
  link: string | undefined;
  description: string | undefined;
  price?: string;
  area?: string;
}

interface Details {
  price: string;
  area: string;
}

async function sendMessage(message: string): Promise<void> {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Failed to send message:', error);
  }
}

async function scrapeData(url: string): Promise<Item[]> {
  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const listPage: Page = await browser.newPage();
  await listPage.goto(url, { waitUntil: 'networkidle0' });
  await listPage.waitForSelector('.vc_grid-item', { timeout: 10000 });

  const items: Item[] = await listPage.evaluate(() => {
    const data: { title: string | undefined; link: string | undefined; description: string | undefined }[] = [];
    const elements = document.querySelectorAll('.vc_grid-item');
    console.log('Number of items found:', elements.length);
    elements.forEach(element => {
      const description = element.querySelector('.vc_gitem-post-data-source-post_excerpt')?.textContent?.trim();
      const title = element.querySelector('.vc_gitem-post-data-source-post_title')?.textContent?.trim();
      const link = (element.querySelector('.vc-zone-link') as HTMLAnchorElement | null)?.href;
      data.push({ title, link, description });
    });
    return data;
  });

  await listPage.close();

  const pages: Page[] = await Promise.all(Array.from({ length: CONCURRENCY }, () => browser.newPage()));

  const queue = [...items];
  await Promise.all(
    pages.map(async page => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        const details = await fetchDetails(page, item.link);
        item.price = details.price;
        item.area = details.area;
      }
      await page.close();
    })
  );

  await browser.close();
  return items;
}

async function fetchDetails(page: Page, link: string | undefined): Promise<Details> {
  try {
    await page.goto(link!, { waitUntil: 'networkidle2' });
    await page.waitForSelector('strong');

    const details: Details = await page.evaluate(() => {
      const priceText = document.body.innerText.match(/Начальная цена:\s*([\d\s,]+)руб\./);
      const areaText = document.body.innerText.match(/Площадь земельного участка:\s*([\d,]+)\s*га/);
      return {
        price: priceText ? priceText[1].trim() + 'руб' : 'Price not found',
        area: areaText ? areaText[1].trim() + 'га' : 'Area not found',
      };
    });

    return details;
  } catch (error) {
    console.error('Error fetching details:', error);
    return { price: 'Error fetching price', area: 'Error fetching area' };
  }
}

const buildMessage = (items: Item[], header: string, range: string): string => {
  return (
    `\n        <b>${range + '. ' + header}</b>\n    ` +
    items
      .map(
        item => `
        <b>${item.title}</b>
        <a href="${item.link}">Ссылка</a>
        <i>${item.description}</i>
        <b>Цена:</b> ${item.price}
        <b>Площадь:</b> ${item.area}
      `
      )
      .join('\n')
  );
};

const sendItemsMessages = async (items: Item[], header: string): Promise<void> => {
  const LIMIT = 5;
  for (let i = 0; i < items.length; i += LIMIT) {
    const message = buildMessage(items.slice(i, i + LIMIT), header, `${i + 1} - ${i + LIMIT}`);
    await sendMessage(message);
  }
};

async function detectChanges(): Promise<void> {
  const currentItems = await scrapeData(SCRAPE_URL);
  const previousItems: Item[] = (await readPreviousData(DATA_FILE)) || [];

  const newItems = currentItems.filter(item => !previousItems.some(prev => prev.link === item.link));
  const removedItems = previousItems.filter(prev => !currentItems.some(item => item.link === prev.link));
  const specialItems = currentItems.filter(
    item =>
      item.description?.toLowerCase().includes('заболо') || item.title?.toLowerCase().includes('заболо')
  );
  const newSpecialItems = specialItems.filter(item => !previousItems.some(prev => prev.link === item.link));

  console.log('All Items:', currentItems.length);
  console.log('New Items:', newItems.length);
  console.log('Removed Items:', removedItems.length);
  console.log('Special Items (Заболоть):', specialItems.length);
  console.log('New Special Items (Заболоть):', newSpecialItems.length);

  const summary = `Всего: ${currentItems.length}\nНовые: ${newItems.length}\nУдаленные: ${removedItems.length}\nВсего в Заболоть: ${specialItems.length}\nНовые в Заболоть: ${newSpecialItems.length}`;
  await sendMessage(summary);

  if (newItems.length) await sendItemsMessages(newItems, 'Новые:');
  if (removedItems.length) await sendItemsMessages(removedItems, 'Удаленные:');
  if (newSpecialItems.length) await sendItemsMessages(newSpecialItems, 'Новые в Заболоть:');

  await writeData(DATA_FILE, currentItems);
  await writeData(NEW_ITEMS_FILE, newItems);
  await writeData(REMOVED_ITEMS_FILE, removedItems);
  await writeData(SPECIAL_ITEMS_FILE, specialItems);
}

async function readPreviousData(file: string): Promise<Item[] | null> {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data) as Item[];
  } catch {
    console.log('No previous data found, starting fresh.');
    return null;
  }
}

async function writeData(file: string, data: Item[]): Promise<void> {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

detectChanges().catch(async error => {
  console.error('Fatal error during scraping:', error);
  try {
    await bot.sendMessage(chatId, `⚠️ Ошибка скрапинга:\n<code>${error.message}</code>`, { parse_mode: 'HTML' });
  } catch {
    console.error('Failed to send error notification to Telegram');
  }
  process.exit(1);
});
