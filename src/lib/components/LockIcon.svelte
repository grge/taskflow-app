<script>
  // A monochrome padlock that inherits `currentColor` (like the app's other
  // glyph icons). Locked → closed shackle + filled body; unlocked → shackle
  // unhooked and swung clear of a hollow body. Callers style state via `color`.
  let { locked = false, size = 13 } = $props();
</script>

{#if locked}
  <!-- Closed padlock: shackle down, body filled -->
  <svg class="lock-icon" width={size} height={size} viewBox="0 0 24 24"
    fill="currentColor" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path fill="none" d="M7 10V7a5 5 0 0 1 10 0v3" />
    <rect x="4" y="10" width="16" height="11" rx="2" />
  </svg>
{:else}
  <!-- Open padlock: shackle unhooked — only the left leg meets the body, the
       arc swings up and away leaving clear daylight above the lock body. -->
  <svg class="lock-icon" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 10V6a5 5 0 0 1 9.6-1.9" />
    <rect x="4" y="10" width="16" height="11" rx="2" />
  </svg>
{/if}

<style>
  .lock-icon {
    display: block;
  }
</style>
