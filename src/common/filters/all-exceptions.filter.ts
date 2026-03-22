import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter — the single catch-all error handler for the entire app.
 *
 * Behaviour:
 * - HttpException (4xx/5xx thrown by NestJS or manually) → logs WARN, preserves original
 *   status code and message. Handles class-validator arrays (ValidationPipe errors).
 * - Any other unhandled error (runtime exceptions, third-party library throws, etc.)
 *   → logs ERROR with full stack trace, returns 500 Internal Server Error.
 *
 * NOTE: Registered globally via APP_FILTER in AppModule. NestJS routes all unhandled
 * exceptions here after route handlers and interceptors have run.
 *
 * Error response shape: { statusCode, timestamp, path, message }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // NOTE: exceptionResponse can be a string or an object (e.g. { message: string[] }
      // from ValidationPipe). We extract the message field if it's an object.
      const isObject = (v: unknown): v is Record<string, unknown> =>
        typeof v === 'object' && v !== null;
      const message = isObject(exceptionResponse)
        ? exceptionResponse['message']
        : exceptionResponse;

      this.logger.warn(`${request.method} ${request.url} → ${status}`);
      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message,
      });
    } else {
      this.logger.error(
        `${request.method} ${request.url} → 500`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'Internal server error',
      });
    }
  }
}
