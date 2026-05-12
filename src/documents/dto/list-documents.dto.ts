import { AccessType, DocumentState } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListDocumentsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(DocumentState)
  state?: DocumentState;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(AccessType)
  department_access?: AccessType;
}
