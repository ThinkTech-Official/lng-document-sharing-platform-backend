import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
    if (err || !user) throw err ?? new UnauthorizedException();

    if (user.force_password_reset) {
      const req = context.switchToHttp().getRequest<{ url: string }>();
      if (!req.url.startsWith('/auth/change-password')) {
        throw new ForbiddenException(
          'Password reset required. Please reset your password to continue.',
        );
      }
    }

    return user;
  }
}
