import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { AzureVideoService } from './azure-video.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [LoggingModule],
  controllers: [VideosController],
  providers: [VideosService, AzureVideoService],
  exports: [VideosService],
})
export class VideosModule {}
