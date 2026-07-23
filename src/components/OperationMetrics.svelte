<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Task } from "../types/api";

  export let task: Task | null = null;
  export let total = 0;
  export let label = "总量";
  export let active = false;

  let now = Date.now();
  let timer: number | null = null;
  $: if (active && timer === null) timer = window.setInterval(() => (now = Date.now()), 500);
  $: if (!active && timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  $: elapsedMs = task ? Math.max(0, (active ? now : task.updated_at) - task.created_at) : 0;
  $: elapsedSeconds = elapsedMs / 1000;
  $: rate = elapsedSeconds > 0 ? total / elapsedSeconds : 0;

  onDestroy(() => {
    if (timer !== null) window.clearInterval(timer);
  });

  function formatElapsed(seconds: number) {
    const whole = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = whole % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
      : `${minutes}:${String(rest).padStart(2, "0")}`;
  }
</script>

<div class="operation-metrics" aria-label="操作指标">
  <span>用时 <strong>{formatElapsed(elapsedSeconds)}</strong></span>
  <span>当前速度 <strong>{rate.toFixed(rate >= 10 ? 0 : 1)} 项/秒</strong></span>
  <span>{label} <strong>{total}</strong></span>
</div>

<style>
  .operation-metrics { display: flex; flex-wrap: wrap; gap: 12px; color: var(--secondary, #687482); font-size: 12px; }
  .operation-metrics strong { color: var(--text, #17202a); font-variant-numeric: tabular-nums; }
</style>
