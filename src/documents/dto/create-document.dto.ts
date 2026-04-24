import { AccessType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  category_id: string;

  @IsOptional()
  @IsEnum(AccessType)
  @Transform(({ value }) => {
    if (!value) return undefined;
    return value.toString().toUpperCase();
  })
  access_type?: AccessType;

  // Multipart form sends arrays as repeated keys, JSON strings, or comma-separated strings
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      if (typeof value === 'string') {
        return value
          .split(',')
          .map((v: string) => v.trim())
          .filter(Boolean);
      }
      return [value];
    }
  })
  @IsArray()
  @IsString({ each: true })
  department_ids?: string[];
}
