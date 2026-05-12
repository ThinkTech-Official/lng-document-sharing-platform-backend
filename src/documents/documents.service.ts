import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessType, DocumentState, FileType, Role } from '@prisma/client';
import * as crypto from 'crypto';
import * as path from 'path';
import { AzureStorageService } from '../azure/azure-storage.service';
import { paginate } from '../common/helpers/paginate.helper';
import { LoggingService } from '../logging/logging.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UpdateDocumentDepartmentsDto } from './dto/update-document-departments.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { UpdateDocumentStatusDto } from './dto/update-document-status.dto';

const MIME_TO_FILE_TYPE: Record<string, FileType> = {
  'application/pdf': FileType.PDF,
  'application/msword': FileType.DOC,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    FileType.DOC,
  'application/vnd.ms-excel': FileType.EXCEL,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    FileType.EXCEL,
  'image/jpeg': FileType.IMAGE,
  'image/png': FileType.IMAGE,
};

const VALID_TRANSITIONS: Partial<Record<DocumentState, DocumentState[]>> = {
  [DocumentState.DRAFT]: [DocumentState.PUBLISHED],
  [DocumentState.PUBLISHED]: [DocumentState.UNPUBLISHED],
  [DocumentState.UNPUBLISHED]: [DocumentState.PUBLISHED],
};

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

