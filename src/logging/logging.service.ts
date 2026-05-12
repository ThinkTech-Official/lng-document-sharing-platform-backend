import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActionType } from './enums/action-type.enum';

export interface LogActionParams {
  actor_id: string;
  actor_role: Role;
  actor_name?: string;
  actor_email?: string;
  action_type: ActionType;
  target_type?: string;
  target_id?: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Fire-and-forget: never awaited by callers, never throws.
   * Failures are logged to console only and do not propagate.
   */
  log(params: LogActionParams): void {
    this.write(params).catch((err) =>
      this.logger.error('Failed to write activity log', err),
    );
  }

  private async write(params: LogActionParams): Promise<void> {
    await this.prisma.activityLog.create({ data: params });
  }

  async findMany(filters: {
    actor_role?: Role;
    action_type?: ActionType;
    target_type?: string;
    actor_id?: string;
    date_from?: string;
    date_to?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 100);

    // Build created_at filter: merge date range and cursor so they don't clobber each other
    const createdAtFilter: Record<string, Date> = {};
    if (filters.date_from) createdAtFilter.gte = new Date(filters.date_from);
    if (filters.date_to) createdAtFilter.lte = new Date(filters.date_to);
    if (filters.cursor) createdAtFilter.lt = new Date(filters.cursor);

    const where: any = {
      ...(filters.actor_role && { actor_role: filters.actor_role }),
      ...(filters.action_type && { action_type: filters.action_type }),
      ...(filters.target_type && { target_type: filters.target_type }),
      ...(filters.actor_id && { actor_id: filters.actor_id }),
      ...(Object.keys(createdAtFilter).length > 0 && { created_at: createdAtFilter }),
    };

    const logs = await this.prisma.activityLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit + 1, // fetch one extra to determine if there's a next page
    });

    const hasNextPage = logs.length > limit;
    const data = hasNextPage ? logs.slice(0, limit) : logs;
    const nextCursor = hasNextPage
      ? data[data.length - 1].created_at.toISOString()
      : null;

    return { data, nextCursor, hasNextPage };
  }

  async findOne(id: string) {
    return this.prisma.activityLog.findUnique({ where: { id } });
  }
}
