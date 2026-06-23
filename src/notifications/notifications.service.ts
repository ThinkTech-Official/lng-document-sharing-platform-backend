import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ActionType } from '../logging/enums/action-type.enum';
import { LoggingService } from '../logging/logging.service';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';

interface Actor {
  id: string;
  role: Role;
  name?: string;
  email?: string;
}

interface RequestMeta {
  ip_address?: string;
  user_agent?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private logging: LoggingService,
  ) {}

  async findAll(query: ListNotificationsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async create(dto: CreateNotificationDto, actor: Actor, meta: RequestMeta = {}) {
    const notification = await this.prisma.notification.create({ data: dto });

    this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.NOTIFICATION_CREATED,
      target_type: 'Notification',
      target_id: notification.id,
      ...meta,
    });

    return notification;
  }

  async remove(id: string, actor: Actor, meta: RequestMeta = {}) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notification not found');

    await this.prisma.notification.delete({ where: { id } });

    this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.NOTIFICATION_DELETED,
      target_type: 'Notification',
      target_id: id,
      ...meta,
    });

    return { message: 'Notification deleted' };
  }
}
