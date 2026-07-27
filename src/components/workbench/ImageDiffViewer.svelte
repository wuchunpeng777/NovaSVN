<script lang="ts">
  import { onDestroy } from "svelte";
  import type { FileContentDiff } from "../../types/api";
  import {
    compareImagePixels,
    formatByteSize,
    formatChangedPixelSummary,
    formatImageDimensions,
    imageDataUrl,
    loadImageFromDataUrl,
    type ImageDimensions,
    type ImagePixelDiffResult,
  } from "../../lib/image-diff";

  export let contentDiff: FileContentDiff | null = null;

  type ViewMode = "side-by-side" | "diff";

  let viewMode: ViewMode = "side-by-side";
  let loading = false;
  let decodeError: string | null = null;
  let originalUrl: string | null = null;
  let modifiedUrl: string | null = null;
  let originalImage: HTMLImageElement | null = null;
  let modifiedImage: HTMLImageElement | null = null;
  let originalDimensions: ImageDimensions | null = null;
  let modifiedDimensions: ImageDimensions | null = null;
  let pixelDiff: ImagePixelDiffResult | null = null;
  let diffCanvas: HTMLCanvasElement | null = null;
  let loadToken = 0;

  $: loadPayload(contentDiff);

  $: if (diffCanvas && pixelDiff) {
    const context = diffCanvas.getContext("2d");
    if (context) {
      diffCanvas.width = pixelDiff.width;
      diffCanvas.height = pixelDiff.height;
      context.putImageData(pixelDiff.diffImageData, 0, 0);
    }
  }

  onDestroy(() => {
    loadToken += 1;
  });

  async function loadPayload(diff: FileContentDiff | null) {
    const token = ++loadToken;
    originalImage = null;
    modifiedImage = null;
    originalDimensions = null;
    modifiedDimensions = null;
    pixelDiff = null;
    decodeError = null;
    originalUrl = null;
    modifiedUrl = null;

    if (!diff?.is_image) {
      loading = false;
      return;
    }

    loading = true;
    const nextOriginalUrl = imageDataUrl(diff.image_mime, diff.original_bytes_base64);
    const nextModifiedUrl = imageDataUrl(diff.image_mime, diff.modified_bytes_base64);
    originalUrl = nextOriginalUrl;
    modifiedUrl = nextModifiedUrl;

    try {
      const [original, modified] = await Promise.all([
        nextOriginalUrl ? loadImageFromDataUrl(nextOriginalUrl) : Promise.resolve(null),
        nextModifiedUrl ? loadImageFromDataUrl(nextModifiedUrl) : Promise.resolve(null),
      ]);
      if (token !== loadToken) {
        return;
      }
      originalImage = original;
      modifiedImage = modified;
      originalDimensions = original
        ? { width: original.naturalWidth, height: original.naturalHeight }
        : null;
      modifiedDimensions = modified
        ? { width: modified.naturalWidth, height: modified.naturalHeight }
        : null;
      pixelDiff = compareImagePixels(original, modified);
      if (!original && !modified) {
        decodeError = "没有可预览的图片内容";
      }
    } catch (error) {
      if (token !== loadToken) {
        return;
      }
      decodeError = error instanceof Error ? error.message : "图片解码失败";
    } finally {
      if (token === loadToken) {
        loading = false;
      }
    }
  }

  function dimensionChanged(a: ImageDimensions | null, b: ImageDimensions | null): boolean {
    if (!a || !b) {
      return Boolean(a || b);
    }
    return a.width !== b.width || a.height !== b.height;
  }
</script>

