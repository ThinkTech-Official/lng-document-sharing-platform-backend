import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  private meta(req: Request) {
    return req.requestMeta ?? {};
  }

  @Get()
  @Roles(Role.ADMIN, Role.CONTRACTOR)
  findAll(@Query() query: ListNotificationsDto) {
    return this.notificationsService.findAll(query);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateNotificationDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.notificationsService.create(dto, actor, this.meta(req));
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.notificationsService.remove(id, actor, this.meta(req));
  }
}
