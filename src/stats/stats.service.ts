import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getAdminStats(): Promise<{
    contractors: number;
    departments: number;
    documents: number;
    videos: number;
  }> {
    const [contractors, departments, documents, videos] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { role: Role.CONTRACTOR, deleted_at: null } }),
        this.prisma.department.count({ where: { deleted_at: null } }),
        this.prisma.document.count({ where: { deleted_at: null } }),
        this.prisma.video.count({ where: { deleted_at: null } }),
      ]);
    return { contractors, departments, documents, videos };
  }

  async getSuperadminStats(): Promise<{
    admins: number;
    contractors: number;
    departments: number;
    documents: number;
    videos: number;
  }> {
    const [admins, contractors, departments, documents, videos] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { role: Role.ADMIN, deleted_at: null } }),
        this.prisma.user.count({ where: { role: Role.CONTRACTOR, deleted_at: null } }),
        this.prisma.department.count({ where: { deleted_at: null } }),
        this.prisma.document.count({ where: { deleted_at: null } }),
        this.prisma.video.count({ where: { deleted_at: null } }),
      ]);
    return { admins, contractors, departments, documents, videos };
  }
}
