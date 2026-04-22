import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  new_password: string;

  @IsString()
  @IsNotEmpty()
  confirm_password: string;
}
