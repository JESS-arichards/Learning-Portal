import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareResource } from './optimizeImage.js';

describe('Portal-compatible lesson image reduction', () => {
  it('reduces large portrait/landscape photos by more than half, to WebP at 2048px', async () => {
    for (const [width, height] of [[2400, 1600], [1600, 2400]]) {
      const original = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
      const result = await prepareResource('Lesson photo.jpg', original);
      expect(result.contentType).toBe('image/webp');
      expect(result.name).toBe('Lesson photo.webp');
      expect(result.data.length).toBeLessThan(original.length / 2);
      const metadata = await sharp(result.data).metadata();
      expect(Math.max(metadata.width!, metadata.height!)).toBe(2048);
    }
  });
  it('orients photos, strips metadata and never upscales', async () => {
    const original = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#112233' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await prepareResource('Rotated.jpg', original);
    expect(await sharp(result.data).metadata()).toMatchObject({ width: 1200, height: 800 });
    expect((await sharp(result.data).metadata()).exif).toBeUndefined();
    expect((await sharp(result.data).metadata()).orientation).toBeUndefined();
    const small = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#112233' } }).png().toBuffer();
    expect(await sharp((await prepareResource('Small.png', small)).data).metadata()).toMatchObject({ width: 8, height: 4 });
  });
  it('keeps already compact artwork when conversion would increase size', async () => {
    const pixels = Buffer.alloc(2400 * 1600 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 13 + Math.floor(i / 71)) % 256;
    const original = await sharp(pixels, { raw: { width: 2400, height: 1600, channels: 3 } }).png().toBuffer();
    const result = await prepareResource('Artwork.png', original);
    expect(result.data.length).toBeLessThanOrEqual(original.length);
    if (result.contentType === 'image/png') { expect(result.name).toBe('Artwork.png'); expect(result.data).toBe(original); }
  });
  it('preserves transparency and animated frames/timing', async () => {
    const frame = () => sharp(randomBytes(80 * 60 * 4), { raw: { width: 80, height: 60, channels: 4 } }).png().toBuffer();
    const original = await sharp([await frame(), await frame()], { join: { animated: true } }).gif({ delay: [100, 200], loop: 2 }).toBuffer();
    const result = await prepareResource('Animation.gif', original);
    expect(await sharp(result.data, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [100, 200], loop: 2 });
    const transparent = await frame();
    expect((await sharp((await prepareResource('Transparent.png', transparent)).data).metadata()).hasAlpha).toBe(true);
  });
  it('bounds frames, decoded pixels and concurrent processing, releasing slots after errors', async () => {
    const frames = await Promise.all(Array.from({ length: 101 }, () => sharp(randomBytes(4 * 4 * 3), { raw: { width: 4, height: 4, channels: 3 } }).png().toBuffer()));
    const accepted = await sharp(frames.slice(0, 100), { join: { animated: true } }).gif().toBuffer();
    await expect(prepareResource('Accepted.gif', accepted)).resolves.toMatchObject({ data: expect.any(Buffer) });
    const rejected = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
    await expect(prepareResource('Too-many-frames.gif', rejected)).rejects.toMatchObject({ status: 400 });
    const huge = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#123456' } }).png().toBuffer();
    await expect(prepareResource('Huge.png', huge)).rejects.toMatchObject({ status: 400 });
    const first = prepareResource('One.gif', accepted), second = prepareResource('Two.gif', accepted);
    await expect(prepareResource('Three.gif', accepted)).rejects.toMatchObject({ status: 503 });
    await Promise.all([first, second]);
    await expect(prepareResource('Corrupt.jpg', Buffer.from('bad'))).rejects.toMatchObject({ status: 400 });
    await expect(prepareResource('Another.gif', accepted)).resolves.toMatchObject({ data: expect.any(Buffer) });
  });
  it('rejects images with mismatched extensions or corrupted contents', async () => {
    const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#123456' } }).png().toBuffer();
    await expect(prepareResource('Wrong.jpg', png)).rejects.toMatchObject({ status: 400 });
    await expect(prepareResource('Corrupt.jpg', Buffer.from([0xff, 0xd8, 0xff, 0]))).rejects.toMatchObject({ status: 400 });
  });
  it('leaves documents, text and media bytes/names unchanged', async () => {
    const data = Buffer.from('document');
    for (const name of ['Worksheet.pdf', 'Instructions.docx', 'Data.csv', 'Clip.mp4', 'Audio.mp3']) {
      expect(await prepareResource(name, data)).toEqual({ name, data, contentType: 'application/octet-stream' });
    }
  });
});
