import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import type { Item } from './dto/item.dto';

/**
 * Handles JSON file persistence for scraped items.
 * Each data file stores a snapshot that is compared on the next scrape run.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  async read(filePath: string): Promise<Item[]> {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data) as Item[];
    } catch {
      this.logger.log(`No existing data at ${filePath}, starting fresh.`);
      return [];
    }
  }

  async write(filePath: string, items: Item[]): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(items, null, 2));
  }
}
