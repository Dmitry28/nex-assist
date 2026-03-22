import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({
      json: isProduction,
      colors: !isProduction,
      logLevels: isProduction
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
    }),
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const name = config.get<string>('app.name', 'land-scraper');

  // Security headers
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: config.get<string>('app.corsOrigin', '*'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(port);
  console.log(`[${name}] Application running on: ${await app.getUrl()}`);
}

bootstrap();
