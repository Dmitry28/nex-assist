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
  address?: string;
  cadastralNumber?: string;
  cadastralMapUrl?: string;
  auctionDate?: string;
  applicationDeadline?: string;
  communications?: string;
  images?: string[];
}

interface Details {
  price: string;
  area: string;
  address: string;
  cadastralNumber: string;
  cadastralMapUrl: string;
  auctionDate: string;
  applicationDeadline: string;
  communications: string;
  images: string[];
}

async function sendMessage(message: string): Promise<void> {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
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
        item.address = details.address;
        item.cadastralNumber = details.cadastralNumber;
        item.cadastralMapUrl = details.cadastralMapUrl;
        item.auctionDate = details.auctionDate;
        item.applicationDeadline = details.applicationDeadline;
        item.communications = details.communications;
        item.images = details.images;
      }
      await page.close();
    })
  );

  await browser.close();
  return items;
}

async function fetchDetails(page: Page, link: string | undefined): Promise<Details> {
  const empty: Details = {
    price: 'Не найдено',
    area: 'Не найдено',
    address: 'Не найдено',
    cadastralNumber: 'Не найдено',
    cadastralMapUrl: '',
    auctionDate: 'Не указана',
    applicationDeadline: 'Не указан',
    communications: 'Не указаны',
    images: [],
  };

  if (!link) {
    console.warn('Пропускаем объект без ссылки');
    return empty;
  }

  try {
    await page.goto(link, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.prop, strong', { timeout: 10000 });

    const details: Details = await page.evaluate(() => {
      const text = document.body.innerText;

      const match = (pattern: RegExp) => {
        const m = text.match(pattern);
        return m ? m[1].trim() : '';
      };

      // Цена
      const price = match(/Начальная цена:\s*([\d\s,]+)\s*руб\./);

      // Площадь — сначала пробуем полное название, потом короткое
      const area =
        match(/Площадь земельного участка:\s*([\d,\.]+)\s*га/) ||
        match(/Площадь:\s*([\d,\.]+)\s*га/);

      // Адрес — либо отдельная строка "Адрес: ...", либо вшит в заголовок "по адресу: ..."
      const address =
        match(/Адрес:\s*(.+)/) ||
        match(/по адресу:\s*(г\.[^\n]+)/);

      // Кадастровый номер
      const cadastralNumber = match(/Кадастровый номер:\s*(\d+)/);

      // Ссылка на публичную кадастровую карту
      const cadastralMapEl = document.querySelector('.prop a[href*="map.nca.by"]') as HTMLAnchorElement | null;
      const cadastralMapUrl = cadastralMapEl?.href ?? '';

      // Дата аукциона — точная или плановая
      const auctionLinkEl = Array.from(document.querySelectorAll('.prop a')).find(a =>
        a.textContent?.includes('Аукцион состоится')
      );
      const auctionEmEl = document.querySelector('.prop em');
      const auctionDate =
        auctionLinkEl?.textContent?.trim() ??
        auctionEmEl?.textContent?.trim() ??
        'Не указана';

      // Дедлайн подачи заявок
      const deadlineLinkEl = Array.from(document.querySelectorAll('.prop a')).find(a =>
        a.textContent?.includes('Заявления принимаются')
      );
      const applicationDeadline = deadlineLinkEl?.textContent?.trim() ?? 'Не указан';

      // Коммуникации — собираем список из известных маркеров
      const commsSource = text.match(/Имеется возможность подключения к сетям\s+(.+?)(?:\n|Победитель)/s)?.[1] ?? '';
      const commsMap: [RegExp, string][] = [
        [/электроснабжени/i, 'электроснабжение'],
        [/газоснабжени/i, 'газоснабжение'],
        [/водоснабжени/i, 'водоснабжение'],
        [/водоотведени/i, 'водоотведение'],
        [/теплоснабжени/i, 'теплоснабжение'],
      ];
      const foundComms = commsMap.filter(([re]) => re.test(commsSource)).map(([, name]) => name);
      const communications = foundComms.length > 0 ? foundComms.join(', ') : 'Не указаны';

      // Изображения — сначала из галереи, потом из тела описания
      // Исключаем кнопку кадастровой карты (маленькие изображения height < 100)
      const galleryEls = document.querySelectorAll('#image-gallery img');
      const propEls = document.querySelectorAll('.prop img');
      const allImgEls = galleryEls.length > 0 ? galleryEls : propEls;
      const images = Array.from(allImgEls)
        .filter(img => (img as HTMLImageElement).naturalHeight > 100 || (img as HTMLImageElement).height > 100 || !(img as HTMLImageElement).height)
        .map(img => (img as HTMLImageElement).src)
        .filter(src => !!src && !src.includes('knopka'));

      return {
        price: price ? price + ' руб.' : 'Не найдено',
        area: area ? area + ' га' : 'Не найдено',
        address: address || 'Не найден',
        cadastralNumber: cadastralNumber || 'Не найден',
        cadastralMapUrl,
        auctionDate,
        applicationDeadline,
        communications,
        images,
      };
    });

    return details;
  } catch (error) {
    console.error('Ошибка при загрузке деталей:', error);
    return empty;
  }
}

const EMPTY_VALUES = new Set(['Не найдено', 'Не найден', 'Не указана', 'Не указан', 'Не указаны', 'N/A']);
const isEmpty = (val: string | undefined): boolean => !val || EMPTY_VALUES.has(val);

const buildItemCaption = (item: Item, header: string, index: number): string => {
  const lines: string[] = [
    `<b>${index}. ${header}</b>`,
    `<b>${item.title}</b>`,
    `<a href="${item.link}">Ссылка</a>`,
  ];

  if (!isEmpty(item.address))             lines.push(`📍 ${item.address}`);
  if (!isEmpty(item.price))               lines.push(`<b>Цена:</b> ${item.price}`);
  if (!isEmpty(item.area))                lines.push(`<b>Площадь:</b> ${item.area}`);
  if (!isEmpty(item.auctionDate))         lines.push(`<b>Аукцион:</b> ${item.auctionDate}`);
  if (!isEmpty(item.applicationDeadline)) lines.push(`<b>Приём заявок до:</b> ${item.applicationDeadline}`);
  if (item.cadastralMapUrl)               lines.push(`<a href="${item.cadastralMapUrl}">📌 Кадастровая карта</a>`);

  return lines.join('\n');
};

const TELEGRAM_CAPTION_LIMIT = 1024;

const truncateCaption = (text: string): string => {
  if (text.length <= TELEGRAM_CAPTION_LIMIT) return text;
  return text.slice(0, TELEGRAM_CAPTION_LIMIT - 3) + '...';
};

const MEDIA_GROUP_LIMIT = 10;

const sendItemMessage = async (item: Item, header: string, index: number): Promise<void> => {
  const caption = truncateCaption(buildItemCaption(item, header, index));
  const photos = (item.images ?? []).slice(0, MEDIA_GROUP_LIMIT);

  try {
    if (photos.length > 1) {
      const media: TelegramBot.InputMediaPhoto[] = photos.map((url, i) => ({
        type: 'photo',
        media: url,
        ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}),
      }));
      await bot.sendMediaGroup(chatId, media);
    } else if (photos.length === 1) {
      await bot.sendPhoto(chatId, photos[0], { caption, parse_mode: 'HTML' });
    } else {
      await bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
    }
  } catch (error) {
    console.error('Ошибка отправки объекта:', error);
  }
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const TELEGRAM_SEND_DELAY_MS = 300;

const sendItemsMessages = async (items: Item[], header: string): Promise<void> => {
  for (let i = 0; i < items.length; i++) {
    await sendItemMessage(items[i], header, i + 1);
    if (i < items.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
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
    console.log('Предыдущие данные не найдены, начинаем с нуля.');
    return null;
  }
}

async function writeData(file: string, data: Item[]): Promise<void> {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

detectChanges().catch(async error => {
  console.error('Критическая ошибка скрапинга:', error);
  try {
    await bot.sendMessage(chatId, `⚠️ Ошибка скрапинга:\n<code>${error.message}</code>`, { parse_mode: 'HTML' });
  } catch {
    console.error('Не удалось отправить уведомление об ошибке в Telegram');
  }
  process.exit(1);
});
