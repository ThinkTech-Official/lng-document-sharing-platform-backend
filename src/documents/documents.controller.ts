import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UpdateDocumentDepartmentsDto } from './dto/update-document-departments.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { UpdateDocumentStatusDto } from './dto/update-document-status.dto';
import type { Request } from 'express';

const uploadInterceptor = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  private meta(req: Request) {
    return req.requestMeta ?? {};
  }

  @Post()
  @UseInterceptors(uploadInterceptor)
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.documentsService.create(file, dto, actor, this.meta(req));
  }

  @Get()
  @Roles(Role.CONTRACTOR, Role.ADMIN)
  findAll(@CurrentUser() actor, @Query() query: ListDocumentsDto) {
    return this.documentsService.findAll(actor, query);
  }

  @Get(':id')
  @Roles(Role.CONTRACTOR, Role.ADMIN)
  findOne(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.documentsService.findOne(id, actor, this.meta(req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.documentsService.update(id, dto, actor, this.meta(req));
  }

  @Patch(':id/reupload')
  @UseInterceptors(uploadInterceptor)
  reupload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.documentsService.reupload(id, file, actor, this.meta(req));
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentStatusDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.documentsService.updateStatus(id, dto, actor, this.meta(req));
  }

  @Patch(':id/departments')
  updateDepartments(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDepartmentsDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.documentsService.updateDepartments(
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
    return this.documentsService.remove(id, actor, this.meta(req));
  }
}
