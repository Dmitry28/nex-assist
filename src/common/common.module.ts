import { Global, Module } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';

/**
 * Global module for shared infrastructure services.
 * Registered once in AppModule with @Global() — feature modules do NOT need to import it;
 * its exports are available for injection everywhere automatically.
 */
@Global()
@Module({
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class CommonModule {}
