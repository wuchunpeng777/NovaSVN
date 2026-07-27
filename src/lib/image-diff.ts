import type { FileContentDiff, MergePreviewFileContent } from "../types/api";

export const IMAGE_DIFF_MAX_COMPARE_EDGE = 2048;
export const IMAGE_DIFF_MIN_SCALE = 0.1;
export const IMAGE_DIFF_MAX_SCALE = 16;
export const IMAGE_DIFF_ZOOM_FACTOR = 1.12;

export interface ImageViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function createImageViewportTransform(): ImageViewportTransform {
  return {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

export function clampImageScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(IMAGE_DIFF_MAX_SCALE, Math.max(IMAGE_DIFF_MIN_SCALE, scale));
}

export function zoomImageViewport(
  current: ImageViewportTransform,
  factor: number,
  pivotX = 0,
  pivotY = 0,
): ImageViewportTransform {
  const nextScale = clampImageScale(current.scale * factor);
  if (nextScale === current.scale) {
    return current;
  }
  const ratio = nextScale / current.scale;
  return {
    scale: nextScale,
    offsetX: pivotX - (pivotX - current.offsetX) * ratio,
    offsetY: pivotY - (pivotY - current.offsetY) * ratio,
  };
}

export function panImageViewport(
  current: ImageViewportTransform,
  deltaX: number,
  deltaY: number,
): ImageViewportTransform {
  return {
    scale: current.scale,
    offsetX: current.offsetX + deltaX,
    offsetY: current.offsetY + deltaY,
  };
}

export function formatImageScale(scale: number): string {
  return `${Math.round(clampImageScale(scale) * 100)}%`;
}

export function imageViewportStyle(transform: ImageViewportTransform): string {
  return `transform: translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale});`;
}

export type ImageDiffPayload = Pick<
  FileContentDiff,
  | "path"
  | "is_image"
  | "image_mime"
  | "original_bytes_base64"
  | "modified_bytes_base64"
  | "original_byte_size"
  | "modified_byte_size"
  | "binary"
  | "too_large"
  | "max_bytes"
>;

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImagePixelDiffResult {
  width: number;
  height: number;
  changedPixels: number;
  totalPixels: number;
  changedRatio: number;
  scaled: boolean;
  scale: number;
  diffImageData: ImageData;
}

const PREVIEWABLE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
]);

export function isPreviewableImagePath(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return PREVIEWABLE_EXTENSIONS.has(extension);
}

export function hasImageDiffPayload(
  diff: Pick<FileContentDiff, "is_image"> | Pick<MergePreviewFileContent, "is_image"> | null | undefined,
): boolean {
  return Boolean(diff?.is_image);
}

export function imageDataUrl(mime: string | null | undefined, base64: string | null | undefined): string | null {
  if (!base64) {
    return null;
  }
  return `data:${mime || "application/octet-stream"};base64,${base64}`;
}

export function formatByteSize(bytes: number | null | undefined): string {
  const value = Math.max(0, bytes ?? 0);
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

export function formatImageDimensions(dimensions: ImageDimensions | null): string {
  if (!dimensions) {
    return "无";
  }
  return `${dimensions.width}×${dimensions.height}`;
}

export function formatChangedPixelSummary(result: ImagePixelDiffResult | null): string {
  if (!result || result.totalPixels === 0) {
    return "无像素差异";
  }
  const percent = (result.changedRatio * 100).toFixed(result.changedRatio > 0 && result.changedRatio < 0.001 ? 3 : 2);
  return `${result.changedPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()}（${percent}%）`;
}

export function loadImageFromDataUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = url;
  });
}

export function compareImagePixels(
  original: HTMLImageElement | null,
  modified: HTMLImageElement | null,
  maxEdge = IMAGE_DIFF_MAX_COMPARE_EDGE,
): ImagePixelDiffResult | null {
  const originalWidth = original?.naturalWidth ?? 0;
  const originalHeight = original?.naturalHeight ?? 0;
  const modifiedWidth = modified?.naturalWidth ?? 0;
  const modifiedHeight = modified?.naturalHeight ?? 0;
  const sourceWidth = Math.max(originalWidth, modifiedWidth);
  const sourceHeight = Math.max(originalHeight, modifiedHeight);
  if (sourceWidth === 0 || sourceHeight === 0) {
    return null;
  }

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }

  const originalData = drawImageToSize(context, original, width, height, originalWidth, originalHeight, scale);
  const modifiedData = drawImageToSize(context, modified, width, height, modifiedWidth, modifiedHeight, scale);
  return comparePixelBuffers(originalData, modifiedData, width, height, scale);
}

export function comparePixelBuffers(
  originalData: Uint8ClampedArray,
  modifiedData: Uint8ClampedArray,
  width: number,
  height: number,
  scale = 1,
): ImagePixelDiffResult {
  const totalPixels = width * height;
  const diff = typeof ImageData === "function"
    ? new ImageData(width, height)
    : ({
        data: new Uint8ClampedArray(totalPixels * 4),
        width,
        height,
        colorSpace: "srgb",
      } as ImageData);
  let changedPixels = 0;

  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    const same =
      originalData[offset] === modifiedData[offset] &&
      originalData[offset + 1] === modifiedData[offset + 1] &&
      originalData[offset + 2] === modifiedData[offset + 2] &&
      originalData[offset + 3] === modifiedData[offset + 3];
    if (same) {
      const gray = Math.round(
        (originalData[offset] + originalData[offset + 1] + originalData[offset + 2]) / 3,
      );
      diff.data[offset] = gray;
      diff.data[offset + 1] = gray;
      diff.data[offset + 2] = gray;
      diff.data[offset + 3] = Math.max(40, Math.round(originalData[offset + 3] * 0.35));
    } else {
      changedPixels += 1;
      diff.data[offset] = 220;
      diff.data[offset + 1] = 40;
      diff.data[offset + 2] = 120;
      diff.data[offset + 3] = 255;
    }
  }

  return {
    width,
    height,
    changedPixels,
    totalPixels,
    changedRatio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
    scaled: scale < 1,
    scale,
    diffImageData: diff,
  };
}

function drawImageToSize(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  scale: number,
): Uint8ClampedArray {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  if (image && naturalWidth > 0 && naturalHeight > 0) {
    context.drawImage(
      image,
      0,
      0,
      Math.max(1, Math.round(naturalWidth * scale)),
      Math.max(1, Math.round(naturalHeight * scale)),
    );
  }
  return context.getImageData(0, 0, canvasWidth, canvasHeight).data;
}
