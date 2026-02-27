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
    const data: { title: string | undefined; link: string | undefined }[] = [];
    const elements = document.querySelectorAll('.vc_grid-item');
    console.log('Найдено объявлений:', elements.length);
    elements.forEach(element => {
      const title = element.querySelector('.vc_gitem-post-data-source-post_title')?.textContent?.trim();
      const link = (element.querySelector('.vc-zone-link') as HTMLAnchorElement | null)?.href;
      data.push({ title, link });
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

const getObjectEmoji = (title: string | undefined): string => {
  if (!title) return '🏡';
  const t = title.toLowerCase();
  if (t.includes('не завершён') || t.includes('незавершён')) return '🏗';
  if (t.includes('жилой дом') || t.includes('дом по')) return '🏠';
  return '🏡';
};

const formatAuctionDate = (val: string): string => {
  if (val.startsWith('Аукцион состоится ')) return val.replace('Аукцион состоится ', '');
  if (val.startsWith('Проведение аукциона планируется ')) return val.replace('Проведение аукциона планируется ', '');
  if (val.length > 50) return 'уточняется';
  return val;
};

const formatDeadline = (val: string): string =>
  val.replace('Заявления принимаются по ', '');

const buildItemCaption = (item: Item, header: string, index: number, total: number): string => {
  const emoji = getObjectEmoji(item.title);
  const lines: string[] = [
    `<b>${header} · ${index} из ${total}</b>`,
    '',
    `${emoji} <b>${item.title}</b>`,
  ];

  if (!isEmpty(item.address)) lines.push(`📍 ${item.address}`);

  const pricePart = !isEmpty(item.price) ? `💰 ${item.price}` : '';
  const areaPart  = !isEmpty(item.area)  ? `📐 ${item.area}`  : '';
  if (pricePart || areaPart) lines.push(['', pricePart, areaPart].filter(Boolean).join('  ·  ').trim());

  if (!isEmpty(item.auctionDate))         lines.push(`🗓 Аукцион: ${formatAuctionDate(item.auctionDate!)}`);
  if (!isEmpty(item.applicationDeadline)) lines.push(`📅 Заявки до: ${formatDeadline(item.applicationDeadline!)}`);
  if (!isEmpty(item.communications))      lines.push(`⚡ ${item.communications}`);

  const linkParts: string[] = [`<a href="${item.link}">🔗 Подробнее</a>`];
  if (item.cadastralMapUrl) linkParts.push(`<a href="${item.cadastralMapUrl}">📌 Карта</a>`);
  lines.push('');
  lines.push(linkParts.join('  ·  '));

  return lines.join('\n');
};

const TELEGRAM_CAPTION_LIMIT = 1024;

const truncateCaption = (text: string): string => {
  if (text.length <= TELEGRAM_CAPTION_LIMIT) return text;
  return text.slice(0, TELEGRAM_CAPTION_LIMIT - 3) + '...';
};

const MEDIA_GROUP_LIMIT = 10;

const sendWithRetry = async (fn: () => Promise<void>, retries = 3): Promise<boolean> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fn();
      return true;
    } catch (error: any) {
      const retryAfter = error?.response?.body?.parameters?.retry_after;
      if (retryAfter && attempt < retries - 1) {
        console.log(`Telegram rate limit, ждём ${retryAfter} сек...`);
        await sleep(retryAfter * 1000 + 500);
      } else {
        console.error('Ошибка отправки объекта:', error?.response?.body ?? error);
        return false;
      }
    }
  }
  return false;
};

const sendItemMessage = async (item: Item, header: string, index: number, total: number): Promise<boolean> => {
  const caption = truncateCaption(buildItemCaption(item, header, index, total));
  const photos = (item.images ?? []).slice(0, MEDIA_GROUP_LIMIT);

  return sendWithRetry(async () => {
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
  });
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const TELEGRAM_SEND_DELAY_MS = 1000;

const sendItemsMessages = async (items: Item[], header: string): Promise<void> => {
  const failed: Item[] = [];

  for (let i = 0; i < items.length; i++) {
    const ok = await sendItemMessage(items[i], header, i + 1, items.length);
    if (!ok) failed.push(items[i]);
    if (i < items.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
  }

  if (failed.length > 0) {
    const list = failed.map(i => `• ${i.title}`).join('\n');
    await sendMessage(`⚠️ Не удалось отправить ${failed.length} объект(а):\n${list}`);
  }
};

async function detectChanges(): Promise<void> {
  const currentItems = await scrapeData(SCRAPE_URL);
  const previousItems: Item[] = (await readPreviousData(DATA_FILE)) || [];

  const newItems = currentItems.filter(item => !previousItems.some(prev => prev.link === item.link));
  const removedItems = previousItems.filter(prev => !currentItems.some(item => item.link === prev.link));
  const specialItems = currentItems.filter(
    item => item.title?.toLowerCase().includes('заболо')
  );
  const newSpecialItems = specialItems.filter(item => !previousItems.some(prev => prev.link === item.link));

  console.log('All Items:', currentItems.length);
  console.log('New Items:', newItems.length);
  console.log('Removed Items:', removedItems.length);
  console.log('Special Items (Заболоть):', specialItems.length);
  console.log('New Special Items (Заболоть):', newSpecialItems.length);

  const summary = [
    `<b>📊 Сводка на ${new Date().toLocaleDateString('ru-RU')}</b>`,
    `📋 Всего объявлений: <b>${currentItems.length}</b>`,
    newItems.length      ? `🆕 Новые: <b>${newItems.length}</b>`           : `🆕 Новые: 0`,
    removedItems.length  ? `🗑 Удалённые: <b>${removedItems.length}</b>`   : `🗑 Удалённые: 0`,
    `🌿 Всего в Заболоть: <b>${specialItems.length}</b>`,
    newSpecialItems.length ? `✅ Новые в Заболоть: <b>${newSpecialItems.length}</b>` : `✅ Новые в Заболоть: 0`,
  ].join('\n');
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
