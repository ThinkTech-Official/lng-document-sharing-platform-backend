import { DocumentState } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateDocumentStatusDto {
  @IsEnum(DocumentState)
  state: DocumentState;
}
