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
  (service as unknown as Record<string, unknown>).bot = bot as unknown as TelegramBot;
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
    expect(bot.sendPhoto).toHaveBeenCalledWith('123', 'http://img', {
      caption: 'caption',
      parse_mode: 'HTML',
    });
  });

  it('sendMediaGroup returns true on success', async () => {
    const media = [{ type: 'photo' as const, media: 'http://img' }];
    expect(await service.sendMediaGroup('123', media)).toBe(true);
    expect(bot.sendMediaGroup).toHaveBeenCalledWith('123', media);
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
