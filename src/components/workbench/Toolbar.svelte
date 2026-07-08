<script lang="ts">
  export let title = "";
  export let subtitle = "";
  export let onPing: () => void;
  export let onPreviewError: () => void;
</script>

<header class="toolbar">
  <div class="toolbar-title">
    <h2>{title}</h2>
    <p>{subtitle}</p>
  </div>
  <div class="toolbar-actions">
    <button type="button" on:click={onPing} title="连接后端">
      <span aria-hidden="true">↻</span>
      连接后端
    </button>
    <button type="button" on:click={onPreviewError} title="验证错误展示">
      <span aria-hidden="true">!</span>
      验证错误
    </button>
  </div>
</header>
