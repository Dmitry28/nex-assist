import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Simple API key guard — checks the X-Api-Key header against the API_KEY env var.
 * If API_KEY is not set, all requests are allowed (dev / dry-run mode).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const apiKey = this.config.get<string>('app.apiKey');
    if (!apiKey) return true; // No key configured — allow all (dev mode)

    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers['x-api-key'] !== apiKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
