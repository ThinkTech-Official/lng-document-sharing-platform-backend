import { IsBoolean } from 'class-validator';

export class UpdateVideoStatusDto {
  @IsBoolean()
  is_live: boolean;
}
