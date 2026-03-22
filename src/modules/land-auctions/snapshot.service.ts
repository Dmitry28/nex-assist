import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
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
      const parsed: unknown = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        this.logger.warn(`Snapshot at ${filePath} is not an array, resetting.`);
        return [];
      }
      const isListing = (item: unknown): item is Listing =>
        typeof item === 'object' && item !== null && 'link' in item;
      if (!parsed.every(isListing)) {
        this.logger.warn(`Snapshot at ${filePath} has unexpected shape, resetting.`);
        return [];
      }
      return parsed;
    } catch (error: unknown) {
      const isNotFound = (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (isNotFound) {
        this.logger.log(`No snapshot at ${filePath}, starting fresh.`);
      } else {
        this.logger.warn(`Failed to read snapshot at ${filePath}, starting fresh.`, error);
      }
      return [];
    }
  }

  async write(filePath: string, listings: Listing[]): Promise<void> {
    // Ensure the directory exists — important on first run and in Docker
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(listings, null, 2));
  }
}
