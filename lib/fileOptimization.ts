import sharp from "sharp";

const MIN_OPTIMIZE_BYTES = 500 * 1024;
const MAX_IMAGE_WIDTH = 1600;

type OptimizeResult = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  originalSize: number;
  optimizedSize: number;
  optimized: boolean;
};

function isOptimizableImage(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  return (
    normalized === "image/jpeg" ||
    normalized === "image/jpg" ||
    normalized === "image/png"
  );
}

function logOptimization(result: OptimizeResult) {
  if (!result.optimized) return;

  const savings =
    result.originalSize > 0
      ? ((result.originalSize - result.optimizedSize) / result.originalSize) * 100
      : 0;

  console.log(
    `[File Optimization] Original Size: ${result.originalSize} bytes, ` +
      `Compressed Size: ${result.optimizedSize} bytes, ` +
      `Savings: ${savings.toFixed(2)}%`,
  );
}

export async function optimizeUploadFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<OptimizeResult> {
  const original = {
    buffer,
    mimeType,
    fileName,
    originalSize: buffer.length,
    optimizedSize: buffer.length,
    optimized: false,
  };

  try {
    if (buffer.length < MIN_OPTIMIZE_BYTES || !isOptimizableImage(mimeType)) {
      return original;
    }

    const normalizedMimeType = mimeType.toLowerCase();
    const pipeline = sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: MAX_IMAGE_WIDTH,
        withoutEnlargement: true,
      });

    const optimizedBuffer =
      normalizedMimeType === "image/png"
        ? await pipeline
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer()
        : await pipeline.jpeg({ quality: 78, mozjpeg: true }).toBuffer();

    if (optimizedBuffer.length >= buffer.length) {
      return original;
    }

    const result = {
      buffer: optimizedBuffer,
      mimeType:
        normalizedMimeType === "image/jpg" ? "image/jpeg" : normalizedMimeType,
      fileName,
      originalSize: buffer.length,
      optimizedSize: optimizedBuffer.length,
      optimized: true,
    };

    logOptimization(result);
    return result;
  } catch (error) {
    console.error("[File Optimization] Failed, using original file.", error);
    return original;
  }
}
