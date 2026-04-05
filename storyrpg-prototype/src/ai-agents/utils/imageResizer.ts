/**
 * Image resizing utility for Anthropic vision API compliance.
 *
 * Anthropic multi-image requests require each image dimension <= 2000px
 * and total payload <= ~20MB. This module downsizes base64 images to
 * stay within those limits using sharp (runs in Node worker process only).
 *
 * When running inside Metro (React Native), sharp is unavailable and
 * images are returned unchanged — the validator only runs server-side
 * anyway, so this is safe.
 */

type SharpInstance = {
  metadata(): Promise<{ width?: number; height?: number }>;
  extract(opts: Record<string, unknown>): SharpInstance;
  resize(opts: Record<string, unknown>): SharpInstance;
  jpeg(opts: Record<string, unknown>): SharpInstance;
  toBuffer(): Promise<Buffer>;
};
type SharpFn = (input: Buffer) => SharpInstance;

let _sharp: SharpFn | null = null;
let _sharpLoaded = false;

function getSharp(): SharpFn | null {
  if (_sharpLoaded) return _sharp;
  _sharpLoaded = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('sharp');
    if (typeof loaded === 'function') {
      _sharp = loaded as SharpFn;
    }
  } catch {
    _sharp = null;
  }
  return _sharp;
}

const MAX_DIMENSION = 1500; // conservative margin below 2000px limit
const MAX_SINGLE_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB per image after resize
const MAX_TOTAL_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15MB total

export interface ResizedImage {
  data: string;       // base64 string
  mimeType: string;   // e.g. 'image/png'
}

export interface FaceCropOptions {
  mode?: 'front' | 'three-quarter' | 'profile' | 'generic';
  outputSize?: number;
}

/**
 * Downscale a single base64 image so neither dimension exceeds MAX_DIMENSION
 * and the encoded size stays under MAX_SINGLE_IMAGE_BYTES.
 * Returns the original image unchanged if sharp is unavailable.
 */
export async function downsampleBase64Image(
  base64Data: string,
  mimeType: string
): Promise<ResizedImage> {
  const sharp = getSharp();
  if (!sharp) {
    return { data: base64Data, mimeType };
  }

  try {
    const inputBuffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(inputBuffer).metadata();
    const { width = 0, height = 0 } = metadata;

    const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;
    const needsShrink = inputBuffer.length > MAX_SINGLE_IMAGE_BYTES;

    if (!needsResize && !needsShrink) {
      return { data: base64Data, mimeType };
    }

    let pipeline = sharp(inputBuffer);

    if (needsResize) {
      pipeline = pipeline.resize({
        width: width > height ? MAX_DIMENSION : undefined,
        height: height >= width ? MAX_DIMENSION : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const outputBuffer = await pipeline
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

    if (outputBuffer.length > MAX_SINGLE_IMAGE_BYTES) {
      const smallerBuffer = await sharp(inputBuffer)
        .resize({
          width: Math.min(width, 1000),
          height: Math.min(height, 1000),
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 60, mozjpeg: true })
        .toBuffer();

      return {
        data: smallerBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    }

    return {
      data: outputBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    };
  } catch (err) {
    console.warn(`[imageResizer] Failed to downscale image (${mimeType}, ${Math.round(base64Data.length / 1024)}KB), returning original:`, err);
    return { data: base64Data, mimeType };
  }
}

/**
 * Derive a face-focused crop from a centered full-body character reference.
 * These references are authored as studio sheets with the character centered,
 * so a deterministic upper-center crop is a strong identity anchor for
 * expression close-ups.
 */
export async function extractReferenceFaceCrop(
  base64Data: string,
  mimeType: string,
  options: FaceCropOptions = {},
): Promise<ResizedImage> {
  const sharp = getSharp();
  if (!sharp) {
    return { data: base64Data, mimeType };
  }

  try {
    const inputBuffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(inputBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (!width || !height) {
      return { data: base64Data, mimeType };
    }

    const mode = options.mode || 'generic';
    const outputSize = options.outputSize || 1024;

    const cropPresets: Record<NonNullable<FaceCropOptions['mode']>, { left: number; top: number; width: number; height: number }> = {
      front: { left: 0.23, top: 0.04, width: 0.54, height: 0.36 },
      'three-quarter': { left: 0.21, top: 0.04, width: 0.58, height: 0.37 },
      profile: { left: 0.19, top: 0.04, width: 0.62, height: 0.37 },
      generic: { left: 0.22, top: 0.04, width: 0.56, height: 0.36 },
    };

    const preset = cropPresets[mode];
    const extractWidth = Math.max(1, Math.min(width, Math.round(width * preset.width)));
    const extractHeight = Math.max(1, Math.min(height, Math.round(height * preset.height)));
    const left = Math.max(0, Math.min(width - extractWidth, Math.round(width * preset.left)));
    const top = Math.max(0, Math.min(height - extractHeight, Math.round(height * preset.top)));

    const outputBuffer = await sharp(inputBuffer)
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .resize({
        width: outputSize,
        height: outputSize,
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: false,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    return {
      data: outputBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    };
  } catch (err) {
    console.warn('[imageResizer] Failed to derive face crop, returning original image:', err);
    return { data: base64Data, mimeType };
  }
}

/**
 * Downscale a batch of base64 images for Anthropic vision API.
 * Ensures total payload stays under MAX_TOTAL_PAYLOAD_BYTES by
 * progressively reducing quality or dropping images if necessary.
 */
export async function downsampleBatch(
  images: Array<{ data: string; mimeType: string; shotId: string }>
): Promise<Array<{ data: string; mimeType: string; shotId: string }>> {
  const resized: Array<{ data: string; mimeType: string; shotId: string }> = [];
  let totalBytes = 0;

  for (const img of images) {
    const result = await downsampleBase64Image(img.data, img.mimeType);
    const imageBytes = Buffer.byteLength(result.data, 'base64');

    if (totalBytes + imageBytes > MAX_TOTAL_PAYLOAD_BYTES) {
      console.warn(
        `[imageResizer] Payload budget exhausted after ${resized.length}/${images.length} images ` +
        `(${Math.round(totalBytes / 1024 / 1024)}MB). Stopping batch.`
      );
      break;
    }

    resized.push({ ...img, data: result.data, mimeType: result.mimeType });
    totalBytes += imageBytes;
  }

  return resized;
}
