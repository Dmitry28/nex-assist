import { NestFactory } from '@nestjs/core';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_DEFAULTS } from './config/constants';

const logger = new Logger('Bootstrap');

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
  const port = config.get<number>('app.port', APP_DEFAULTS.PORT);
  const name = config.get<string>('app.name', APP_DEFAULTS.APP_NAME);

  // Security headers
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: config.get<string>('app.corsOrigin', '*'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
  });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // Swagger (only in non-production)
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(name)
      .setDescription('API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
  logger.log(`Application running on: ${await app.getUrl()}`);
  if (!isProduction) {
    logger.log(`Swagger docs: ${await app.getUrl()}/api/docs`);
  }
}

void bootstrap();
