import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import appConfig from './config/app.config';
import { validationSchema } from './config/validation.schema';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HealthModule } from './modules/health/health.module';
import { BidCarsModule } from './modules/bid-cars/bid-cars.module';
import { KufarModule } from './modules/kufar/kufar.module';
import { LandAuctionsModule } from './modules/land-auctions/land-auctions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      load: [appConfig],
      validationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),

    // Rate limiting — configurable via THROTTLE_TTL / THROTTLE_LIMIT env vars
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('app.throttleTtl'),
          limit: config.getOrThrow<number>('app.throttleLimit'),
        },
      ],
    }),

    // Cron job scheduler
    ScheduleModule.forRoot(),

    // Shared infrastructure (global: SnapshotService available everywhere)
    CommonModule,

    // Feature modules
    HealthModule,
    LandAuctionsModule,
    BidCarsModule,
    KufarModule,
  ],
  providers: [
    // Global validation
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    },
    // Global rate limiting
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global exception filter
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global response envelope
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
