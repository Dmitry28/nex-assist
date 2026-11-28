import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from '../telegram.service';

jest.mock('node-telegram-bot-api');
jest.mock('../../../common/utils/sleep', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));

const make429 = (retryAfter: number) => ({
  response: { body: { parameters: { retry_after: retryAfter } } },
});

function makeBotMock() {
  return {
    sendMessage: jest.fn().mockResolvedValue({}),
    sendPhoto: jest.fn().mockResolvedValue({}),
    sendMediaGroup: jest.fn().mockResolvedValue([{}]),
  };
}

async function buildService(): Promise<TelegramService> {
  jest.spyOn(TelegramService.prototype, 'onModuleInit').mockImplementation(() => {});
  const module = await Test.createTestingModule({
    providers: [TelegramService, { provide: ConfigService, useValue: { get: jest.fn() } }],
  }).compile();
  return module.get(TelegramService);
}

// Helper: inject a bot mock directly into the service (bypasses onModuleInit)
function injectBot(service: TelegramService, bot: ReturnType<typeof makeBotMock>): void {
  (service as unknown as Record<string, unknown>).bot = bot;
}

describe('TelegramService — dry-run (no bot set)', () => {
  let service: TelegramService;

  beforeEach(async () => {
    service = await buildService();
    // bot remains null → dry-run mode
  });

  it('sendMessage returns true without calling bot', async () => {
    expect(await service.sendMessage('123', 'hello')).toBe(true);
    expect(TelegramBot).not.toHaveBeenCalled();
  });

  it('sendPhoto returns true without calling bot', async () => {
    expect(await service.sendPhoto('123', 'http://img', 'caption')).toBe(true);
  });

  it('sendMediaGroup returns true without calling bot', async () => {
    expect(await service.sendMediaGroup('123', [])).toBe(true);
  });
});

describe('TelegramService — with bot', () => {
  let service: TelegramService;
  let bot: ReturnType<typeof makeBotMock>;

  beforeEach(async () => {
    service = await buildService();
    bot = makeBotMock();
    injectBot(service, bot);
  });

  it('sendMessage returns true on success', async () => {
    expect(await service.sendMessage('123', 'hello')).toBe(true);
    expect(bot.sendMessage).toHaveBeenCalledWith('123', 'hello', { parse_mode: 'HTML' });
  });

  it('sendPhoto returns true on success', async () => {
    expect(await service.sendPhoto('123', 'http://img', 'caption')).toBe(true);
    expect(bot.sendPhoto).toHaveBeenCalledWith(
      '123',
      'http://img',
      { caption: 'caption', parse_mode: 'HTML' },
      undefined,
    );
  });

  // idriver.by photos are uploaded as bytes — Telegram's own fetcher cannot reach that host —
  // and an upload needs the file type declared, or Telegram rejects it.
  it('sendPhoto uploads a buffer with an explicit content type', async () => {
    const photo = Buffer.from('webp bytes');
    const upload = { filename: 'photo.webp', contentType: 'image/webp' };
    expect(await service.sendPhoto('123', photo, 'caption', upload)).toBe(true);
    expect(bot.sendPhoto).toHaveBeenCalledWith(
      '123',
      photo,
      { caption: 'caption', parse_mode: 'HTML' },
      upload,
    );
  });

  it('sendMediaGroup returns true on success', async () => {
    const media = [{ type: 'photo' as const, media: 'http://img' }];
    expect(await service.sendMediaGroup('123', media)).toBe(true);
    expect(bot.sendMediaGroup).toHaveBeenCalledWith('123', media);
  });

  describe('sendMediaGroup when Telegram rejects one photo', () => {
    const rejected = (position: number): Error =>
      new Error(
        `ETELEGRAM: 400 Bad Request: failed to send message #${position} with the error message "WEBPAGE_CURL_FAILED"`,
      );
    const photo = (n: number, caption?: string) => ({
      type: 'photo' as const,
      media: `http://img/${n}`,
      ...(caption ? { caption, parse_mode: 'HTML' as const } : {}),
    });

    it('resends the album without the rejected photo', async () => {
      bot.sendMediaGroup.mockRejectedValueOnce(rejected(2)).mockResolvedValueOnce([{}]);
      const media = [photo(1, 'cap'), photo(2), photo(3)];

      expect(await service.sendMediaGroup('123', media)).toBe(true);

      expect(bot.sendMediaGroup).toHaveBeenLastCalledWith('123', [photo(1, 'cap'), photo(3)]);
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it('moves the caption when the rejected photo carried it', async () => {
      bot.sendMediaGroup.mockRejectedValueOnce(rejected(1)).mockResolvedValueOnce([{}]);

      await service.sendMediaGroup('123', [photo(1, 'cap'), photo(2), photo(3)]);

      expect(bot.sendMediaGroup).toHaveBeenLastCalledWith('123', [photo(2, 'cap'), photo(3)]);
    });

    it('sends the lone survivor as a plain photo', async () => {
      bot.sendMediaGroup.mockRejectedValueOnce(rejected(2));

      expect(await service.sendMediaGroup('123', [photo(1, 'cap'), photo(2)])).toBe(true);

      expect(bot.sendPhoto).toHaveBeenCalledWith(
        '123',
        'http://img/1',
        { caption: 'cap', parse_mode: 'HTML' },
        undefined,
      );
    });

    it('falls back to text when the failure does not name a photo', async () => {
      bot.sendMediaGroup.mockRejectedValue(new Error('network error'));

      expect(await service.sendMediaGroup('123', [photo(1, 'cap'), photo(2)])).toBe(true);

      expect(bot.sendMediaGroup).toHaveBeenCalledTimes(1);
      expect(bot.sendMessage).toHaveBeenCalledWith('123', 'cap', { parse_mode: 'HTML' });
    });
  });

  it('returns false immediately on non-429 error (no retry)', async () => {
    bot.sendMessage.mockRejectedValue(new Error('network error'));
    expect(await service.sendMessage('123', 'hello')).toBe(false);
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds', async () => {
    bot.sendMessage.mockRejectedValueOnce(make429(1)).mockResolvedValueOnce({});
    expect(await service.sendMessage('123', 'hello')).toBe(true);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns false after exhausting all retry attempts on repeated 429', async () => {
    bot.sendMessage.mockRejectedValue(make429(1));
    expect(await service.sendMessage('123', 'hello')).toBe(false);
    expect(bot.sendMessage).toHaveBeenCalledTimes(5); // MAX_SEND_ATTEMPTS
  });
});
