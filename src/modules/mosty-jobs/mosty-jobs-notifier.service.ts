import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { escapeHtml, TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { NOTIFICATION_HEADERS, NOTIFY_BUDGET_MS } from './constants';
import type { JobVacancy, MostyJobsResult } from './dto/job-vacancy.dto';
import {
  buildDigests,
  buildSummary,
  buildVacancyMessage,
  type MostyJobsSourceUrls,
} from './mosty-jobs-format';

/** Tracks which vacancies were successfully delivered — service uses this to gate persistence. */
export interface MostyJobsNotifyResult {
  notifiedNew: Set<string>;
}

const emptyResult = (): MostyJobsNotifyResult => ({ notifiedNew: new Set() });

@Injectable()
export class MostyJobsNotifierService {
  private readonly logger = new Logger(MostyJobsNotifierService.name);
  private readonly chatId: string;
  private readonly sourceUrls: MostyJobsSourceUrls;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('mostyJobs.chatId') ?? '';
    this.sourceUrls = {
      gsz: config.get<string>('mostyJobs.gszSearchUrl'),
      rabota: config.get<string>('mostyJobs.rabotaSearchUrl'),
      joblab: config.get<string>('mostyJobs.joblabRssUrl'),
      kufar: config.get<string>('mostyJobs.kufarSearchUrl'),
      evroopt: config.get<string>('mostyJobs.evrooptApiUrl'),
      crb: config.get<string>('mostyJobs.crbUrl'),
      fair: config.get<string>('mostyJobs.fairsUrl'),
    };
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_MOSTY_JOBS_CHAT_ID is not set — notifications disabled, only baseline seeding will be persisted',
      );
    }
  }

  async notifyRunResult(result: MostyJobsResult): Promise<MostyJobsNotifyResult> {
    if (!this.chatId) return emptyResult();

    const summaryOk = await this.telegram.sendMessage(
      this.chatId,
      buildSummary(result, this.sourceUrls),
    );
    if (!summaryOk) {
      this.logger.error('Failed to send mosty-jobs summary — skipping all notifications');
      return emptyResult();
    }
    this.logger.log('Summary sent to Telegram');

    // Seeded (baseline) vacancies are not in newVacancies — only genuinely new ones are sent.
    const notifiedNew = await this.sendVacancies(result.newVacancies);
    return { notifiedNew };
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка мониторинга вакансий (Мосты):\n<code>${escapeHtml(message)}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send mosty-jobs error notification');
  }

  private async sendVacancies(vacancies: JobVacancy[]): Promise<Set<string>> {
    const notified = new Set<string>();
    if (vacancies.length === 0) return notified;

    this.logger.log(`Sending ${vacancies.length} new vacancy(ies)`);

    // Send until the list runs out or the budget does. Sends are paced 3.1s apart inside
    // TelegramService, so the budget is a duration rather than a count of messages — and what
    // does not fit stays unpersisted and goes out next run.
    const deadline = Date.now() + NOTIFY_BUDGET_MS;
    for (const [i, vacancy] of vacancies.entries()) {
      if (Date.now() >= deadline) {
        // Whatever is left goes out as one digest rather than waiting for tomorrow: the point
        // of a daily monitor is that today's vacancies are visible today.
        this.logger.warn(`Send budget spent after ${i}/${vacancies.length} — digesting the rest`);
        await this.sendDigest(vacancies.slice(i), i + 1, vacancies.length, notified);
        break;
      }

      const message = buildVacancyMessage({
        vacancy,
        header: NOTIFICATION_HEADERS.new,
        index: i + 1,
        total: vacancies.length,
      });
      const ok = await this.telegram.sendMessage(
        this.chatId,
        truncateText(message, TELEGRAM_MESSAGE_LIMIT),
      );
      if (ok) notified.add(vacancy.url);
      else this.logger.warn(`Failed to send vacancy url=${vacancy.url}`);
    }

    return notified;
  }
  /**
   * Sends the remainder as compact list messages, chunked to Telegram's per-message limit.
   * Delivered entries count as notified — they have been seen, and re-sending them as cards
   * next run would be a duplicate, not a courtesy.
   */
  private async sendDigest(
    rest: JobVacancy[],
    from: number,
    total: number,
    notified: Set<string>,
  ): Promise<void> {
    for (const chunk of buildDigests(rest, from, total)) {
      const ok = await this.telegram.sendMessage(this.chatId, chunk.text);
      if (ok) for (const v of chunk.vacancies) notified.add(v.url);
      else this.logger.warn(`Failed to send digest of ${chunk.vacancies.length} vacancy(ies)`);
    }
  }
}
