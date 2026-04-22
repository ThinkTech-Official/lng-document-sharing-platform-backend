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
import { ContractorService } from './contractor.service';
import { CreateContractorDto } from './dto/create-contractor.dto';
import { UpdateContractorDto } from './dto/update-contractor.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateDepartmentsDto } from './dto/update-departments.dto';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('contractors')
export class ContractorController {
  constructor(private contractorService: ContractorService) {}

  private meta(req: Request) {
    return req.requestMeta ?? {};
  }

  @Post()
  create(
    @Body() dto: CreateContractorDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.contractorService.create(dto, actor, this.meta(req));
  }

  @Get()
  findAll() {
    return this.contractorService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contractorService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractorDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.contractorService.update(id, dto, actor, this.meta(req));
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.contractorService.updateStatus(id, dto, actor, this.meta(req));
  }

  @Patch(':id/departments')
  updateDepartments(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentsDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.contractorService.updateDepartments(
      id,
      dto,
      actor,
      this.meta(req),
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.contractorService.remove(id, actor, this.meta(req));
  }
}
