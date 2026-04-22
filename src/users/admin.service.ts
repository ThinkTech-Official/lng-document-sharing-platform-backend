import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MailService } from '../auth/mail.service';
import { PasswordService } from '../auth/password.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { LoggingService } from '../logging/logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

interface Actor {
  id: string;
  role: Role;
}

interface RequestMeta {
  ip_address?: string;
  user_agent?: string;
}

const adminSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private logging: LoggingService,
    private passwordService: PasswordService,
    private mailService: MailService,
  ) {}

  async create(dto: CreateAdminDto, actor: Actor, meta: RequestMeta = {}) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const tempPassword = this.passwordService.generateTemp();
    const hashedPassword = await this.passwordService.hash(tempPassword);

    const admin = await this.prisma.user.create({
      data: {
        ...dto,
        role: Role.ADMIN,
        password: hashedPassword,
        force_password_reset: true,
      },
      select: adminSelect,
    });

    await this.mailService.sendTempPassword(
      admin.email,
      admin.name,
      tempPassword,
      'Your Admin Account Has Been Created',
    );

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: ActionType.ADMIN_CREATED,
      target_type: 'User',
      target_id: admin.id,
      ...meta,
    });

    return admin;
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { role: Role.ADMIN, deleted_at: null },
      select: adminSelect,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string) {
    const admin = await this.prisma.user.findFirst({
      where: { id, role: Role.ADMIN, deleted_at: null },
      select: adminSelect,
    });
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  async update(
    id: string,
    dto: UpdateAdminDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findOne(id);

    if (dto.email) {
      const conflict = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id } },
      });
      if (conflict) throw new ConflictException('Email already in use');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: adminSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: ActionType.ADMIN_UPDATED,
      target_type: 'User',
      target_id: id,
      ...meta,
    });

    return updated;
  }

  async updateStatus(
    id: string,
    dto: UpdateStatusDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findOne(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { is_active: dto.is_active },
      select: adminSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: dto.is_active ? ActionType.ADMIN_ACTIVATED : ActionType.ADMIN_DEACTIVATED,
      target_type: 'User',
      target_id: id,
      ...meta,
    });

    return updated;
  }

  async remove(id: string, actor: Actor, meta: RequestMeta = {}) {
    await this.findOne(id);

    await this.prisma.user.update({
      where: { id },
      data: { deleted_at: new Date(), is_active: false },
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: ActionType.ADMIN_DELETED,
      target_type: 'User',
      target_id: id,
      ...meta,
    });

    return { message: 'Admin deleted' };
  }
}
