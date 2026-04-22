import { DocumentState } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListDocumentsDto {
  @IsOptional()
  @IsEnum(DocumentState)
  state?: DocumentState;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
