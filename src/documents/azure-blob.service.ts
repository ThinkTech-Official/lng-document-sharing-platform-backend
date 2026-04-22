import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { BlobServiceClient } from '@azure/storage-blob';
import * as crypto from 'crypto';
import * as path from 'path';

@Injectable()
export class AzureBlobService {
  private readonly logger = new Logger(AzureBlobService.name);
  private readonly container: string;
  private _client: BlobServiceClient | undefined;

  constructor() {
    this.container = process.env.AZURE_CONTAINER_DOCUMENTS!;
  }

  private get client(): BlobServiceClient {
    if (!this._client) {
      const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
      this._client = BlobServiceClient.fromConnectionString(connStr);
    }
    return this._client;
  }

  async upload(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<string> {
    try {
      const ext = path.extname(originalName);
      const blobName = `${crypto.randomUUID()}${ext}`;

      const containerClient = this.client.getContainerClient(this.container);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: mimeType },
      });

      this.logger.log(`Uploaded blob: ${blobName}`);
      return blockBlobClient.url;
    } catch (err) {
      this.logger.error('Azure Blob upload failed', err);
      throw new InternalServerErrorException('File upload failed');
    }
  }
}
