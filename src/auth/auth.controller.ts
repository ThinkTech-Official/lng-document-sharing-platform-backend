import { Body, Controller, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { Request, Response } from 'express';

const COOKIE_NAME = 'lng_token';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours in ms

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private meta(req: Request) {
    return req.requestMeta ?? {};
  }

  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, user } = await this.authService.login(
      dto,
      this.meta(req),
    );

    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, access_token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: COOKIE_MAX_AGE,
    });

    return { user };
  }

  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, this.meta(req));
  }

  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, this.meta(req));
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.authService.changePassword(actor, dto, {
      ip_address: req.requestMeta?.ip_address,
      user_agent: req.requestMeta?.user_agent,
    });
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @CurrentUser() actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
    });

    return this.authService.logout(actor, this.meta(req));
  }
}
