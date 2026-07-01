<script lang="ts">
  import type { WorkbenchView } from "../../types/app";

  export let view: WorkbenchView;
</script>

<section class="main-workspace" aria-label={view.title}>
  <div class="metric-row">
    {#each view.metrics as metric}
      <div class="metric">
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
      </div>
    {/each}
  </div>

  <div class="work-list">
    {#each view.primaryItems as item}
      <article class="work-row">
        <div>
          <h3>{item.title}</h3>
          <p>{item.meta}</p>
        </div>
        <span>{item.status}</span>
      </article>
    {/each}
  </div>
</section>
