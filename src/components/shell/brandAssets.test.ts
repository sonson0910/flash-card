import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const BRAND_ASSETS = [
  '../../../public/brand/sonflash-logo-source.png',
  '../../../public/brand/sonflash-logo.png',
  '../../../public/brand/sonflash-logo-320.png',
  '../../../public/brand/sonflash-logo-192.png',
  '../../../public/brand/sonflash-logo-180.png',
  '../../../public/favicon-192.png',
  '../../../public/favicon-32.png',
] as const;

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function filterPredictor(filter: number, left: number, above: number, upperLeft: number): number {
  switch (filter) {
    case 0: return 0;
    case 1: return left;
    case 2: return above;
    case 3: return Math.floor((left + above) / 2);
    case 4: return paethPredictor(left, above, upperLeft);
    default: throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function readRgbaPixels(file: URL): { width: number; height: number; pixels: Uint8Array } {
  const png = readFileSync(file);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  let offset = 8;
  let width = 0;
  let height = 0;
  const compressedChunks: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      expect(png[dataStart + 8]).toBe(8);
      expect(png[dataStart + 9]).toBe(6);
      expect(png[dataStart + 12]).toBe(0);
    } else if (type === 'IDAT') {
      compressedChunks.push(png.subarray(dataStart, dataStart + length));
    }
    offset = dataStart + length + 4;
  }

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressedChunks));
  const pixels = new Uint8Array(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x];
      const outputOffset = (y * stride) + x;
      const left = x >= bytesPerPixel ? pixels[outputOffset - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[outputOffset - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[outputOffset - stride - bytesPerPixel]
        : 0;
      const predictor = filterPredictor(filter, left, above, upperLeft);
      pixels[outputOffset] = (raw + predictor) & 0xff;
    }
    sourceOffset += stride;
  }
  return { width, height, pixels };
}

describe('SonFlash brand assets', () => {
  it.each(BRAND_ASSETS)('keeps %s transparent at every corner', (relativePath) => {
    const { width, height, pixels } = readRgbaPixels(new URL(relativePath, import.meta.url));
    const alphaAt = (x: number, y: number) => pixels[((y * width + x) * 4) + 3];

    expect([
      alphaAt(0, 0),
      alphaAt(width - 1, 0),
      alphaAt(0, height - 1),
      alphaAt(width - 1, height - 1),
    ]).toEqual([0, 0, 0, 0]);
    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });

  it('cache-busts the browser chrome after replacing the opaque artwork', () => {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

    expect(html).toContain('/favicon-32.png?v=3e7aaa58');
    expect(html).toContain('/favicon-192.png?v=3e7aaa58');
    expect(html).toContain('/brand/sonflash-logo-180.png?v=3e7aaa58');
  });
});
