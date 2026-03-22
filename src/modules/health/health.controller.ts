import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

// NOTE: Tune these thresholds based on observed production memory usage.
const HEAP_LIMIT_BYTES = 300 * 1024 * 1024; // 300 MB
const RSS_LIMIT_BYTES = 512 * 1024 * 1024; // 512 MB

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      () => this.memory.checkRSS('memory_rss', RSS_LIMIT_BYTES),
    ]);
  }
}
