import { BlobServiceClient } from '@azure/storage-blob';
import { config } from './config.js';
import { HttpError } from './errors.js';

const service = BlobServiceClient.fromConnectionString(config.AZURE_STORAGE_CONNECTION_STRING);
const container = service.getContainerClient(config.AZURE_STORAGE_CONTAINER);
async function privateContainer() {
  await container.createIfNotExists();
  if ((await container.getProperties()).blobPublicAccess) throw new HttpError(503, 'The learning file container must have private access.');
  return container;
}
function validateKey(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid storage key.');
}
export async function putFile(id: string, buffer: Buffer, contentType = 'application/octet-stream') {
  validateKey(id);
  await (await privateContainer()).getBlockBlobClient(id).uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'private, no-store' },
  });
}
export async function readFileContent(id: string): Promise<Buffer> {
  validateKey(id);
  return (await privateContainer()).getBlockBlobClient(id).downloadToBuffer();
}
export async function deleteFile(id: string) {
  validateKey(id);
  await (await privateContainer()).getBlockBlobClient(id).deleteIfExists();
}
export async function checkStorage(): Promise<void> {
  await privateContainer();
}
