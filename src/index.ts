const puppeteer = require('puppeteer');

const fs = require('fs').promises;

const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN || '6660285157:AAHkdPJONQJMbtL1xwB-RLZzYlPIvQV4vp0';
const chatId = process.env.TELEGRAM_CHAT_ID || '-1001995284264'; // Replace with your chat ID or group ID where you want to send messages
const bot = new TelegramBot(token, { polling: false });

const URL = 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/';
const DATA_FILE = './src/data/all_items.json';
const NEW_ITEMS_FILE = './src/data/new_items.json';
const REMOVED_ITEMS_FILE = './src/data/removed_items.json';
const SPECIAL_ITEMS_FILE = './src/data/zabolot_items.json';

async function sendMessage(message) {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Failed to send message:', error);
  }
}

async function scrapeData(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.vc_grid-item', { timeout: 10000 });

  const items = await page.evaluate(() => {
    const data = [];

    const elements = document.querySelectorAll('.vc_grid-item');
    console.log('Number of items found:', elements.length);

    elements.forEach(element => {
      const description = element.querySelector('.vc_gitem-post-data-source-post_excerpt')?.textContent?.trim();
      const title = element.querySelector('.vc_gitem-post-data-source-post_title')?.textContent?.trim();
      const link = element.querySelector('.vc-zone-link')?.href;

      data.push({ title, link, description });
    });

    return data;
  });

  for (const item of items) {
    const details = await fetchDetails(page, item.link);
    item.price = details.price;
    item.area = details.area;
  }

  await browser.close();
  return items;
}

async function fetchDetails(page, link) {
  try {
    await page.goto(link, { waitUntil: 'networkidle0' });
    await page.waitForSelector('strong');

    const details = await page.evaluate(() => {
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

const buildMessage = (items, header, range) => {
  return (
    `
        <b>${range + '. ' + header}</b>
    ` +
    items
      .map(item => {
        // add image here
        return `
        <b>${item.title}</b>
        <a href="${item.link}">Ссылка</a>
        <i>${item.description}</i>
        <b>Цена:</b> ${item.price}
        <b>Площадь:</b> ${item.area}
      `;
      })
      .join('\n')
  );
};

const sendItemsMessages = async (items, header) => {
  const LIMIT = 5;
  for (let i = 0; i < items.length; i += LIMIT) {
    const message = buildMessage(items.slice(i, i + LIMIT), header, `${i + 1} - ${i + LIMIT}`);
    await sendMessage(message);
  }
};

async function detectChanges() {
  const currentItems = await scrapeData(URL);
  const previousItems = (await readPreviousData(DATA_FILE)) || [];

  const newItems = currentItems.filter(item => !previousItems.some(prevItem => prevItem.link === item.link));
  const removedItems = previousItems.filter(prevItem => !currentItems.some(item => item.link === prevItem.link));
  const specialItems = currentItems.filter(item => item.description.toLowerCase().includes('заболо'));

  const newSpecialItems = specialItems.filter(item => !previousItems.some(prevItem => prevItem.link === item.link));

  console.log('All Items:', currentItems.length && currentItems.length + 1);
  console.log('New Items:', newItems.length && newItems.length + 1);
  console.log('Removed Items:', removedItems.length && removedItems.length + 1);
  console.log('Special Items (Заболоть):', specialItems.length && specialItems.length + 1);
  console.log('New Special Items (Заболоть):', newSpecialItems.length && newSpecialItems.length + 1);

  const message = `Всего: ${currentItems.length && currentItems.length + 1}\nНовые: ${newItems.length && newItems.length + 1}\nУдаленные: ${removedItems.length && removedItems.length + 1}\nВсего в Заболоть: ${specialItems.length && specialItems.length + 1}\nНовые в Заболоть: ${newSpecialItems.length && newSpecialItems.length + 1}`;
  await sendMessage(message);

  if (newItems.length) {
    await sendItemsMessages(newItems, 'Новые:');
  }
  if (removedItems.length) {
    await sendItemsMessages(removedItems, 'Удаленные:');
  }
  if (newSpecialItems.length) {
    await sendItemsMessages(newSpecialItems, 'Новые в Заболоть:');
  }

  await writeData(DATA_FILE, currentItems);
  await writeData(NEW_ITEMS_FILE, newItems);
  await writeData(REMOVED_ITEMS_FILE, removedItems);
  await writeData(SPECIAL_ITEMS_FILE, specialItems);
}

async function readPreviousData(file) {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log('No previous data found, starting fresh.');
    return null;
  }
}

async function writeData(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

detectChanges();
