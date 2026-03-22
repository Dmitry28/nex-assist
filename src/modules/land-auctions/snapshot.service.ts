import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import type { Listing } from './dto/listing.dto';

/**
 * Persists listing snapshots as JSON files.
 * Each file stores a point-in-time snapshot that is diffed on the next run
 * to detect new and removed listings.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  async read(filePath: string): Promise<Listing[]> {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data) as Listing[];
    } catch {
      this.logger.log(`No snapshot at ${filePath}, starting fresh.`);
      return [];
    }
  }

  async write(filePath: string, listings: Listing[]): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(listings, null, 2));
  }
}
