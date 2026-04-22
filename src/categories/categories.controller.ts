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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  private meta(req: Request) {
    return req.requestMeta ?? {};
  }

  // Declared before :id route so 'public' is not treated as an id param
  @Get('public')
  @Roles(Role.CONTRACTOR, Role.ADMIN)
  findAllPublic() {
    return this.categoriesService.findAllPublic();
  }

  @Post()
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.categoriesService.create(dto, actor, this.meta(req));
  }

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.categoriesService.update(id, dto, actor, this.meta(req));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() actor,
    @Req() req: Request,
  ) {
    return this.categoriesService.remove(id, actor, this.meta(req));
  }
}
