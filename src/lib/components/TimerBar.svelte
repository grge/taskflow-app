<script>
  import { activeTimer } from '../../stores/ui.svelte.js';
  import { tasks, pauseTimer, resumeTimer, finishTimer } from '../../stores/tasks.svelte.js';
  import { clock } from '../../stores/clock.svelte.js';

  let timer = $derived(activeTimer.value);
  let task = $derived(timer ? tasks.value.find(t => t.id === timer.taskId) : null);
  let isPaused = $derived(timer?.pausedAt != null);

  let elapsedSeconds = $derived(() => {
    if (!timer) return 0;
    const accumulated = timer.accumulatedSeconds ?? 0;
    if (isPaused) return accumulated;
    return accumulated + Math.floor((clock.now - new Date(timer.startedAt)) / 1000);
  });

  function formatElapsed(seconds) {
    const s = seconds % 60;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
</script>

{#if timer && task}
  <div class="timer-bar">
    <span class="timer-icon">▶</span>
    <span class="timer-task">{task.description}</span>
    <span class="timer-sep">—</span>
    <span class="timer-elapsed">{formatElapsed(elapsedSeconds())}</span>
    <div class="timer-actions">
      {#if isPaused}
        <button class="btn btn-ghost timer-btn" onclick={() => resumeTimer(timer.taskId)}>▶ Resume</button>
      {:else}
        <button class="btn btn-ghost timer-btn" onclick={() => pauseTimer(timer.taskId)}>⏸ Pause</button>
      {/if}
      <button class="btn btn-primary timer-btn" onclick={() => finishTimer(timer.taskId)}>⏹ Stop</button>
    </div>
  </div>
{/if}

<style>
  .timer-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 var(--spacing-md);
    height: 44px;
    background: #1a1a2e;
    color: white;
    flex-shrink: 0;
    border-top: 1px solid rgba(255,255,255,0.1);
  }

  .timer-icon {
    color: #4CAF50;
    font-size: 12px;
  }

  .timer-task {
    font-size: 14px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }

  .timer-sep {
    color: rgba(255,255,255,0.4);
  }

  .timer-elapsed {
    font-family: Menlo, Consolas, monospace;
    font-size: 14px;
    color: #4CAF50;
    min-width: 80px;
  }

  .timer-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }

  .timer-btn {
    font-size: 12px;
    padding: 4px 12px;
  }

  .timer-bar .btn-ghost {
    color: rgba(255, 255, 255, 0.85);
    border-color: rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.08);
  }

  .timer-bar .btn-ghost:hover {
    background: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.6);
    color: white;
  }
</style>