{#if contentDiff?.is_image}
  <div class="image-diff-viewer" data-testid="image-diff-viewer">
    <div class="image-diff-summary" role="status">
      <span>旧：{formatByteSize(contentDiff.original_byte_size)} · {formatImageDimensions(originalDimensions)}</span>
      <span>新：{formatByteSize(contentDiff.modified_byte_size)} · {formatImageDimensions(modifiedDimensions)}</span>
      <span>
        尺寸：{dimensionChanged(originalDimensions, modifiedDimensions) ? "已变化" : "相同"}
      </span>
      <span>差异像素：{formatChangedPixelSummary(pixelDiff)}</span>
      {#if pixelDiff?.scaled}
        <span>已缩放比较（最大边 {pixelDiff.width}×{pixelDiff.height}）</span>
      {/if}
    </div>

    <div class="image-diff-toolbar" role="toolbar" aria-label="图片 Diff 视图">
      <button type="button" class:active={viewMode === "side-by-side"} on:click={() => (viewMode = "side-by-side")}>
        并排
      </button>
      <button type="button" class:active={viewMode === "diff"} on:click={() => (viewMode = "diff")}>
        差异
      </button>
    </div>

    {#if loading}
      <div class="image-diff-empty" role="status">正在解码图片...</div>
    {:else if decodeError}
      <div class="image-diff-empty" role="alert">{decodeError}</div>
    {:else if viewMode === "side-by-side"}
      <div class="image-diff-side-by-side">
        <figure>
          <figcaption>旧版本</figcaption>
          {#if originalUrl && originalImage}
            <img src={originalUrl} alt="旧版本图片" />
          {:else}
            <div class="image-diff-placeholder">无旧版本</div>
          {/if}
        </figure>
        <figure>
          <figcaption>新版本</figcaption>
          {#if modifiedUrl && modifiedImage}
            <img src={modifiedUrl} alt="新版本图片" />
          {:else}
            <div class="image-diff-placeholder">无新版本</div>
          {/if}
        </figure>
      </div>
    {:else}
      <div class="image-diff-pixel">
        {#if pixelDiff}
          <canvas bind:this={diffCanvas} aria-label="像素差异图"></canvas>
        {:else}
          <div class="image-diff-empty">无法生成像素差异</div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .image-diff-viewer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    height: 100%;
  }

  .image-diff-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    padding: 8px 10px;
    border: 1px solid var(--border, #ccd3da);
    border-radius: 8px;
    background: var(--subtle, #f0f2f4);
    color: var(--secondary, #66727e);
    font-size: 12px;
  }

  .image-diff-toolbar {
    display: inline-flex;
    gap: 4px;
    width: fit-content;
    padding: 3px;
    border: 1px solid var(--border, #ccd3da);
    border-radius: 8px;
    background: var(--panel, #fff);
  }

  .image-diff-toolbar button {
    border: 0;
    border-radius: 6px;
    padding: 4px 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .image-diff-toolbar button.active {
    background: var(--accent, #2674b9);
    color: #fff;
  }

  .image-diff-side-by-side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    min-height: 0;
    flex: 1;
  }

  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }

  figcaption {
    font-size: 12px;
    color: var(--secondary, #66727e);
  }

  img,
  canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    background:
      linear-gradient(45deg, #d8dde3 25%, transparent 25%) 0 0 / 16px 16px,
      linear-gradient(-45deg, #d8dde3 25%, transparent 25%) 0 8px / 16px 16px,
      linear-gradient(45deg, transparent 75%, #d8dde3 75%) 8px -8px / 16px 16px,
      linear-gradient(-45deg, transparent 75%, #d8dde3 75%) -8px 0 / 16px 16px;
    background-color: #f7f8fa;
    border: 1px solid var(--border, #ccd3da);
    border-radius: 8px;
  }

  .image-diff-pixel {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .image-diff-placeholder,
  .image-diff-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 160px;
    border: 1px dashed var(--border, #ccd3da);
    border-radius: 8px;
    color: var(--secondary, #66727e);
    background: var(--subtle, #f0f2f4);
    font-size: 13px;
  }

  @media (max-width: 900px) {
    .image-diff-side-by-side {
      grid-template-columns: 1fr;
    }
  }
</style>