const documentSelect = {
  id: true,
  title: true,
  description: true,
  file_url: true,
  file_type: true,
  state: true,
  access_type: true,
  created_at: true,
  updated_at: true,
  category: {
    select: {
      id: true,
      name: true,
      parent_category_id: true,
      deleted_at: true,
      parent: {
        select: {
          id: true,
          name: true,
          deleted_at: true,
        },
      },
    },
  },
  created_by: { select: { id: true, name: true, email: true } },
  document_departments: {
    select: {
      department_id: true,
      department: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class DocumentsService {
  private readonly container = process.env.AZURE_CONTAINER_DOCUMENTS!;

  constructor(
    private prisma: PrismaService,
    private azure: AzureStorageService,
    private logging: LoggingService,
  ) {}

  async create(
    file: Express.Multer.File,
    dto: CreateDocumentDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    console.log('=== DOCUMENT CREATE DTO ===');
    console.log('access_type:', dto.access_type);
    console.log('department_ids:', dto.department_ids);
    console.log('===========================');
    const fileType = this.resolveFileType(file.mimetype);
    await this.assertCategoryExists(dto.category_id);

    if (dto.access_type === AccessType.RESTRICTED) {
      if (!dto.department_ids?.length) {
        throw new BadRequestException(
          'department_ids is required when access_type is restricted',
        );
      }
      await this.validateDepartments(dto.department_ids);
    }

    const blobName = `${crypto.randomUUID()}-${Date.now()}-${this.sanitizeFilename(file.originalname)}`;
    const file_url = await this.azure.uploadFile(
      this.container,
      blobName,
      file.buffer,
      file.mimetype,
    );

    const document = await this.prisma.document.create({
      data: {
        title: dto.title,
        description: dto.description,
        file_url,
        file_type: fileType,
        access_type: dto.access_type ?? AccessType.ALL,
        category_id: dto.category_id,
        created_by_id: actor.id,
        document_departments:
          dto.access_type === AccessType.RESTRICTED
            ? {
                create: dto.department_ids!.map((id) => ({
                  department_id: id,
                })),
              }
            : undefined,
      },
      select: documentSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DOCUMENT_CREATED,
      target_type: 'Document',
      target_id: document.id,
      ...meta,
    });

    return this.toResponse(document);
  }

  async findAll(actor: Actor, query: ListDocumentsDto) {
    const isContractor = actor.role === Role.CONTRACTOR;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Schema relation names used below:
    //   Document.document_departments       → DocumentDepartment[] (junction)
    //   DocumentDepartment.department_id    → FK field
    //   ContractorDepartment (prisma model) → contractor_id FK field
    let where: any;

    if (isContractor) {
      // Pre-fetch this contractor's assigned department IDs.
      // A direct IN-list check is used instead of nested Prisma relation
      // traversal (document → dept → contractor_dept → contractor_id)
      // because the nested approach does not filter correctly and causes
      // contractors to see RESTRICTED documents from other departments.
      const contractorDepts = await this.prisma.contractorDepartment.findMany({
        where: { contractor_id: actor.id },
        select: { department_id: true },
      });
      const contractorDepartmentIds = contractorDepts.map((d) => d.department_id);

      if (contractorDepartmentIds.length === 0) {
        // No department assignments → only ALL-access published documents visible
        where = {
          deleted_at: null,
          state: DocumentState.PUBLISHED,
          access_type: AccessType.ALL,
        };
      } else {
        // Contractor can see: published ALL documents OR published RESTRICTED
        // documents where at least one document department matches their own.
        where = {
          deleted_at: null,
          state: DocumentState.PUBLISHED,
          OR: [
            { access_type: AccessType.ALL },
            {
              access_type: AccessType.RESTRICTED,
              document_departments: {
                some: {
                  department_id: { in: contractorDepartmentIds },
                },
              },
            },
          ],
        };
      }
    } else {
      where = {
        deleted_at: null,
        ...(query.state && { state: query.state }),
        ...(query.department_access && { access_type: query.department_access }),
      };
    }

    if (query.category_id) where.category_id = query.category_id;
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const [documents, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        select: documentSelect,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);

    return paginate(documents.map((d) => this.toResponse(d)), total, page, limit);
  }

  async findOne(id: string, actor: Actor, meta: RequestMeta = {}) {
    const document = await this.prisma.document.findFirst({
      where: { id, deleted_at: null },
      select: documentSelect,
    });

    if (!document) throw new NotFoundException('Document not found');

    if (actor.role === Role.CONTRACTOR) {
      await this.assertContractorAccess(document, actor.id);
      await this.logging.log({
        actor_id: actor.id,
        actor_role: actor.role,
        actor_name: actor.name,
        actor_email: actor.email,
        action_type: ActionType.DOCUMENT_VIEWED,
        target_type: 'Document',
        target_id: id,
        ...meta,
      });
    }

    const blobName = this.azure.extractBlobName(document.file_url, this.container);
    const sasUrl = await this.azure.generateSasUrl(this.container, blobName, 60, true);
    return this.toResponse(document, sasUrl);
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findExisting(id);

    if (dto.category_id) {
      await this.assertCategoryExists(dto.category_id);
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data: dto,
      select: documentSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DOCUMENT_UPDATED,
      target_type: 'Document',
      target_id: id,
      ...meta,
    });

    return this.toResponse(updated);
  }

  async reupload(
    id: string,
    file: Express.Multer.File,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findExisting(id);
    const fileType = this.resolveFileType(file.mimetype);

    const blobName = `${crypto.randomUUID()}-${Date.now()}-${this.sanitizeFilename(file.originalname)}`;
    const file_url = await this.azure.uploadFile(
      this.container,
      blobName,
      file.buffer,
      file.mimetype,
    );

    const updated = await this.prisma.document.update({
      where: { id },
      data: { file_url, file_type: fileType },
      select: documentSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DOCUMENT_REUPLOADED,
      target_type: 'Document',
      target_id: id,
      ...meta,
    });

    const sasUrl = await this.azure.generateSasUrl(this.container, blobName, 60, true);
    return this.toResponse(updated, sasUrl);
  }

  async updateStatus(
    id: string,
    dto: UpdateDocumentStatusDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    const document = await this.findExisting(id);
    const allowed = VALID_TRANSITIONS[document.state] ?? [];

    if (!allowed.includes(dto.state)) {
      throw new BadRequestException(
        `Cannot transition from ${document.state} to ${dto.state}`,
      );
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data: { state: dto.state },
      select: documentSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DOCUMENT_STATUS_CHANGED,
      target_type: 'Document',
      target_id: id,
      ...meta,
    });

    return this.toResponse(updated);
  }

  async updateDepartments(
    id: string,
    dto: UpdateDocumentDepartmentsDto,
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
      await tx.documentDepartment.deleteMany({ where: { document_id: id } });
      await tx.document.update({
        where: { id },
        data: { access_type: dto.access_type },
      });
      if (dto.access_type === AccessType.RESTRICTED) {
        await tx.documentDepartment.createMany({
          data: dto.department_ids!.map((dept_id) => ({
            document_id: id,
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
      action_type: ActionType.DOCUMENT_DEPARTMENT_UPDATED,
      target_type: 'Document',
      target_id: id,
      ...meta,
    });

    const updated = await this.prisma.document.findFirst({
      where: { id },
      select: documentSelect,
    });
    return this.toResponse(updated!);
  }

  async remove(id: string, actor: Actor, meta: RequestMeta = {}) {
    await this.findExisting(id);

    await this.prisma.document.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DOCUMENT_DELETED,
      target_type: 'Document',
      target_id: id,
      ...meta,
    });

    return { message: 'Document deleted' };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private resolveFileType(mimetype: string): FileType {
    const fileType = MIME_TO_FILE_TYPE[mimetype];
    if (!fileType) {
      throw new BadRequestException(
        'File type not allowed. Accepted: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG',
      );
    }
    return fileType;
  }

  private sanitizeFilename(originalName: string): string {
    return path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '-');
  }

  private async findExisting(id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, deleted_at: null },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
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
    document: any,
    contractorId: string,
  ): Promise<void> {
    if (document.state !== DocumentState.PUBLISHED) {
      throw new ForbiddenException('Document not accessible');
    }

    if (document.access_type === AccessType.ALL) return;

    const contractorDepts = await this.prisma.contractorDepartment.findMany({
      where: { contractor_id: contractorId },
      select: { department_id: true },
    });
    const contractorDepartmentIds = contractorDepts.map((d) => d.department_id);

    const hasAccess =
      contractorDepartmentIds.length > 0 &&
      document.document_departments.some((dd: any) =>
        contractorDepartmentIds.includes(dd.department_id),
      );

    if (!hasAccess) throw new ForbiddenException('You do not have access to this document');
  }

  private toResponse(document: any, sasUrl?: string) {
    const { file_url, ...docWithoutUrl } = document;
    const raw = docWithoutUrl.category;
    let category: {
      id: string;
      name: string;
      parent_category_id: string | null;
      parent: { id: string; name: string } | null;
    } | null = null;

    if (raw && !raw.deleted_at) {
      category = {
        id: raw.id,
        name: raw.name,
        parent_category_id: raw.parent_category_id ?? null,
        parent:
          raw.parent && !raw.parent.deleted_at
            ? { id: raw.parent.id, name: raw.parent.name }
            : null,
      };
    }

    return {
      ...docWithoutUrl,
      ...(sasUrl !== undefined && { document_url: sasUrl }),
      category,
    };
  }
}
