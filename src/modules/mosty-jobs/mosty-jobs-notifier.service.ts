import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { escapeHtml, TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { MAX_NOTIFICATIONS_PER_RUN, NOTIFICATION_HEADERS } from './constants';
import type { JobVacancy, MostyJobsResult } from './dto/job-vacancy.dto';
import { buildSummary, buildVacancyMessage } from './mosty-jobs-format';

/** Tracks which vacancies were successfully delivered — service uses this to gate persistence. */
export interface MostyJobsNotifyResult {
  notifiedNew: Set<string>;
}

const emptyResult = (): MostyJobsNotifyResult => ({ notifiedNew: new Set() });

@Injectable()
export class MostyJobsNotifierService {
  private readonly logger = new Logger(MostyJobsNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('mostyJobs.chatId') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_MOSTY_JOBS_CHAT_ID is not set — notifications disabled, only baseline seeding will be persisted',
      );
    }
  }

  async notifyRunResult(result: MostyJobsResult): Promise<MostyJobsNotifyResult> {
    if (!this.chatId) return emptyResult();

    const summaryOk = await this.telegram.sendMessage(this.chatId, buildSummary(result));
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

    // Flood guard: undelivered vacancies stay unpersisted and drip out next runs.
    const batch = vacancies.slice(0, MAX_NOTIFICATIONS_PER_RUN);
    if (batch.length < vacancies.length) {
      this.logger.warn(`Capping notifications: ${batch.length}/${vacancies.length} sent this run`);
    }
    this.logger.log(`Sending ${batch.length} new vacancy(ies)`);

    for (const [i, vacancy] of batch.entries()) {
      const message = buildVacancyMessage({
        vacancy,
        header: NOTIFICATION_HEADERS.new,
        index: i + 1,
        total: batch.length,
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
}
