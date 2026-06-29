import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
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

  @Post('upload-image')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
          return cb(
            new BadRequestException('Only JPG, PNG, GIF and WebP images are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.notificationsService.uploadImage(file);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.notificationsService.update(id, dto, actor, this.meta(req));
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
