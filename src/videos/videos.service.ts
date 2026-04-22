import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessType, Role, UploadStatus } from '@prisma/client';
import { LoggingService } from '../logging/logging.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { PrismaService } from '../prisma/prisma.service';
import { AzureVideoService } from './azure-video.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { ListVideosDto } from './dto/list-videos.dto';
import { UpdateVideoDepartmentsDto } from './dto/update-video-departments.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { UpdateVideoStatusDto } from './dto/update-video-status.dto';

const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
const ALLOWED_THUMBNAIL_MIMES = ['image/jpeg', 'image/png'];

interface Actor {
  id: string;
  role: Role;
}

interface RequestMeta {
  ip_address?: string;
  user_agent?: string;
}

// blob_url included here for internal use (SAS generation); stripped in toResponse()
const videoSelect = {
  id: true,
  title: true,
  description: true,
  blob_url: true,
  thumbnail_url: true,
  upload_status: true,
  is_live: true,
  access_type: true,
  deleted_at: true,
  created_at: true,
  updated_at: true,
  category: { select: { id: true, name: true, deleted_at: true } },
  created_by: { select: { id: true, name: true, email: true } },
  video_departments: {
    select: {
      department_id: true,
      department: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class VideosService {
  constructor(
    private prisma: PrismaService,
    private azure: AzureVideoService,
    private logging: LoggingService,
  ) {}

  async create(
    files: { video: Express.Multer.File; thumbnail: Express.Multer.File },
    dto: CreateVideoDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    this.assertVideoMime(files.video.mimetype);
    this.assertThumbnailMime(files.thumbnail.mimetype);
    await this.assertCategoryExists(dto.category_id);

    if (dto.access_type === AccessType.RESTRICTED) {
      if (!dto.department_ids?.length) {
        throw new BadRequestException(
          'department_ids is required when access_type is restricted',
        );
      }
      await this.validateDepartments(dto.department_ids);
    }

    // Create record immediately with UPLOADING status
    const video = await this.prisma.video.create({
      data: {
        title: dto.title,
        description: dto.description,
        blob_url: '',
        thumbnail_url: '',
        upload_status: UploadStatus.UPLOADING,
        access_type: dto.access_type ?? AccessType.ALL,
        category_id: dto.category_id,
        created_by_id: actor.id,
        video_departments:
          dto.access_type === AccessType.RESTRICTED
            ? {
                create: dto.department_ids!.map((id) => ({
                  department_id: id,
                })),
              }
            : undefined,
      },
      select: { id: true },
    });

    try {
      // Upload video and thumbnail in parallel
      const [blob_url, thumbnail_url] = await Promise.all([
        this.azure.uploadVideo(
          files.video.buffer,
          files.video.originalname,
          files.video.mimetype,
        ),
        this.azure.uploadThumbnail(
          files.thumbnail.buffer,
          files.thumbnail.originalname,
          files.thumbnail.mimetype,
        ),
      ]);

      const ready = await this.prisma.video.update({
        where: { id: video.id },
        data: { blob_url, thumbnail_url, upload_status: UploadStatus.READY },
        select: videoSelect,
      });

      await this.logging.log({
        actor_id: actor.id,
        actor_role: actor.role,
        action_type: ActionType.VIDEO_CREATED,
        target_type: 'Video',
        target_id: video.id,
        ...meta,
      });

      return this.toResponse(ready);
    } catch (err) {
      // Mark as failed but do not swallow the error
      await this.prisma.video.update({
        where: { id: video.id },
        data: { upload_status: UploadStatus.FAILED },
      });
      throw err;
    }
  }

  async findAll(actor: Actor, query: ListVideosDto) {
    const isContractor = actor.role === Role.CONTRACTOR;

    const where: any = {
      deleted_at: null,
      ...(isContractor
        ? {
            is_live: true,
            upload_status: UploadStatus.READY,
            OR: [
              { access_type: AccessType.ALL },
              {
                access_type: AccessType.RESTRICTED,
                video_departments: {
                  some: {
                    department: {
                      contractor_depts: {
                        some: { contractor_id: actor.id },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {
            ...(query.is_live !== undefined && { is_live: query.is_live }),
          }),
      ...(query.category_id && { category_id: query.category_id }),
      ...(query.search && {
        title: { contains: query.search, mode: 'insensitive' },
      }),
    };

    const videos = await this.prisma.video.findMany({
      where,
      select: videoSelect,
      orderBy: { created_at: 'desc' },
    });

    return videos.map((v) => this.toResponse(v));
  }

  async findOne(id: string, actor: Actor, meta: RequestMeta = {}) {
    const video = await this.prisma.video.findFirst({
      where: { id, deleted_at: null },
      select: videoSelect,
    });

    if (!video) throw new NotFoundException('Video not found');

    if (actor.role === Role.CONTRACTOR) {
      await this.assertContractorAccess(video, actor.id);
    }

    return this.toResponse(video);
  }

  async stream(id: string, actor: Actor, meta: RequestMeta = {}) {
    const video = await this.prisma.video.findFirst({
      where: { id, deleted_at: null },
      select: videoSelect,
    });

    if (!video) throw new NotFoundException('Video not found');

    if (actor.role === Role.CONTRACTOR) {
      await this.assertContractorAccess(video, actor.id);
      await this.logging.log({
        actor_id: actor.id,
        actor_role: actor.role,
        action_type: ActionType.VIDEO_STREAMED,
        target_type: 'Video',
        target_id: id,
        ...meta,
      });
    }

    // blob_url never leaves the server — only the SAS URL is returned
    const stream_url = await this.azure.generateStreamUrl(video.blob_url);
    return { stream_url };
  }

  async update(
    id: string,
    dto: UpdateVideoDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findExisting(id);

    if (dto.category_id) {
      await this.assertCategoryExists(dto.category_id);
    }

    const updated = await this.prisma.video.update({
      where: { id },
      data: dto,
      select: videoSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: ActionType.VIDEO_UPDATED,
      target_type: 'Video',
      target_id: id,
      ...meta,
    });

    return this.toResponse(updated);
  }

  async updateStatus(
    id: string,
    dto: UpdateVideoStatusDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    const video = await this.findExisting(id);

    if (video.upload_status !== UploadStatus.READY) {
      throw new BadRequestException('Video is not ready for publishing');
    }

    const updated = await this.prisma.video.update({
      where: { id },
      data: { is_live: dto.is_live },
      select: videoSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: ActionType.VIDEO_STATUS_CHANGED,
      target_type: 'Video',
      target_id: id,
      ...meta,
    });

    return this.toResponse(updated);
  }

  async updateDepartments(
    id: string,
    dto: UpdateVideoDepartmentsDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findExisting(id);

    if (dto.access_type === AccessType.RESTRICTED) {
      if (!dto.department_ids?.length) {
        throw new BadRequestException(
          'department_ids is required when access_type is restricted',
        );
      }
      await this.validateDepartments(dto.department_ids);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.videoDepartment.deleteMany({ where: { video_id: id } });
      await tx.video.update({
        where: { id },
        data: { access_type: dto.access_type },
      });
      if (dto.access_type === AccessType.RESTRICTED) {
        await tx.videoDepartment.createMany({
          data: dto.department_ids!.map((dept_id) => ({
            video_id: id,
            department_id: dept_id,
          })),
        });
      }
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: ActionType.VIDEO_DEPARTMENT_UPDATED,
      target_type: 'Video',
      target_id: id,
      ...meta,
    });

    const updated = await this.prisma.video.findFirst({
      where: { id },
      select: videoSelect,
    });
    return this.toResponse(updated!);
  }

  async remove(id: string, actor: Actor, meta: RequestMeta = {}) {
    await this.findExisting(id);

    await this.prisma.video.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      action_type: ActionType.VIDEO_DELETED,
      target_type: 'Video',
      target_id: id,
      ...meta,
    });

    return { message: 'Video deleted' };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private assertVideoMime(mimetype: string): void {
    if (!ALLOWED_VIDEO_MIMES.includes(mimetype)) {
      throw new BadRequestException(
        'Video file type not allowed. Accepted: MP4, MOV, AVI',
      );
    }
  }

  private assertThumbnailMime(mimetype: string): void {
    if (!ALLOWED_THUMBNAIL_MIMES.includes(mimetype)) {
      throw new BadRequestException(
        'Thumbnail file type not allowed. Accepted: JPG, PNG',
      );
    }
  }

  private async findExisting(id: string) {
    const video = await this.prisma.video.findFirst({
      where: { id, deleted_at: null },
    });
    if (!video) throw new NotFoundException('Video not found');
    return video;
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deleted_at: null },
    });
    if (!category) throw new NotFoundException('Category not found');
  }

  private async validateDepartments(ids: string[]): Promise<void> {
    const found = await this.prisma.department.findMany({
      where: { id: { in: ids }, deleted_at: null },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('One or more department IDs are invalid');
    }
  }

  private async assertContractorAccess(
    video: any,
    contractorId: string,
  ): Promise<void> {
    if (!video.is_live || video.upload_status !== UploadStatus.READY) {
      throw new ForbiddenException('Video not accessible');
    }
    if (video.access_type === AccessType.ALL) return;

    const contractorDepts = await this.prisma.contractorDepartment.findMany({
      where: { contractor_id: contractorId },
      select: { department_id: true },
    });
    const deptIds = new Set(contractorDepts.map((d) => d.department_id));
    const hasAccess = video.video_departments.some((vd: any) =>
      deptIds.has(vd.department_id),
    );
    if (!hasAccess) throw new ForbiddenException('Video not accessible');
  }

  // Strips blob_url and resolves soft-deleted category to null
  private toResponse(video: any) {
    const { blob_url, deleted_at: _del, category, ...rest } = video;
    const { deleted_at: catDel, ...cat } = category ?? {};
    return {
      ...rest,
      category: category && !catDel ? { id: cat.id, name: cat.name } : null,
    };
  }
}
