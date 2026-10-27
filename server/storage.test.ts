import { beforeEach, describe, expect, it, vi } from 'vitest';

const blob = vi.hoisted(() => ({
  createIfNotExists: vi.fn(), getProperties: vi.fn(), uploadData: vi.fn(),
  downloadToBuffer: vi.fn(), deleteIfExists: vi.fn(), getContainerClient: vi.fn(), getBlockBlobClient: vi.fn(),
}));
vi.mock('./config.js', () => ({ config: {
  AZURE_STORAGE_CONNECTION_STRING: 'test-storage-account-key-connection',
  AZURE_STORAGE_CONTAINER: 'learning-files',
} }));
vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString: vi.fn(() => ({ getContainerClient: blob.getContainerClient.mockReturnValue({
    createIfNotExists: blob.createIfNotExists, getProperties: blob.getProperties,
    getBlockBlobClient: blob.getBlockBlobClient.mockReturnValue({
      uploadData: blob.uploadData, downloadToBuffer: blob.downloadToBuffer, deleteIfExists: blob.deleteIfExists,
    }),
  }) })) },
}));
import { BlobServiceClient } from '@azure/storage-blob';
import { checkStorage, deleteFile, putFile, readFileContent } from './storage.js';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  blob.createIfNotExists.mockClear(); blob.getProperties.mockReset().mockResolvedValue({});
  blob.uploadData.mockReset(); blob.downloadToBuffer.mockReset(); blob.deleteIfExists.mockReset();
});
describe('private account-key Blob resource storage', () => {
  it('uses the configured connection string/container and writes optimized bytes/content type', async () => {
    vi.resetModules();
    const storage = await import('./storage.js');
    const buffer = Buffer.from('optimized-image');
    await storage.putFile(id, buffer, 'image/webp');
    expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith('test-storage-account-key-connection');
    expect(blob.getContainerClient).toHaveBeenCalledWith('learning-files');
    expect(blob.getBlockBlobClient).toHaveBeenCalledWith(id);
    expect(blob.uploadData).toHaveBeenCalledWith(buffer, { blobHTTPHeaders: { blobContentType: 'image/webp', blobCacheControl: 'private, no-store' } });
  });
  it('refuses public containers for writes, reads, deletes and health checks', async () => {
    blob.getProperties.mockResolvedValue({ blobPublicAccess: 'blob' });
    for (const work of [() => putFile(id, Buffer.from('document')), () => readFileContent(id), () => deleteFile(id), () => checkStorage()]) {
      await expect(work()).rejects.toMatchObject({ status: 503 });
    }
    expect(blob.uploadData).not.toHaveBeenCalled();
    expect(blob.downloadToBuffer).not.toHaveBeenCalled();
    expect(blob.deleteIfExists).not.toHaveBeenCalled();
  });
  it('propagates Azure failures without returning success or writing to disk', async () => {
    const failure = new Error('Storage unavailable');
    blob.getProperties.mockRejectedValue(failure);
    await expect(putFile(id, Buffer.from('document'))).rejects.toBe(failure);
    await expect(checkStorage()).rejects.toBe(failure);
    expect(blob.uploadData).not.toHaveBeenCalled();
  });
  it('downloads and deletes private blobs without public URLs', async () => {
    const buffer = Buffer.from('file'); blob.downloadToBuffer.mockResolvedValue(buffer);
    expect(await readFileContent(id)).toBe(buffer);
    await deleteFile(id);
    expect(blob.deleteIfExists).toHaveBeenCalledOnce();
  });
  it('rejects malformed storage keys', async () => {
    await expect(putFile('../outside', Buffer.from('document'))).rejects.toThrow('Invalid storage key');
    expect(blob.uploadData).not.toHaveBeenCalled();
  });
});
