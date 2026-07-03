<script lang="ts">
  export let title = "";
  export let subtitle = "";
  export let onPing: () => void;
  export let onPreviewError: () => void;
</script>

<header class="toolbar">
  <div>
    <h2>{title}</h2>
    <p>{subtitle}</p>
  </div>
  <div class="toolbar-actions">
    <button type="button" on:click={onPing}>后端自检</button>
    <button type="button" on:click={onPreviewError}>验证错误</button>
  </div>
</header>
