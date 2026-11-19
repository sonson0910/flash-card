/** Longest edge of an uploaded image after the browser resizes it. */
export const MAX_IMAGE_EDGE = 1600;
const WEBP_QUALITY = 0.86;

export interface ResizedImage {
  readonly blob: Blob;
  readonly contentType: 'image/webp' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

/** Scales a size down to fit `maxEdge` on its longest side, never up. */
export const fitWithin = (width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } => {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/** Swaps the extension for the one the encoded image really has. */
export const renameForType = (name: string, contentType: ResizedImage['contentType']): string => {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'image';
  return `${base}.${contentType === 'image/webp' ? 'webp' : 'jpg'}`;
};

export interface ImageCodec {
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close(): void }>;
  encode(source: CanvasImageSource, width: number, height: number, type: string, quality: number): Promise<Blob | null>;
}

const browserCodec: ImageCodec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  encode(source, width, height, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.drawImage(source, 0, 0, width, height);
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  },
};

/**
 * Decodes the chosen image, fits it within 1600 px and encodes it as WebP. Browsers that cannot
 * encode WebP hand back another type from `toBlob`; those images are sent as JPEG instead.
 */
export const resizeImageForUpload = async (file: Blob, codec: ImageCodec = browserCodec): Promise<ResizedImage> => {
  const decoded = await codec.decode(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height);
    const webp = await codec.encode(decoded.source, width, height, 'image/webp', WEBP_QUALITY);
    if (webp && webp.type === 'image/webp') return { blob: webp, contentType: 'image/webp', width, height };
    const jpeg = await codec.encode(decoded.source, width, height, 'image/jpeg', WEBP_QUALITY);
    if (jpeg && jpeg.type === 'image/jpeg') return { blob: jpeg, contentType: 'image/jpeg', width, height };
    throw new Error('The browser could not encode the image.');
  } finally {
    decoded.close();
  }
};
