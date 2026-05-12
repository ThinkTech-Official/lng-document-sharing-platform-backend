import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MailService } from '../auth/mail.service';
import { PasswordService } from '../auth/password.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { LoggingService } from '../logging/logging.service';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContractorDto } from './dto/create-contractor.dto';
import { ListContractorsDto } from './dto/list-contractors.dto';
import { UpdateContractorDto } from './dto/update-contractor.dto';
import { UpdateDepartmentsDto } from './dto/update-departments.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

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

const contractorSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  is_active: true,
  created_at: true,
  updated_at: true,
  contractor_depts: {
    include: {
      department: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class ContractorService {
  private readonly logger = new Logger(ContractorService.name);

  constructor(
    private prisma: PrismaService,
    private logging: LoggingService,
    private passwordService: PasswordService,
    private mailService: MailService,
  ) {}

  private toContractorResponse(contractor: any) {
    const { contractor_depts, ...rest } = contractor;
    return {
      ...rest,
      departments: (contractor_depts ?? []).map((cd: any) => cd.department),
    };
  }

  private async validateDepartments(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await this.prisma.department.findMany({
      where: { id: { in: ids }, deleted_at: null },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('One or more department IDs are invalid');
    }
  }

  async create(
    dto: CreateContractorDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const { department_ids = [], ...userData } = dto;
    await this.validateDepartments(department_ids);

    const tempPassword = this.passwordService.generateTemp();
    const hashedPassword = await this.passwordService.hash(tempPassword);

    const contractor = await this.prisma.user.create({
      data: {
        ...userData,
        role: Role.CONTRACTOR,
        password: hashedPassword,
        force_password_reset: true,
        contractor_depts: {
          create: department_ids.map((id) => ({ department_id: id })),
        },
      },
      select: contractorSelect,
    });

    this.mailService
      .sendTempPassword(contractor.email, contractor.name, tempPassword, 'Your Contractor Account Has Been Created')
      .catch((err) => this.logger.error(`Failed to send welcome email to ${contractor.email}`, err));

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.CONTRACTOR_CREATED,
      target_type: 'User',
      target_id: contractor.id,
      ...meta,
    });

    return this.toContractorResponse(contractor);
  }

  async findAll(query: ListContractorsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { role: Role.CONTRACTOR, deleted_at: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }
    if (query.department_id) {
      where.contractor_depts = { some: { department_id: query.department_id } };
    }

    const [contractors, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: contractorSelect,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(contractors.map((c) => this.toContractorResponse(c)), total, page, limit);
  }

  async findOne(id: string) {
    const contractor = await this.prisma.user.findFirst({
      where: { id, role: Role.CONTRACTOR, deleted_at: null },
      select: contractorSelect,
    });
    if (!contractor) throw new NotFoundException('Contractor not found');
    return this.toContractorResponse(contractor);
  }

  async update(
    id: string,
    dto: UpdateContractorDto,
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
      select: contractorSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.CONTRACTOR_UPDATED,
      target_type: 'User',
      target_id: id,
      ...meta,
    });

    return this.toContractorResponse(updated);
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
      select: contractorSelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: dto.is_active
        ? ActionType.CONTRACTOR_ACTIVATED
        : ActionType.CONTRACTOR_DEACTIVATED,
      target_type: 'User',
      target_id: id,
      ...meta,
    });

    return this.toContractorResponse(updated);
  }

  async updateDepartments(
    id: string,
    dto: UpdateDepartmentsDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    await this.findOne(id);
    await this.validateDepartments(dto.department_ids);

    // Replace all department assignments atomically
    await this.prisma.$transaction([
      this.prisma.contractorDepartment.deleteMany({
        where: { contractor_id: id },
      }),
      this.prisma.contractorDepartment.createMany({
        data: dto.department_ids.map((dept_id) => ({
          contractor_id: id,
          department_id: dept_id,
        })),
      }),
    ]);

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.CONTRACTOR_DEPARTMENT_UPDATED,
      target_type: 'User',
      target_id: id,
      ...meta,
    });

    return this.findOne(id);
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
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.CONTRACTOR_DELETED,
      target_type: 'User',
      target_id: id,
      ...meta,
    });

    return { message: 'Contractor deleted' };
  }
}
