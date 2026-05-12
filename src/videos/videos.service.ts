import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessType, Role, UploadStatus } from '@prisma/client';
import * as crypto from 'crypto';
import * as path from 'path';
import { AzureStorageService } from '../azure/azure-storage.service';
import { paginate } from '../common/helpers/paginate.helper';
import { LoggingService } from '../logging/logging.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { PrismaService } from '../prisma/prisma.service';
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
  name?: string;
  email?: string;
}

interface RequestMeta {
  ip_address?: string;
  user_agent?: string;
}

// blob_url and thumbnail_url included for internal SAS generation; stripped in toResponse()
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
  private readonly videoContainer = process.env.AZURE_CONTAINER_VIDEOS!;
  private readonly thumbnailContainer =
    process.env.AZURE_CONTAINER_THUMBNAILS ?? 'thumbnails';

  constructor(
    private prisma: PrismaService,
    private azure: AzureStorageService,
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
      const videoBlobName = `${crypto.randomUUID()}${path.extname(files.video.originalname)}`;
      const thumbnailBlobName = `${crypto.randomUUID()}${path.extname(files.thumbnail.originalname)}`;

      const [blob_url, thumbnail_url] = await Promise.all([
        this.azure.uploadFile(
          this.videoContainer,
          videoBlobName,
          files.video.buffer,
          files.video.mimetype,
        ),
        this.azure.uploadFile(
          this.thumbnailContainer,
          thumbnailBlobName,
          files.thumbnail.buffer,
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
        actor_name: actor.name,
        actor_email: actor.email,
        action_type: ActionType.VIDEO_CREATED,
        target_type: 'Video',
        target_id: video.id,
        ...meta,
      });

      const thumbnailSasUrl = await this.getThumbnailSasUrl(thumbnail_url);
      return this.toResponse(ready, thumbnailSasUrl);
    } catch (err) {
      await this.prisma.video.update({
        where: { id: video.id },
        data: { upload_status: UploadStatus.FAILED },
      });
      throw err;
    }
  }

  async findAll(actor: Actor, query: ListVideosDto) {
    const isContractor = actor.role === Role.CONTRACTOR;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

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
            ...(query.upload_status && { upload_status: query.upload_status }),
            ...(query.department_access && { access_type: query.department_access }),
          }),
      ...(query.category_id && { category_id: query.category_id }),
      ...(query.search && {
        title: { contains: query.search, mode: 'insensitive' },
      }),
    };

    const [videos, total] = await this.prisma.$transaction([
      this.prisma.video.findMany({
        where,
        select: videoSelect,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.video.count({ where }),
    ]);

    const data = await Promise.all(
      videos.map(async (v) => {
        const thumbnailSasUrl = await this.getThumbnailSasUrl(v.thumbnail_url);
        return this.toResponse(v, thumbnailSasUrl);
      }),
    );

    return paginate(data, total, page, limit);
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

    const thumbnailSasUrl = await this.getThumbnailSasUrl(video.thumbnail_url);
    return this.toResponse(video, thumbnailSasUrl);
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
        actor_name: actor.name,
        actor_email: actor.email,
        action_type: ActionType.VIDEO_STREAMED,
        target_type: 'Video',
        target_id: id,
        ...meta,
      });
    }

    const blobName = this.azure.extractBlobName(video.blob_url, this.videoContainer);
    const stream_url = await this.azure.generateSasUrl(
      this.videoContainer,
      blobName,
      60,
      true,
    );
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
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.VIDEO_UPDATED,
      target_type: 'Video',
      target_id: id,
      ...meta,
    });

    const thumbnailSasUrl = await this.getThumbnailSasUrl(updated.thumbnail_url);
    return this.toResponse(updated, thumbnailSasUrl);
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
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.VIDEO_STATUS_CHANGED,
      target_type: 'Video',
      target_id: id,
      ...meta,
    });

    const thumbnailSasUrl = await this.getThumbnailSasUrl(updated.thumbnail_url);
    return this.toResponse(updated, thumbnailSasUrl);
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
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.VIDEO_DEPARTMENT_UPDATED,
      target_type: 'Video',
      target_id: id,
      ...meta,
    });

    const updated = await this.prisma.video.findFirst({
      where: { id },
      select: videoSelect,
    });
    const thumbnailSasUrl = await this.getThumbnailSasUrl(updated!.thumbnail_url);
    return this.toResponse(updated!, thumbnailSasUrl);
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
      actor_name: actor.name,
      actor_email: actor.email,
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

  private async getThumbnailSasUrl(thumbnailUrl: string): Promise<string | undefined> {
    if (!thumbnailUrl) return undefined;
    try {
      const blobName = this.azure.extractBlobName(thumbnailUrl, this.thumbnailContainer);
      return await this.azure.generateSasUrl(this.thumbnailContainer, blobName, 60, true);
    } catch {
      return undefined;
    }
  }

  // Strips blob_url, thumbnail_url, deleted_at; resolves soft-deleted category to null
  private toResponse(video: any, thumbnailSasUrl?: string) {
    const { blob_url, thumbnail_url, deleted_at: _del, category, ...rest } = video;
    const { deleted_at: catDel, ...cat } = category ?? {};
    return {
      ...rest,
      ...(thumbnailSasUrl !== undefined && { thumbnail_sas_url: thumbnailSasUrl }),
      category: category && !catDel ? { id: cat.id, name: cat.name } : null,
    };
  }
}
