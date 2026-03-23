import { Global, Module } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';

/**
 * Global module for shared infrastructure services.
 * Import once in AppModule — all feature modules can inject these providers without re-importing.
 */
@Global()
@Module({
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class CommonModule {}
