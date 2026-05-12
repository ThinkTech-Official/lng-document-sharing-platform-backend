import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessType, Role } from '@prisma/client';
import { LoggingService } from '../logging/logging.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListDepartmentsDto } from './dto/list-departments.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

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

const departmentSelect = {
  id: true,
  name: true,
  description: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private logging: LoggingService,
  ) {}

  async create(dto: CreateDepartmentDto, actor: Actor, meta: RequestMeta = {}) {
    const existing = await this.prisma.department.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Department name already in use');

    const department = await this.prisma.department.create({
      data: dto,
      select: departmentSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DEPARTMENT_CREATED,
      target_type: 'Department',
      target_id: department.id,
      ...meta,
    });

    return department;
  }

  async findAll(query: ListDepartmentsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        select: departmentSelect,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.department.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, deleted_at: null },
      select: departmentSelect,
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findOne(id);

    if (dto.name) {
      const conflict = await this.prisma.department.findFirst({
        where: { name: dto.name, NOT: { id } },
      });
      if (conflict) throw new ConflictException('Department name already in use');
    }

    const updated = await this.prisma.department.update({
      where: { id },
      data: dto,
      select: departmentSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DEPARTMENT_UPDATED,
      target_type: 'Department',
      target_id: id,
      ...meta,
    });

    return updated;
  }

  async remove(id: string, actor: Actor, meta: RequestMeta = {}) {
    await this.findOne(id);
    await this.assertEmpty(id);

    await this.prisma.department.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.DEPARTMENT_DELETED,
      target_type: 'Department',
      target_id: id,
      ...meta,
    });

    return { message: 'Department deleted' };
  }

  /**
   * Hard business rule — no bypass even for superadmin.
   * Runs all three checks in parallel and surfaces every conflict at once.
   */
  private async assertEmpty(id: string): Promise<void> {
    const [contractorCount, documentCount, videoCount] = await Promise.all([
      this.prisma.contractorDepartment.count({
        where: {
          department_id: id,
          contractor: { deleted_at: null },
        },
      }),
      this.prisma.documentDepartment.count({
        where: {
          department_id: id,
          document: { access_type: AccessType.RESTRICTED, deleted_at: null },
        },
      }),
      this.prisma.videoDepartment.count({
        where: {
          department_id: id,
          video: { access_type: AccessType.RESTRICTED, deleted_at: null },
        },
      }),
    ]);

    const conflicts: string[] = [];

    if (contractorCount > 0) {
      conflicts.push(
        `Department has ${contractorCount} contractor(s). Reassign before deleting.`,
      );
    }
    if (documentCount > 0) {
      conflicts.push(
        `Department has ${documentCount} document(s). Reassign before deleting.`,
      );
    }
    if (videoCount > 0) {
      conflicts.push(
        `Department has ${videoCount} video(s). Reassign before deleting.`,
      );
    }

    if (conflicts.length > 0) {
      throw new ConflictException(conflicts);
    }
  }
}
