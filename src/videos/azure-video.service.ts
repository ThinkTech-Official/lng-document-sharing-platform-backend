import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { BlobSASPermissions, BlobServiceClient } from '@azure/storage-blob';
import * as crypto from 'crypto';
import * as path from 'path';

const SAS_TTL_MS = 60 * 60 * 1000; // 60 minutes

@Injectable()
export class AzureVideoService {
  private readonly logger = new Logger(AzureVideoService.name);
  private readonly videoContainer: string;
  private readonly thumbnailContainer: string;
  private _client: BlobServiceClient | undefined;

  constructor() {
    this.videoContainer = process.env.AZURE_CONTAINER_VIDEOS!;
    this.thumbnailContainer =
      process.env.AZURE_CONTAINER_THUMBNAILS ?? 'thumbnails';
  }

  private get client(): BlobServiceClient {
    if (!this._client) {
      const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
      this._client = BlobServiceClient.fromConnectionString(connStr);
    }
    return this._client;
  }

  async uploadVideo(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<string> {
    return this.uploadToContainer(
      buffer,
      originalName,
      mimeType,
      this.videoContainer,
    );
  }

  async uploadThumbnail(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<string> {
    return this.uploadToContainer(
      buffer,
      originalName,
      mimeType,
      this.thumbnailContainer,
    );
  }

  /**
   * Generates a short-lived SAS URL for streaming.
   * - Read-only permission, 60-minute TTL
   * - Content-Disposition: inline  (prevents download prompts in browsers)
   * Requires the connection string to use an account key, not a SAS token.
   */
  async generateStreamUrl(blobUrl: string): Promise<string> {
    try {
      const blobName = this.extractBlobName(blobUrl, this.videoContainer);
      const blockBlobClient = this.client
        .getContainerClient(this.videoContainer)
        .getBlockBlobClient(blobName);

      const sasUrl = await blockBlobClient.generateSasUrl({
        permissions: BlobSASPermissions.parse('r'),
        expiresOn: new Date(Date.now() + SAS_TTL_MS),
        contentDisposition: 'inline',
      });

      this.logger.log(`SAS URL generated for blob: ${blobName}`);
      return sasUrl;
    } catch (err) {
      this.logger.error('SAS URL generation failed', err);
      throw new InternalServerErrorException('Failed to generate stream URL');
    }
  }

  private async uploadToContainer(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    container: string,
  ): Promise<string> {
    try {
      const ext = path.extname(originalName);
      const blobName = `${crypto.randomUUID()}${ext}`;
      const blockBlobClient = this.client
        .getContainerClient(container)
        .getBlockBlobClient(blobName);

      await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: mimeType },
      });

      this.logger.log(`Uploaded blob: ${blobName} → ${container}`);
      return blockBlobClient.url;
    } catch (err) {
      this.logger.error(`Upload failed for container ${container}`, err);
      throw new InternalServerErrorException('File upload failed');
    }
  }

  // Parses "https://{account}.blob.core.windows.net/{container}/{blobName}"
  private extractBlobName(blobUrl: string, container: string): string {
    const url = new URL(blobUrl);
    const prefix = `/${container}/`;
    if (!url.pathname.startsWith(prefix)) {
      throw new Error(`Blob URL does not belong to container "${container}"`);
    }
    return url.pathname.slice(prefix.length);
  }
}
