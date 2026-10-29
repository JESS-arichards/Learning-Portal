import sharp from 'sharp';
import { HttpError, logger } from './errors.js';

const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
let active = 0;

/** Matches the Portal optimizer: guarded decoding, orientation, metadata stripping and WebP quality 80. */
export async function prepareResource(name: string, data: Buffer): Promise<{ name: string; data: Buffer; contentType: string }> {
  const extension = name.split('.').pop()!.toLowerCase();
  const expected = imageTypes[extension];
  if (!expected) return { name, data, contentType: 'application/octet-stream' };
  if (active >= 2) throw new HttpError(503, 'Images are being processed. Please retry shortly.');
  active++;
  try {
    const image = sharp(data, { animated: true, limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    const actual = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
    if (actual !== expected || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 100) {
      throw new Error('Image contents, dimensions or frame count are invalid.');
    }
    if ((metadata.pages ?? 1) === 1) image.rotate();
    const optimized = await image.resize({
      width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true,
    }).webp({ quality: 80 }).toBuffer();
    const metadataFree = !metadata.orientation && !metadata.exif && !metadata.iptc && !metadata.xmp && !metadata.icc;
    if (metadataFree && optimized.length >= data.length) return { name, data, contentType: actual };
    return { name: name.replace(/\.[^.]+$/, '').slice(0, 195) + '.webp', data: optimized, contentType: 'image/webp' };
  } catch (error) {
    logger.warn({ err: error }, 'Uploaded lesson image decoding failed');
    throw new HttpError(400, 'The image could not be processed. Use matching PNG, JPEG, GIF or WebP contents of no more than 40 megapixels and 100 frames.');
  } finally {
    active--;
  }
}
