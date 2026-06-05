import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { LoggingService } from '../logging/logging.service';
import { ActionType } from '../logging/enums/action-type.enum';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesDto } from './dto/list-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

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

// 3-level hierarchy: root → subcategory → child subcategory
const childSelect = {
  id: true,
  name: true,
  sort_order: true,
  parent_category_id: true,
  created_at: true,
  updated_at: true,
} as const;

const subcategorySelect = {
  id: true,
  name: true,
  sort_order: true,
  parent_category_id: true,
  created_at: true,
  updated_at: true,
  subcategories: {
    where: { deleted_at: null },
    select: childSelect,
    orderBy: { sort_order: 'asc' as const },
  },
} as const;

const categorySelect = {
  id: true,
  name: true,
  sort_order: true,
  parent_category_id: true,
  created_at: true,
  updated_at: true,
  subcategories: {
    where: { deleted_at: null },
    select: subcategorySelect,
    orderBy: { sort_order: 'asc' as const },
  },
} as const;

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private logging: LoggingService,
  ) {}

  async create(dto: CreateCategoryDto, actor: Actor, meta: RequestMeta = {}) {
    if (dto.parent_category_id) {
      await this.assertValidParent(dto.parent_category_id);
    }

    await this.assertUniqueName(dto.name, dto.parent_category_id ?? null);

    const category = await this.prisma.category.create({
      data: {
        name: dto.name,
        sort_order: dto.sort_order ?? 0,
        parent_category_id: dto.parent_category_id ?? null,
      },
      select: categorySelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.CATEGORY_CREATED,
      target_type: 'Category',
      target_id: category.id,
      ...meta,
    });

    return category;
  }

  async findAll(query: ListCategoriesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { parent_category_id: null, deleted_at: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        {
          subcategories: {
            some: {
              name: { contains: query.search, mode: 'insensitive' },
              deleted_at: null,
            },
          },
        },
        {
          subcategories: {
            some: {
              deleted_at: null,
              subcategories: {
                some: {
                  name: { contains: query.search, mode: 'insensitive' },
                  deleted_at: null,
                },
              },
            },
          },
        },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        select: categorySelect,
        orderBy: { sort_order: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.category.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // Public listing for homepage — all authenticated roles
  async findAllPublic() {
    return this.prisma.category.findMany({
      where: { parent_category_id: null, deleted_at: null },
      select: categorySelect,
      orderBy: { sort_order: 'asc' },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, deleted_at: null },
      select: categorySelect,
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    actor: Actor,
    meta: RequestMeta = {},
  ) {
    if (dto.name) {
      const existing = await this.findOne(id);
      await this.assertUniqueName(dto.name, existing.parent_category_id, id);
    } else {
      await this.findOne(id);
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: dto,
      select: categorySelect,
    });

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.CATEGORY_UPDATED,
      target_type: 'Category',
      target_id: id,
      ...meta,
    });

    return updated;
  }

  async remove(id: string, actor: Actor, meta: RequestMeta = {}) {
    const category = await this.findOne(id);
    const now = new Date();

    if (category.parent_category_id === null) {
      // Root category: cascade to subcategories and their children (3rd level)
      const subcategories = await this.prisma.category.findMany({
        where: { parent_category_id: id, deleted_at: null },
        select: { id: true },
      });
      const subcategoryIds = subcategories.map((s) => s.id);

      await this.prisma.$transaction([
        this.prisma.category.update({
          where: { id },
          data: { deleted_at: now },
        }),
        this.prisma.category.updateMany({
          where: { parent_category_id: id, deleted_at: null },
          data: { deleted_at: now },
        }),
        ...(subcategoryIds.length > 0
          ? [
              this.prisma.category.updateMany({
                where: {
                  parent_category_id: { in: subcategoryIds },
                  deleted_at: null,
                },
                data: { deleted_at: now },
              }),
            ]
          : []),
      ]);
    } else {
      // Subcategory or child: cascade to own children as well
      await this.prisma.$transaction([
        this.prisma.category.update({
          where: { id },
          data: { deleted_at: now },
        }),
        this.prisma.category.updateMany({
          where: { parent_category_id: id, deleted_at: null },
          data: { deleted_at: now },
        }),
      ]);
    }

    await this.logging.log({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_name: actor.name,
      actor_email: actor.email,
      action_type: ActionType.CATEGORY_DELETED,
      target_type: 'Category',
      target_id: id,
      ...meta,
    });

    return { message: 'Category deleted' };
  }

  private async assertUniqueName(
    name: string,
    parentCategoryId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        parent_category_id: parentCategoryId,
        deleted_at: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new BadRequestException(
        parentCategoryId
          ? 'A subcategory with this name already exists under this parent'
          : 'A category with this name already exists',
      );
    }
  }

  /**
   * Ensures the proposed parent exists, is not soft-deleted, and is at most
   * depth 1 (subcategory) — max supported depth is 2 levels:
   *   root (depth 0) → subcategory (depth 1) → child subcategory (depth 2)
   * Attempting to nest beyond depth 2 returns 400.
   */
  private async assertValidParent(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, deleted_at: null },
      select: {
        id: true,
        parent_category_id: true,
        parent: { select: { parent_category_id: true } },
      },
    });

    if (!parent) throw new NotFoundException('Parent category not found');

    if (parent.parent_category_id !== null) {
      // parent is a subcategory — only allowed if its own parent is a root
      if (parent.parent?.parent_category_id !== null) {
        throw new BadRequestException(
          'Maximum category depth is 2 levels. Child subcategories cannot have children.',
        );
      }
      // parent.parent is a root → creating a child subcategory (depth 2) ✓
    }
    // parent is a root → creating a subcategory (depth 1) ✓
  }
}
