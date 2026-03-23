import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';

const isErrnoException = (e: unknown): e is NodeJS.ErrnoException =>
  e instanceof Error && 'code' in e;

/**
 * Generic snapshot persistence — reads/writes JSON arrays to disk.
 * Used by feature modules to diff listings between runs.
 * Each module passes its own type guard to validate the shape on read.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  async read<T>(filePath: string, isValid: (item: unknown) => item is T): Promise<T[]> {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        this.logger.warn(`Snapshot at ${filePath} is not an array, resetting.`);
        return [];
      }
      if (!parsed.every(isValid)) {
        this.logger.warn(`Snapshot at ${filePath} has unexpected shape, resetting.`);
        return [];
      }
      return parsed;
    } catch (error: unknown) {
      const isNotFound = isErrnoException(error) && error.code === 'ENOENT';
      if (isNotFound) {
        this.logger.log(`No snapshot at ${filePath}, starting fresh.`);
      } else {
        this.logger.warn(`Failed to read snapshot at ${filePath}, starting fresh.`, error);
      }
      return [];
    }
  }

  async write<T>(filePath: string, items: T[]): Promise<void> {
    // Ensure the directory exists — important on first run and in Docker
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(items, null, 2));
  }
}
