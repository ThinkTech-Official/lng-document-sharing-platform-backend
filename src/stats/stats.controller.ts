import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { StatsService } from './stats.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('stats')
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get()
  getStats(@CurrentUser() actor: { role: Role }) {
    if (actor.role === Role.SUPERADMIN) {
      return this.statsService.getSuperadminStats();
    }
    return this.statsService.getAdminStats();
  }
}
