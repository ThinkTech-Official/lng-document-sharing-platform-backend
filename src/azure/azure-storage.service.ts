import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';

@Injectable()
export class AzureStorageService {
  private readonly logger = new Logger(AzureStorageService.name);
  private _client: BlobServiceClient | undefined;

  private get client(): BlobServiceClient {
    if (!this._client) {
      const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
      this._client = BlobServiceClient.fromConnectionString(connStr);
    }
    return this._client;
  }

  async uploadFile(
    containerName: string,
    blobName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      const blockBlobClient = this.client
        .getContainerClient(containerName)
        .getBlockBlobClient(blobName);

      await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: mimeType },
      });

      this.logger.log(`Uploaded: ${blobName} → ${containerName}`);
      return blockBlobClient.url;
    } catch (err) {
      this.logger.error(`Upload failed: ${blobName} in ${containerName}`, err);
      throw new InternalServerErrorException('File upload failed');
    }
  }

  async deleteFile(containerName: string, blobName: string): Promise<void> {
    try {
      await this.client
        .getContainerClient(containerName)
        .getBlockBlobClient(blobName)
        .deleteIfExists();
    } catch (err) {
      this.logger.error(`Delete failed: ${blobName} in ${containerName}`, err);
    }
  }

  async generateSasUrl(
    containerName: string,
    blobName: string,
    expiryMinutes: number,
    inline: boolean = true,
  ): Promise<string> {
    try {
      const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING!;
      const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
      const accountKey = this.extractAccountKey(connStr);

      const credential = new StorageSharedKeyCredential(accountName, accountKey);
      const sasToken = generateBlobSASQueryParameters(
        {
          containerName,
          blobName,
          permissions: BlobSASPermissions.parse('r'),
          startsOn: new Date(),
          expiresOn: new Date(Date.now() + expiryMinutes * 60 * 1000),
          contentDisposition: inline ? 'inline' : 'attachment',
        },
        credential,
      ).toString();

      return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
    } catch (err) {
      this.logger.error(`SAS generation failed: ${blobName}`, err);
      throw new InternalServerErrorException('Failed to generate file URL');
    }
  }

  extractAccountKey(connectionString: string): string {
    for (const part of connectionString.split(';')) {
      if (part.startsWith('AccountKey=')) {
        return part.slice('AccountKey='.length);
      }
    }
    throw new Error('AccountKey not found in connection string');
  }

  extractBlobName(blobUrl: string, containerName: string): string {
    const url = new URL(blobUrl);
    const prefix = `/${containerName}/`;
    if (!url.pathname.startsWith(prefix)) {
      throw new Error(`Blob URL does not belong to container "${containerName}"`);
    }
    return url.pathname.slice(prefix.length);
  }
}
