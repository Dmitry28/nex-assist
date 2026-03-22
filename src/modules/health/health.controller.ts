import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

// NOTE: Tune these thresholds based on observed production memory usage.
const HEAP_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB
const RSS_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

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
