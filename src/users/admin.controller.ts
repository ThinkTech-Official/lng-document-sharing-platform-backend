import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  private meta(req: Request) {
    return req.requestMeta ?? {};
  }

  @Post()
  create(
    @Body() dto: CreateAdminDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.adminService.create(dto, actor, this.meta(req));
  }

  @Get()
  findAll() {
    return this.adminService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.adminService.update(id, dto, actor, this.meta(req));
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.adminService.updateStatus(id, dto, actor, this.meta(req));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.adminService.remove(id, actor, this.meta(req));
  }
}
