import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileContentDiff } from "../../types/api";

const loadImageFromDataUrl = vi.fn();
const compareImagePixels = vi.fn();

vi.mock("../../lib/image-diff", async () => {
  const actual = await vi.importActual<typeof import("../../lib/image-diff")>("../../lib/image-diff");
  return {
    ...actual,
    loadImageFromDataUrl: (...args: unknown[]) => loadImageFromDataUrl(...args),
    compareImagePixels: (...args: unknown[]) => compareImagePixels(...args),
  };
});

import ImageDiffViewer from "./ImageDiffViewer.svelte";

function makeImage(width: number, height: number): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperty(image, "naturalWidth", { value: width });
  Object.defineProperty(image, "naturalHeight", { value: height });
  return image;
}

const imageDiff: FileContentDiff = {
  path: "assets/logo.png",
  original_text: "",
  modified_text: "",
  language: "plaintext",
  binary: true,
  too_large: false,
  max_bytes: 20 * 1024 * 1024,
  is_image: true,
  image_mime: "image/png",
  original_bytes_base64: "AAAA",
  modified_bytes_base64: "BBBB",
  original_byte_size: 1200,
  modified_byte_size: 1400,
};

describe("ImageDiffViewer", () => {
  beforeEach(() => {
    loadImageFromDataUrl.mockReset();
    compareImagePixels.mockReset();
    loadImageFromDataUrl.mockImplementation(async (url: string) => {
      if (url.includes("AAAA")) {
        return makeImage(16, 16);
      }
      return makeImage(32, 24);
    });
    compareImagePixels.mockReturnValue({
      width: 32,
      height: 24,
      changedPixels: 12,
      totalPixels: 768,
      changedRatio: 12 / 768,
      scaled: false,
      scale: 1,
      diffImageData: {
        data: new Uint8ClampedArray(32 * 24 * 4),
        width: 32,
        height: 24,
        colorSpace: "srgb",
      } as ImageData,
    });
  });

  it("renders size summary and side-by-side images", async () => {
    render(ImageDiffViewer, { props: { contentDiff: imageDiff } });

    await waitFor(() => expect(screen.getByTestId("image-diff-viewer")).toBeInTheDocument());
    expect(screen.getByText(/旧：1\.2 KB · 16×16/)).toBeInTheDocument();
    expect(screen.getByText(/新：1\.4 KB · 32×24/)).toBeInTheDocument();
    expect(screen.getByText(/尺寸：已变化/)).toBeInTheDocument();
    expect(screen.getByText(/差异像素：12 \/ 768/)).toBeInTheDocument();
    expect(screen.getByAltText("旧版本图片")).toBeInTheDocument();
    expect(screen.getByAltText("新版本图片")).toBeInTheDocument();
  });

  it("switches to pixel difference view", async () => {
    render(ImageDiffViewer, { props: { contentDiff: imageDiff } });
    await waitFor(() => expect(screen.getByRole("button", { name: "差异" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "差异" }));
    expect(screen.getByLabelText("像素差异图")).toBeInTheDocument();
  });

  it("supports wheel zoom, drag pan, and reset", async () => {
    render(ImageDiffViewer, { props: { contentDiff: imageDiff } });
    await waitFor(() => expect(screen.getByTestId("image-diff-viewport-original")).toBeInTheDocument());

    const viewport = screen.getByTestId("image-diff-viewport-original");
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
        right: 200,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    await fireEvent.wheel(viewport, { deltaY: -100, clientX: 100, clientY: 100 });
    expect(screen.getByTestId("image-diff-zoom").textContent).not.toBe("100%");

    await fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    await fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 70, clientY: 80 });
    await fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 70, clientY: 80 });

    const stage = viewport.querySelector(".image-diff-stage") as HTMLElement;
    expect(stage.getAttribute("style")).toContain("translate(");
    expect(stage.getAttribute("style")).not.toContain("translate(0px, 0px) scale(1)");

    await fireEvent.click(screen.getByRole("button", { name: "重置视图" }));
    expect(screen.getByTestId("image-diff-zoom")).toHaveTextContent("100%");
    expect(stage.getAttribute("style")).toContain("translate(0px, 0px) scale(1)");
  });

  it("shows decode errors without falling back to text diff", async () => {
    loadImageFromDataUrl.mockRejectedValue(new Error("图片解码失败"));
    render(ImageDiffViewer, { props: { contentDiff: imageDiff } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("图片解码失败"));
  });
});
