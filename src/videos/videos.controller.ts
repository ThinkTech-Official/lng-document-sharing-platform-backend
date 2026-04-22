import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { VideosService } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { ListVideosDto } from './dto/list-videos.dto';
import { UpdateVideoDepartmentsDto } from './dto/update-video-departments.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { UpdateVideoStatusDto } from './dto/update-video-status.dto';
import type { Request } from 'express';
import { BadRequestException } from '@nestjs/common';

const uploadInterceptor = FileFieldsInterceptor(
  [
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ],
  {
    storage: memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  },
);

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('videos')
export class VideosController {
  constructor(private videosService: VideosService) {}

  private meta(req: Request) {
    return req.requestMeta ?? {};
  }

  @Post()
  @UseInterceptors(uploadInterceptor)
  create(
    @UploadedFiles()
    files: { video?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] },
    @Body() dto: CreateVideoDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    if (!files?.video?.[0]) {
      throw new BadRequestException('Video file is required');
    }
    if (!files?.thumbnail?.[0]) {
      throw new BadRequestException('Thumbnail is required to upload a video');
    }
    return this.videosService.create(
      { video: files.video[0], thumbnail: files.thumbnail[0] },
      dto,
      actor,
      this.meta(req),
    );
  }

  @Get()
  @Roles(Role.CONTRACTOR, Role.ADMIN)
  findAll(@CurrentUser() actor, @Query() query: ListVideosDto) {
    return this.videosService.findAll(actor, query);
  }

  @Get(':id/stream')
  @Roles(Role.CONTRACTOR, Role.ADMIN)
  stream(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.videosService.stream(id, actor, this.meta(req));
  }

  @Get(':id')
  @Roles(Role.CONTRACTOR, Role.ADMIN)
  findOne(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.videosService.findOne(id, actor, this.meta(req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVideoDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.videosService.update(id, dto, actor, this.meta(req));
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateVideoStatusDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.videosService.updateStatus(id, dto, actor, this.meta(req));
  }

  @Patch(':id/departments')
  updateDepartments(
    @Param('id') id: string,
    @Body() dto: UpdateVideoDepartmentsDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.videosService.updateDepartments(
      id,
      dto,
      actor,
      this.meta(req),
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.videosService.remove(id, actor, this.meta(req));
  }
}
