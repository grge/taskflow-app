<script>
  import { tasks, autoScheduleAll, clearSchedule, unscheduleTask, editTask } from '../../stores/tasks.svelte.js';
  import { workSchedule, fixedBlocks, getFixedBlocksForDate, editFixedBlock, removeFixedBlock } from '../../stores/schedule.svelte.js';
  import { openModal, previewBlock, plannerDate, advancePlannerDay, retreatPlannerDay, resetPlannerToToday, dragState } from '../../stores/ui.svelte.js';
  import { clock } from '../../stores/clock.svelte.js';
  import { getDaySchedule, toISODate, minutesToTimeString, formatDateLabel } from '../calendar.js';
  import { draggableBlockVertical, draggableFixedBlock } from '../dnd.js';
  import { pAt, pToColor } from '../envelope.js';
  import { layoutOverlapsOnDay } from '../scheduling.js';

  let todayStr    = $derived(clock.today);
  let viewDateStr = $derived(plannerDate.value);
  let viewDate    = $derived(new Date(viewDateStr + 'T00:00:00'));
  let daySchedule = $derived(getDaySchedule(viewDate, workSchedule.value));
  let isToday     = $derived(viewDateStr === todayStr);

  let dayStart = $derived(daySchedule?.startMinutes ?? 540);
  let dayEnd   = $derived(daySchedule?.endMinutes   ?? 1020);
  let span     = $derived(dayEnd - dayStart);

  let viewBlocks = $derived(
    tasks.value
      .filter(t => !t.isCompleted && !t.isDeleted)
      .flatMap(t => t.scheduledBlocks.filter(b => b.date === viewDateStr).map(b => ({ block: b, task: t })))
      .sort((a, b) => a.block.startMinutes - b.block.startMinutes)
  );

  let viewFixed = $derived(getFixedBlocksForDate(viewDateStr));

  let viewPreview = $derived(
    (previewBlock.value ?? []).filter(b => b.date === viewDateStr)
  );

  // Combine fixed + task blocks so overlapping ones (regardless of type) are
  // laid out side-by-side instead of one fully covering the other.
  let overlapLayout = $derived((() => {
    const tagged = [
      ...viewFixed.map(fb => ({ date: fb.date, startMinutes: fb.startMinutes, durationMinutes: fb.durationMinutes, kind: 'fixed', id: fb.id })),
      ...viewBlocks.map(({ block, task }) => ({ date: block.date, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: 'task', id: task.id })),
    ];
    const laid = layoutOverlapsOnDay(tagged, viewDateStr);
    const map = new Map();
    for (const item of laid) map.set(`${item.kind}:${item.id}`, item);
    return map;
  })());

  function overlapStyle(kind, id) {
    const item = overlapLayout.get(`${kind}:${id}`);
    if (!item || item.laneCount <= 1) return '';
    const gapPct = 1.5;
    const width = 100 / item.laneCount;
    const left = item.lane * width;
    const insetLeft = left === 0 ? 0 : gapPct / 2;
    const insetRight = item.lane === item.laneCount - 1 ? 0 : gapPct / 2;
    return `left:calc(${left}% + ${insetLeft}px); width:calc(${width}% - ${insetLeft + insetRight}px); right:auto;`;
  }

  let nowMinutes    = $derived(clock.now.getHours() * 60 + clock.now.getMinutes());
  let nowPct        = $derived(Math.max(0, Math.min(100, (nowMinutes - dayStart) / span * 100)));
  let isWorkHours   = $derived(isToday && !!daySchedule && nowMinutes >= dayStart && nowMinutes <= dayEnd);
  let isPastHours   = $derived(isToday && !!daySchedule && nowMinutes > dayEnd);

  let dateLabel = $derived((() => {
    const fl = formatDateLabel(viewDate);
    if (isToday) return 'Today';
    return fl.label;
  })());

  let dateShort = $derived(viewDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

  function toPct(minutes) {
    return Math.max(0, Math.min(100, (minutes - dayStart) / span * 100));
  }
  function heightPct(durationMinutes) {
    return (durationMinutes / span) * 100;
  }

  // Quarter-hour drop slots — manual placement is unrestricted; only the
  // auto-scheduler treats fixed blocks as obstacles.
  let draggedFixedBlockId = $derived(dragState.value?.fixedBlockId ?? null);
  let dropSlots = $derived((() => {
    if (!daySchedule) return [];
    const slots = [];
    for (let m = dayStart; m < dayEnd; m += 15) slots.push(m);
    return slots;
  })());

  // Hour lines
  let hourLines = $derived((() => {
    const lines = [];
    for (let m = dayStart; m <= dayEnd; m += 60) lines.push(m);
    return lines;
  })());

  // Time labels — every hour, plus the end time
  let timeLabels = $derived((() => {
    const labels = [];
    for (let m = dayStart; m <= dayEnd; m += 60) {
      labels.push({ minutes: m, pct: toPct(m), label: minutesToTimeString(m) });
    }
    return labels;
  })());

  function blockColor(task) {
    return pToColor(pAt(task, clock.minute));
  }

  let editingBlockId    = $state(null);
  let editingBlockLabel = $state('');

  let editingTaskId    = $state(null);
  let editingTaskLabel = $state('');

  function startTaskLabelEdit(task) {
    editingTaskId    = task.id;
    editingTaskLabel = task.description;
  }

  function commitTaskLabelEdit() {
    if (editingTaskId && editingTaskLabel.trim()) {
      editTask(editingTaskId, { description: editingTaskLabel.trim() });
    }
    editingTaskId = null;
  }

  function onTaskLabelKeydown(e) {
    if (e.key === 'Enter') commitTaskLabelEdit();
    if (e.key === 'Escape') editingTaskId = null;
  }

  function startBlockLabelEdit(fb) {
    editingBlockId    = fb.id;
    editingBlockLabel = fb.label;
  }

  function commitBlockLabelEdit() {
    if (editingBlockId && editingBlockLabel.trim()) {
      editFixedBlock(editingBlockId, { label: editingBlockLabel.trim() });
    }
    editingBlockId = null;
  }

  function onBlockLabelKeydown(e) {
    if (e.key === 'Enter') commitBlockLabelEdit();
    if (e.key === 'Escape') editingBlockId = null;
  }
</script>

<div class="today-planner">
  <div class="planner-controls">
    <div class="planner-title">
      <div class="day-nav">
        <button class="day-nav-btn" onclick={() => retreatPlannerDay(workSchedule.value)} disabled={isToday} title="Previous work day">‹</button>
        <div class="day-nav-sep"></div>
        <button class="day-nav-today" onclick={resetPlannerToToday} class:active={!isToday} title="Jump to today">Today</button>
        <div class="day-nav-sep"></div>
        <button class="day-nav-btn" onclick={() => advancePlannerDay(workSchedule.value)} title="Next work day">›</button>
      </div>
      <span class="planner-label">{dateLabel}</span>
      <span class="planner-date">{dateShort}</span>
    </div>
    <div class="planner-actions">
      <button class="btn btn-primary btn-sm" onclick={() => autoScheduleAll()}>✦ Auto-schedule</button>
      <button class="btn btn-ghost btn-sm" onclick={clearSchedule}>Clear</button>
      <button class="btn btn-ghost btn-sm" onclick={() => openModal('add-block')}>+ Block</button>
    </div>
  </div>

  {#if !daySchedule}
    <div class="off-day">Not a work day.</div>
  {:else if isPastHours && viewBlocks.length === 0}
    <div class="off-day">Work day is over — scheduled tasks will appear in Upcoming.</div>
  {:else}
    <div class="planner-body">
      <!-- Time labels float in the gutter -->
      <div class="time-gutter">
        {#each timeLabels as { pct, label }}
          <div class="time-label" style="top:{pct}%">{label}</div>
        {/each}
      </div>

      <!-- Timeline card -->
      <div class="timeline-card">
        <!-- Hour lines -->
        {#each hourLines as m}
          <div class="hour-line" style="top:{toPct(m)}%"></div>
        {/each}

        <!-- Quarter-hour drop slots (invisible DnD targets) -->
        {#each dropSlots as slotStart}
          <div
            class="drop-slot"
            data-date={viewDateStr}
            data-start={slotStart}
            style="top:{toPct(slotStart)}%; height:{heightPct(15)}%"
          ></div>
        {/each}

        <!-- Fixed blocks -->
        {#each viewFixed as fb}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed-block"
            class:is-dragging={draggedFixedBlockId === fb.id}
            style="top:{toPct(fb.startMinutes)}%; height:{heightPct(fb.durationMinutes)}%; {overlapStyle('fixed', fb.id)}"
            use:draggableFixedBlock={{ fixedBlockId: fb.id, block: fb }}
          >
            {#if editingBlockId === fb.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="fixed-label-input"
                bind:value={editingBlockLabel}
                onblur={commitBlockLabelEdit}
                onkeydown={onBlockLabelKeydown}
                onclick={(e) => e.stopPropagation()}
                autofocus
              />
            {:else}
              <span
                class="fixed-label"
                ondblclick={(e) => { e.stopPropagation(); startBlockLabelEdit(fb); }}
                title="Double-click to rename"
              >{fb.label}</span>
            {/if}
            <button class="unschedule-x" onclick={(e) => { e.stopPropagation(); removeFixedBlock(fb.id); }} title="Delete block">×</button>
          </div>
        {/each}

        <!-- Scheduled task blocks -->
        {#each viewBlocks as { block, task }}
          {@const color = blockColor(task)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="task-block"
            class:is-dragging={dragState.value?.taskId === task.id}
            style="top:{toPct(block.startMinutes)}%; height:{heightPct(block.durationMinutes)}%; {overlapStyle('task', task.id)}"
            use:draggableBlockVertical={{ taskId: task.id, block }}
          >
            <div class="block-accent" style="background:{color}"></div>
            <div class="block-content">
              {#if editingTaskId === task.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="block-name-input"
                  bind:value={editingTaskLabel}
                  onblur={commitTaskLabelEdit}
                  onkeydown={onTaskLabelKeydown}
                  onclick={(e) => e.stopPropagation()}
                  autofocus
                />
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="block-name"
                  ondblclick={(e) => { e.stopPropagation(); startTaskLabelEdit(task); }}
                >{task.description}</div>
              {/if}
              {#if block.durationMinutes >= 45}
                <div class="block-time">{minutesToTimeString(block.startMinutes)} · {block.durationMinutes >= 60 ? `${(block.durationMinutes/60).toFixed(block.durationMinutes % 60 === 0 ? 0 : 1)}h` : `${block.durationMinutes}m`}</div>
              {/if}
            </div>
            <button class="unschedule-x" onclick={(e) => { e.stopPropagation(); unscheduleTask(task.id); }} title="Unschedule">×</button>
          </div>
        {/each}

        <!-- Preview blocks (during drag) -->
        {#each viewPreview as pb}
          <div
            class="preview-block"
            style="top:{toPct(pb.startMinutes)}%; height:{heightPct(pb.durationMinutes)}%"
          ></div>
        {/each}

        <!-- Now line — extends slightly into the gutter -->
        {#if isWorkHours}
          <div class="now-line" style="top:{nowPct}%">
            <div class="now-dot"></div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .today-planner {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--color-border);
  }

  /* ── Controls ── */
  .planner-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .planner-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Button group: ‹  Today  › */
  .day-nav {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-card);
  }

  .day-nav-btn {
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--color-text-muted);
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    padding: 0 9px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    display: flex;
    align-items: center;
  }

  .day-nav-btn:hover:not(:disabled) {
    background: var(--color-panel);
    color: var(--color-text);
  }

  .day-nav-btn:disabled {
    opacity: 0.28;
    cursor: default;
  }

  .day-nav-sep {
    width: 1px;
    background: var(--color-border);
    flex-shrink: 0;
    align-self: stretch;
  }

  .day-nav-today {
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--color-text-faint);
    font-size: 12px;
    font-weight: 600;
    padding: 4px 9px;
    cursor: default;
    font-family: inherit;
    transition: background 0.1s, color 0.1s;
    white-space: nowrap;
  }

  .day-nav-today.active {
    color: var(--color-accent);
    cursor: pointer;
  }

  .day-nav-today.active:hover {
    background: var(--color-panel);
  }

  .planner-label {
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text);
  }

  .planner-date {
    font-size: 12px;
    color: var(--color-text-muted);
  }

  .planner-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .off-day {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--color-text-muted);
    font-size: 13px;
    padding: 40px 32px;
    min-height: 120px;
  }

  /* ── Body ── */
  .planner-body {
    display: flex;
    padding: 16px 12px 16px 0;
    gap: 0;
  }

  /* ── Time gutter ── */
  .time-gutter {
    width: 44px;
    flex-shrink: 0;
    position: relative;
    /* height driven by timeline-card */
    align-self: stretch;
  }

  .time-label {
    position: absolute;
    right: 8px;
    transform: translateY(-50%);
    font-size: 10px;
    color: var(--color-text-faint);
    white-space: nowrap;
    line-height: 1;
  }

  /* ── Timeline card ── */
  .timeline-card {
    flex: 1;
    position: relative;
    min-height: 420px;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    overflow: visible; /* allow now-dot to hang left */
  }

  /* ── Hour lines ── */
  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--color-border-light);
    pointer-events: none;
  }

  /* ── Drop slots ── */
  .drop-slot {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
  }

  /* ── Fixed blocks ── */
  .fixed-block {
    position: absolute;
    left: 0;
    right: 0;
    background: repeating-linear-gradient(
      45deg,
      var(--color-border-light),
      var(--color-border-light) 3px,
      transparent 3px,
      transparent 8px
    );
    border-bottom: 1px solid var(--color-border);
    padding: 3px 8px;
    z-index: 3;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .fixed-block:active { cursor: grabbing; }

  .fixed-block.is-dragging {
    opacity: 0.35;
  }

  .fixed-block:hover .unschedule-x { opacity: 1; }

  .fixed-label {
    display: block;
    font-size: 10px;
    color: var(--color-text-muted);
    font-weight: 500;
    cursor: text;
    max-width: calc(100% - 14px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fixed-label-input {
    font-size: 10px;
    font-weight: 500;
    font-family: inherit;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-text-muted);
    outline: none;
    padding: 0;
    width: calc(100% - 8px);
    line-height: 1;
    pointer-events: all;
  }

  /* ── Task blocks ── */
  .task-block {
    position: absolute;
    left: 0;
    right: 0;
    background: var(--color-card);
    border: 1px solid var(--color-border-light);
    border-radius: 7px;
    z-index: 4;
    cursor: grab;
    overflow: hidden;
    touch-action: none;
    user-select: none;
    min-height: 22px;
    box-sizing: border-box;
    display: flex;
    align-items: stretch;
    box-shadow: 0 1px 3px var(--color-shadow);
    transition: box-shadow 0.1s, border-color 0.1s;
  }

  .task-block:hover {
    border-color: var(--color-border);
    box-shadow: 0 2px 6px var(--color-shadow);
  }

  .task-block:active { cursor: grabbing; }

  .task-block.is-dragging {
    opacity: 0.35;
    box-shadow: none;
  }

  .block-accent {
    width: 5px;
    flex-shrink: 0;
    border-radius: 6px 0 0 6px;
  }

  .block-content {
    flex: 1;
    min-width: 0;
    padding: 3px 20px 3px 6px; /* right padding reserves space for the × button */
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .block-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
    cursor: text;
    width: fit-content;
    max-width: 100%;
  }

  .block-name-input {
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-text-muted);
    outline: none;
    padding: 0;
    width: 100%;
    line-height: 1.3;
  }

  .block-time {
    font-size: 10px;
    color: var(--color-text-muted);
    line-height: 1.2;
    margin-top: 1px;
  }

  .unschedule-x {
    position: absolute;
    top: 2px;
    right: 3px;
    background: none;
    border: none;
    font-size: 13px;
    line-height: 1;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0 2px;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 1;
  }

  .task-block:hover .unschedule-x { opacity: 1; }
  .unschedule-x:hover { color: #EF5350; }

  /* ── Preview block ── */
  .preview-block {
    position: absolute;
    left: 0;
    right: 0;
    background: var(--color-panel);
    border: 1.5px dashed var(--color-border);
    opacity: 0.7;
    border-radius: 7px;
    z-index: 5;
    pointer-events: none;
  }

  /* ── Now line ── */
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--color-accent);
    z-index: 6;
    pointer-events: none;
  }

  .now-dot {
    position: absolute;
    left: -5px;
    top: -5px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-accent);
  }
</style>
