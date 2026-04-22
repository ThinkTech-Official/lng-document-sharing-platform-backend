import { IsArray, IsString } from 'class-validator';

export class UpdateDepartmentsDto {
  @IsArray()
  @IsString({ each: true })
  department_ids: string[];
}
