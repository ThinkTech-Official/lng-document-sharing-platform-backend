import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class RequestMetaInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();

    // Respect x-forwarded-for when behind a proxy or load balancer
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? String(forwarded).split(',')[0].trim()
      : (req.ip ?? req.connection?.remoteAddress ?? '');

    req.requestMeta = {
      ip_address: ip,
      user_agent: req.headers['user-agent'] ?? '',
    };

    return next.handle();
  }
}
