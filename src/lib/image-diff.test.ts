import { describe, expect, it } from "vitest";
import {
  clampImageScale,
  comparePixelBuffers,
  createImageViewportTransform,
  formatByteSize,
  formatChangedPixelSummary,
  formatImageDimensions,
  formatImageScale,
  hasImageDiffPayload,
  imageDataUrl,
  imageViewportStyle,
  isPreviewableImagePath,
  panImageViewport,
  zoomImageViewport,
  IMAGE_DIFF_MAX_SCALE,
  IMAGE_DIFF_MIN_SCALE,
} from "./image-diff";

function solidPixels(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  }
  return data;
}

describe("image-diff helpers", () => {
  it("detects previewable image paths and payloads", () => {
    expect(isPreviewableImagePath("assets/logo.PNG")).toBe(true);
    expect(isPreviewableImagePath("shot.webp")).toBe(true);
    expect(isPreviewableImagePath("notes.svg")).toBe(false);
    expect(hasImageDiffPayload({ is_image: true })).toBe(true);
    expect(hasImageDiffPayload({ is_image: false })).toBe(false);
    expect(hasImageDiffPayload(null)).toBe(false);
  });

  it("builds data urls and formats summaries", () => {
    expect(imageDataUrl("image/png", "abc")).toBe("data:image/png;base64,abc");
    expect(imageDataUrl(null, null)).toBeNull();
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(2048)).toBe("2.0 KB");
    expect(formatByteSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatImageDimensions(null)).toBe("无");
    expect(formatImageDimensions({ width: 16, height: 9 })).toBe("16×9");
    expect(formatChangedPixelSummary(null)).toBe("无像素差异");
  });

  it("counts zero changed pixels for identical buffers", () => {
    const original = solidPixels(2, 2, [10, 20, 30, 255]);
    const modified = solidPixels(2, 2, [10, 20, 30, 255]);
    const result = comparePixelBuffers(original, modified, 2, 2);
    expect(result.changedPixels).toBe(0);
    expect(result.totalPixels).toBe(4);
    expect(formatChangedPixelSummary(result)).toBe("0 / 4（0.00%）");
  });

  it("counts changed pixels and marks scaled comparisons", () => {
    const original = solidPixels(2, 1, [0, 0, 0, 255]);
    const modified = solidPixels(2, 1, [255, 0, 0, 255]);
    modified[0] = 0;
    modified[1] = 0;
    modified[2] = 0;
    const result = comparePixelBuffers(original, modified, 2, 1, 0.5);
    expect(result.changedPixels).toBe(1);
    expect(result.scaled).toBe(true);
    expect(formatChangedPixelSummary(result)).toBe("1 / 2（50.00%）");
  });

  it("zooms and pans the shared image viewport", () => {
    const initial = createImageViewportTransform();
    expect(formatImageScale(initial.scale)).toBe("100%");
    expect(imageViewportStyle(initial)).toContain("scale(1)");

    const zoomed = zoomImageViewport(initial, 2, 10, 20);
    expect(zoomed.scale).toBe(2);
    expect(zoomed.offsetX).toBe(10 - (10 - 0) * 2);
    expect(zoomed.offsetY).toBe(20 - (20 - 0) * 2);

    const panned = panImageViewport(zoomed, 5, -3);
    expect(panned).toEqual({ scale: 2, offsetX: zoomed.offsetX + 5, offsetY: zoomed.offsetY - 3 });

    expect(clampImageScale(0.001)).toBe(IMAGE_DIFF_MIN_SCALE);
    expect(clampImageScale(999)).toBe(IMAGE_DIFF_MAX_SCALE);
    expect(zoomImageViewport({ scale: IMAGE_DIFF_MAX_SCALE, offsetX: 0, offsetY: 0 }, 2)).toEqual({
      scale: IMAGE_DIFF_MAX_SCALE,
      offsetX: 0,
      offsetY: 0,
    });
  });
});
