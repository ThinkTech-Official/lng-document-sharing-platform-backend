import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AzureStorageService } from '../azure/azure-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const RETENTION_DAYS = 30;

@Injectable()
export class LoggingArchiveService {
  private readonly logger = new Logger(LoggingArchiveService.name);
  private readonly container = process.env.AZURE_CONTAINER_LOGS_ARCHIVE ?? 'logs-archive';

  constructor(
    private prisma: PrismaService,
    private azure: AzureStorageService,
  ) {}

  @Cron('0 2 * * *') // 2 AM daily
  async archiveOldLogs(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    this.logger.log(`Starting log archival for records before ${cutoff.toISOString()}`);

    const logs = await this.prisma.activityLog.findMany({
      where: { created_at: { lt: cutoff } },
      orderBy: { created_at: 'asc' },
    });

    if (logs.length === 0) {
      this.logger.log('No logs to archive');
      return;
    }

    const dateLabel = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const blobName = `logs-archive-${dateLabel}.json.gz`;

    try {
      const compressed = await gzipAsync(
        Buffer.from(JSON.stringify(logs, null, 0)),
      );

      await this.azure.uploadFile(this.container, blobName, compressed, 'application/gzip');

      this.logger.log(`Archived ${logs.length} logs to ${blobName}`);

      // Only delete from DB after confirmed upload
      const ids = logs.map((l) => l.id);
      await this.prisma.activityLog.deleteMany({
        where: { id: { in: ids } },
      });

      this.logger.log(`Deleted ${ids.length} archived logs from database`);
    } catch (err) {
      // Do not delete from DB — retry will happen next day
      this.logger.error(
        `Archive upload failed for ${blobName}. Logs retained in DB for next retry.`,
        err,
      );
    }
  }
}
