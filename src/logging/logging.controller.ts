import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { QueryLogsDto } from './dto/query-logs.dto';
import { LoggingService } from './logging.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('logs')
export class LoggingController {
  constructor(private loggingService: LoggingService) {}

  @Get()
  findAll(@Query() query: QueryLogsDto) {
    return this.loggingService.findMany(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const log = await this.loggingService.findOne(id);
    if (!log) throw new NotFoundException('Log entry not found');
    return log;
  }
}
