import { AccessType } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateDocumentDepartmentsDto {
  @IsEnum(AccessType)
  access_type: AccessType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  department_ids?: string[];
}
