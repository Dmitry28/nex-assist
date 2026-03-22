/**
 * Telegram notification formatting test script.
 *
 * Sends a sample run result with realistic mock data to Telegram — no scraping needed.
 * Useful for previewing message layout after formatting changes.
 *
 * Usage:
 *   npm run notify:test
 *
 * Requires TELEGRAM_TOKEN and TELEGRAM_LAND_AUCTIONS_CHAT_ID in env (or .env).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ListingNotifierService } from '../modules/land-auctions/listing-notifier.service';
import type { LandAuctionsResult, Listing } from '../modules/land-auctions/dto/listing.dto';

const MOCK_LISTINGS: Listing[] = [
  {
    title: 'Земельный участок в д. Заболоть Минского р-на',
    link: 'https://gcn.by/auction/12345',
    price: '45 000 руб.',
    area: '0.25 га',
    address: 'Минский р-н, Минский р-н, д. Заболоть',
    cadastralNumber: '500267890123',
    cadastralMapUrl: 'https://map.nca.by/#!/map?cn=500267890123',
    auctionDate: 'Аукцион состоится 15.04.2026',
    applicationDeadline: 'Заявления принимаются по 10.04.2026',
    communications: 'электроснабжение, газоснабжение, водоснабжение',
    images: [],
  },
  {
    title: 'Жилой дом в аг. Колодищи',
    link: 'https://gcn.by/auction/67890',
    price: '120 000 руб.',
    area: '0.10 га',
    address: 'Минский р-н, аг. Колодищи, ул. Лесная 5',
    cadastralNumber: '500456789012',
    cadastralMapUrl: '',
    auctionDate: 'Проведение аукциона планируется 20.04.2026',
    applicationDeadline: 'Заявления принимаются по 15.04.2026',
    communications: 'электроснабжение, водоснабжение, водоотведение, теплоснабжение',
    images: [],
  },
  {
    title: 'Незавершённое строительство в г. Дзержинск',
    link: 'https://gcn.by/auction/11111',
    price: 'Не найдено',
    area: 'Не найдено',
    address: 'Не найден',
    cadastralNumber: 'Не найден',
    cadastralMapUrl: '',
    auctionDate: 'Не указана',
    applicationDeadline: 'Не указан',
    communications: 'Не указаны',
    images: [],
  },
];

const MOCK_RESULT: LandAuctionsResult = {
  total: 42,
  newListings: MOCK_LISTINGS.slice(0, 2),
  removedListings: MOCK_LISTINGS.slice(2),
  specialListings: MOCK_LISTINGS.slice(0, 1),
  newSpecialListings: MOCK_LISTINGS.slice(0, 1),
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const notifier = app.get(ListingNotifierService);
    console.info('Sending test notifications...');
    await notifier.notifyRunResult(MOCK_RESULT);
    console.info('Done.');
  } finally {
    await app.close();
  }
}

bootstrap().catch(err => {
  console.error('notify:test failed:', err);
  process.exit(1);
});
