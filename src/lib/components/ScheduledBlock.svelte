<script>
  import { draggableBlock } from '../dnd.js';
  import { unscheduleTask } from '../../stores/tasks.svelte.js';

  let { block, task, leftPct, widthPct, zIndex = 1, overlapOffset = 0 } = $props();
</script>

<div
  class="task-block"
  style="
    left: {leftPct}%;
    width: {widthPct}%;
    z-index: {zIndex};
    top: {4 + overlapOffset}px;
    bottom: {4}px;
    height: auto;
  "
  use:draggableBlock={{ taskId: task.id, block }}
  title="{task.description} ({task.estimatedMinutes}m)"
>
  <span class="block-label">{task.description}</span>
  {#if block.totalParts > 1}
    <span style="font-size:9px;opacity:0.8">{block.partIndex}/{block.totalParts}</span>
  {/if}
  <button
    class="block-unschedule"
    title="Remove from schedule"
    onclick={(e) => { e.stopPropagation(); unscheduleTask(task.id); }}
  >×</button>
</div>
