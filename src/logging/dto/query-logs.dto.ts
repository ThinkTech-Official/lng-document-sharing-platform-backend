import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ActionType } from '../enums/action-type.enum';

export class QueryLogsDto {
  @IsOptional()
  @IsEnum(Role)
  actor_role?: Role;

  @IsOptional()
  @IsEnum(ActionType)
  action_type?: ActionType;

  @IsOptional()
  @IsString()
  target_type?: string;

  @IsOptional()
  @IsString()
  actor_id?: string;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  // Cursor-based pagination: pass created_at ISO string of the last item
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
