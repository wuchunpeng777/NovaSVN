<script lang="ts">
  import { onDestroy } from "svelte";
  import { tokenizeCodeLine, type SyntaxToken } from "../lib/monaco-syntax";

  export let content = "";
  export let language = "plaintext";
  export let title: string | undefined = undefined;
  export let theme: "light" | "dark" = "light";

  let tokens: SyntaxToken[] | null = null;
  let requestGeneration = 0;

  $: {
    const generation = ++requestGeneration;
    tokens = null;
    void tokenizeCodeLine(content, language).then((result) => {
      if (generation === requestGeneration) {
        tokens = result;
      }
    });
  }

  onDestroy(() => {
    requestGeneration += 1;
  });
</script>

<code class="syntax-highlighted-code" data-theme={theme} {title}>
  {#if tokens && tokens.length > 0}
    {#each tokens as token}
      <span class={`syntax-token syntax-${token.kind}`}>{token.text}</span>
    {/each}
  {:else}
    {content || " "}
  {/if}
</code>

<style>
  .syntax-highlighted-code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }

  .syntax-token {
    color: inherit;
  }

  .syntax-keyword {
    color: #8b3f9c;
  }

  .syntax-string {
    color: #9a5b00;
  }

  .syntax-number {
    color: #176d8d;
  }

  .syntax-comment {
    color: #6f7d88;
    font-style: italic;
  }

  .syntax-type,
  .syntax-tag {
    color: #1d5f9f;
  }

  .syntax-attribute {
    color: #7a4f1f;
  }

  .syntax-operator {
    color: #485563;
  }

  .syntax-highlighted-code[data-theme="dark"] .syntax-keyword {
    color: #d9a8e5;
  }

  .syntax-highlighted-code[data-theme="dark"] .syntax-string {
    color: #e4bd7b;
  }

  .syntax-highlighted-code[data-theme="dark"] .syntax-number {
    color: #89d4ed;
  }

  .syntax-highlighted-code[data-theme="dark"] .syntax-comment {
    color: #87939e;
  }

  .syntax-highlighted-code[data-theme="dark"] .syntax-type,
  .syntax-highlighted-code[data-theme="dark"] .syntax-tag {
    color: #8fc2f4;
  }

  .syntax-highlighted-code[data-theme="dark"] .syntax-attribute {
    color: #e2c08d;
  }

  .syntax-highlighted-code[data-theme="dark"] .syntax-operator {
    color: #c3ccd5;
  }
</style>
