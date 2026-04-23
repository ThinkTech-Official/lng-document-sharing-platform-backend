import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [LoggingModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
