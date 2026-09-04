import { Global, Module } from '@nestjs/common';
import { QuietSummaryService } from './quiet-summary.service';
import { SourceHealthService } from './source-health.service';
import { SnapshotService } from './snapshot.service';

/**
 * Global module for shared infrastructure services.
 * Registered once in AppModule with @Global() — feature modules do NOT need to import it;
 * its exports are available for injection everywhere automatically.
 */
@Global()
@Module({
  providers: [SnapshotService, SourceHealthService, QuietSummaryService],
  exports: [SnapshotService, SourceHealthService, QuietSummaryService],
})
export class CommonModule {}
