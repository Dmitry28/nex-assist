import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful response in a standard envelope so all API consumers
 * get a consistent shape regardless of what the route handler returns.
 *
 * Success response shape: { data: T, timestamp: string (ISO 8601) }
 *
 * NOTE: Only applies to non-error responses. Errors bypass interceptors and are
 * handled by AllExceptionsFilter, which uses a different shape:
 * { statusCode, timestamp, path, message }
 */
export interface ApiResponse<T> {
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data: T) => ({
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
