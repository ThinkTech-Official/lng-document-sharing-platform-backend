import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as crypto from 'crypto';
import { ActionType } from '../logging/enums/action-type.enum';
import { LoggingService } from '../logging/logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';

interface RequestMeta {
  ip_address?: string;
  user_agent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private passwordService: PasswordService,
    private logging: LoggingService,
  ) {}

  async login(
    dto: LoginDto,
    meta: RequestMeta = {},
  ): Promise<{
    access_token: string;
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      is_active: boolean;
      force_password_reset: boolean;
    };
  }> {
    const GENERIC = 'Invalid email or password';

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deleted_at: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        is_active: true,
        password: true,
        force_password_reset: true,
      },
    });

    if (!user || !user.password) throw new UnauthorizedException(GENERIC);

    const valid = await this.passwordService.compare(
      dto.password,
      user.password,
    );
    if (!valid) throw new UnauthorizedException(GENERIC);

    if (!user.is_active) throw new UnauthorizedException(GENERIC);

    this.logging.log({
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name,
      actor_email: user.email,
      action_type: ActionType.AUTH_LOGIN_SUCCESS,
      target_type: 'User',
      target_id: user.id,
      ...meta,
    });

    const payload = {
      sub: user.id,
      role: user.role,
      force_password_reset: user.force_password_reset,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_active: user.is_active,
        force_password_reset: user.force_password_reset,
      },
    };
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    meta: RequestMeta = {},
  ): Promise<{ message: string }> {
    const SUCCESS = {
      message: 'If that email is registered, a reset link has been sent.',
    };

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deleted_at: null },
      select: { id: true, email: true, name: true, role: true, is_active: true },
    });

    if (!user || !user.is_active) return SUCCESS;

    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: { token, user_id: user.id, expires_at },
    });

    await this.mailService.sendPasswordResetLink(user.email, token);

    this.logging.log({
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name,
      actor_email: user.email,
      action_type: ActionType.AUTH_PASSWORD_RESET_REQUESTED,
      target_type: 'User',
      target_id: user.id,
      ...meta,
    });

    return SUCCESS;
  }

  async resetPassword(
    dto: ResetPasswordDto,
    meta: RequestMeta = {},
  ): Promise<{ message: string }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
      include: { user: { select: { id: true, role: true, name: true, email: true } } },
    });

    if (!record || record.is_used || record.expires_at < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (dto.new_password !== dto.confirm_password) {
      throw new BadRequestException('Passwords do not match');
    }

    const strengthError = this.passwordService.validateStrength(
      dto.new_password,
    );
    if (strengthError) throw new BadRequestException(strengthError);

    const hashed = await this.passwordService.hash(dto.new_password);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { is_used: true },
      }),
      this.prisma.user.update({
        where: { id: record.user.id },
        data: { password: hashed, force_password_reset: false },
      }),
    ]);

    this.logging.log({
      actor_id: record.user.id,
      actor_role: record.user.role,
      actor_name: record.user.name,
      actor_email: record.user.email,
      action_type: ActionType.AUTH_PASSWORD_RESET_COMPLETED,
      target_type: 'User',
      target_id: record.user.id,
      ...meta,
    });

    return { message: 'Password reset successfully.' };
  }

  async changePassword(
    actor: { id: string; role: Role; name?: string; email?: string },
    dto: ChangePasswordDto,
    meta: RequestMeta = {},
  ): Promise<{ message: string }> {
    if (dto.new_password !== dto.confirm_password) {
      throw new BadRequestException('Passwords do not match');
    }

    const strengthError = this.passwordService.validateStrength(dto.new_password);
    if (strengthError) throw new BadRequestException(strengthError);

    const hashed = await this.passwordService.hash(dto.new_password);

    await this.prisma.user.update({
      where: { id: actor.id },
      data: { password: hashed, force_password_reset: false },
    });

    this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.AUTH_PASSWORD_RESET_COMPLETED,
      target_type: 'User',
      target_id: actor.id,
      ...meta,
    });

    return { message: 'Password changed successfully.' };
  }

  async logout(
    actor: { id: string; role: Role; name?: string; email?: string },
    meta: RequestMeta = {},
  ): Promise<{ message: string }> {
    this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.AUTH_LOGOUT,
      target_type: 'User',
      target_id: actor.id,
      ...meta,
    });
    return { message: 'Logged out successfully.' };
  }
}
