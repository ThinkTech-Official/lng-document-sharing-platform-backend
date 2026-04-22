import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { AzureBlobService } from './azure-blob.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [LoggingModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, AzureBlobService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
