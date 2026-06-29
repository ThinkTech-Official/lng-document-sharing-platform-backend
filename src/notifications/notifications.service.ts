import * as crypto from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AzureStorageService } from '../azure/azure-storage.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { LoggingService } from '../logging/logging.service';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';

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
    private azure: AzureStorageService,
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

  async findOne(id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async update(id: string, dto: UpdateNotificationDto, actor: Actor, meta: RequestMeta = {}) {
    await this.findOne(id);

    const updated = await this.prisma.notification.update({
      where: { id },
      data: {
        ...(dto.title    !== undefined && { title:    dto.title }),
        ...(dto.content  !== undefined && { content:  dto.content }),
        ...(dto.category !== undefined && { category: dto.category }),
      },
    });

    this.logging.log({
      actor_id:    actor.id,
      actor_role:  actor.role,
      actor_name:  actor.name,
      actor_email: actor.email,
      action_type: ActionType.NOTIFICATION_UPDATED,
      target_type: 'Notification',
      target_id:   id,
      ...meta,
    });

    return updated;
  }

  // NOTE: images uploaded before this fix may use
  // raw blob URLs which are not publicly accessible.
  // Those notifications should be re-posted.
  async uploadImage(file: Express.Multer.File): Promise<{ url: string }> {
    const ext = file.originalname.split('.').pop() ?? 'jpg';
    const blobName = `notification-images/${crypto.randomUUID()}-${Date.now()}.${ext}`;
    const container = process.env.AZURE_CONTAINER_DOCUMENTS ?? 'documents';

    await this.azure.uploadFile(container, blobName, file.buffer, file.mimetype);

    // generateSasUrl takes minutes — 5 years = 5 * 365 * 24 * 60
    const sasUrl = await this.azure.generateSasUrl(container, blobName, 2_628_000, true);

    return { url: sasUrl };
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
