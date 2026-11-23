import { describe, expect, it, vi } from 'vitest';
import { fitWithin, MAX_IMAGE_EDGE, renameForType, resizeImageForUpload, type ImageCodec } from './imageResize';

const codec = (encoded: Record<string, string | null>, size = { width: 4000, height: 3000 }) => {
  const close = vi.fn();
  const encode = vi.fn<ImageCodec['encode']>(async (_source, _width, _height, type) => {
    const actual = encoded[type];
    return actual === null || actual === undefined ? null : new Blob([new Uint8Array(8)], { type: actual });
  });
  const value: ImageCodec = { decode: async () => ({ ...size, source: {} as CanvasImageSource, close }), encode };
  return { value, encode, close };
};

describe('image resize', () => {
  it('fits the longest edge within 1600 px and never enlarges', () => {
    expect(MAX_IMAGE_EDGE).toBe(1600);
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(900, 3600)).toEqual({ width: 400, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('encodes WebP at the fitted size and releases the decoded image', async () => {
    const { value, encode, close } = codec({ 'image/webp': 'image/webp' });
    await expect(resizeImageForUpload(new Blob(), value)).resolves.toMatchObject({ contentType: 'image/webp', width: 1600, height: 1200 });
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1600, 1200, 'image/webp', expect.any(Number));
    expect(close).toHaveBeenCalledOnce();
  });

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    const { value } = codec({ 'image/webp': 'image/png', 'image/jpeg': 'image/jpeg' });
    await expect(resizeImageForUpload(new Blob(), value)).resolves.toMatchObject({ contentType: 'image/jpeg' });
  });

  it('fails when no encoder is available', async () => {
    const { value, close } = codec({ 'image/webp': null, 'image/jpeg': null });
    await expect(resizeImageForUpload(new Blob(), value)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });

  it('renames the file for the encoded type', () => {
    expect(renameForType('holiday.HEIC', 'image/webp')).toBe('holiday.webp');
    expect(renameForType('scan', 'image/jpeg')).toBe('scan.jpg');
    expect(renameForType('.png', 'image/webp')).toBe('image.webp');
  });
});
