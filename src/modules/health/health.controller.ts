import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

// NOTE: Tune these thresholds based on observed production memory usage.
const HEAP_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB
const RSS_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      () => this.memory.checkRSS('memory_rss', RSS_LIMIT_BYTES),
    ]);
  }
}
