<script>
  import { getVisibleWorkDays, minutesToTimeString, toISODate, formatDateLabel } from '../calendar.js';
  import { workSchedule } from '../../stores/schedule.svelte.js';
  import { tasks } from '../../stores/tasks.svelte.js';
  import { previewBlock } from '../../stores/ui.svelte.js';
  import { clock } from '../../stores/clock.svelte.js';
  import ScheduledBlock from './ScheduledBlock.svelte';
  import '../../styles/matrix.css';

  let workDays = $derived(getVisibleWorkDays(workSchedule.value, 7));

  // Global timeline: span from the earliest start to the latest end across all days.
  let timeline = $derived(() => {
    if (!workDays.length) return { startMinutes: 540, endMinutes: 1020 };
    const starts = workDays.map(d => d.daySchedule.startMinutes);
    const ends   = workDays.map(d => d.daySchedule.endMinutes);
    return {
      startMinutes: Math.min(...starts),
      endMinutes:   Math.max(...ends)
    };
  });

  // Hour marks for the header — every hour in the global timeline span.
  let headerHours = $derived(() => {
    const t = timeline();
    const slots = [];
    for (let m = t.startMinutes; m < t.endMinutes; m += 60) slots.push(m);
    return slots;
  });

  let totalWidthPx = $derived(headerHours().length * 80);

  // Convert a minute position to a percentage of the global timeline.
  function toPct(minutes) {
    const t = timeline();
    return (minutes - t.startMinutes) / (t.endMinutes - t.startMinutes) * 100;
  }

  function blockPosition(startMinutes, durationMinutes) {
    const t = timeline();
    const totalMinutes = t.endMinutes - t.startMinutes;
    const leftPct = toPct(startMinutes);
    const widthPct = durationMinutes / totalMinutes * 100;
    return { leftPct: Math.max(0, leftPct), widthPct };
  }

  function getScheduledBlocksForDay(dateStr) {
    return tasks.value.flatMap(t =>
      t.scheduledBlocks
        .filter(b => b.date === dateStr)
        .map(b => ({ block: b, task: t }))
    );
  }

  // Quarter-hour drop slots for a day — only within that day's work hours.
  function getQuarterSlots(daySchedule) {
    const slots = [];
    for (let m = daySchedule.startMinutes; m < daySchedule.endMinutes; m += 15) {
      slots.push(m);
    }
    return slots;
  }

  const todayStr = toISODate(new Date());

  // Current time as minutes-from-midnight, updated every second via clock.
  let nowMinutes = $derived(clock.now.getHours() * 60 + clock.now.getMinutes() + clock.now.getSeconds() / 60);
</script>

<div class="matrix-panel">
  <div class="matrix-scroll">
    <div class="matrix-table" style="--total-width:{totalWidthPx}px">

      <!-- Header: one cell per hour in the global timeline -->
      <div class="matrix-header">
        <div class="matrix-day-label-header">Schedule</div>
        {#each headerHours() as hour}
          <div class="matrix-hour-cell-header">{minutesToTimeString(hour)}</div>
        {/each}
      </div>

      <!-- Day rows -->
      {#each workDays as { date, daySchedule }}
        {@const dateStr = toISODate(date)}
        {@const isToday = dateStr === todayStr}
        {@const dayBlocks = getScheduledBlocksForDay(dateStr)}
        {@const t = timeline()}

        <!-- Pre-work and post-work offsets as percentages of the global timeline -->
        {@const preWorkPct  = toPct(daySchedule.startMinutes)}
        {@const postWorkPct = 100 - toPct(daySchedule.endMinutes)}
        {@const workWidthPct = toPct(daySchedule.endMinutes) - toPct(daySchedule.startMinutes)}

        <div class="matrix-row" class:today={isToday}>
          <div class="matrix-day-label">
            <span class="day-name">{formatDateLabel(date)}</span>
            {#if !isToday}
              <span class="day-date">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            {/if}
          </div>

          <div class="matrix-cells-wrapper" style="width:{totalWidthPx}px">

            <!-- Full-width background layer: off-hours shaded, work hours clear -->
            <div class="matrix-cells matrix-cells-bg">
              {#if preWorkPct > 0}
                <div class="matrix-off-hours" style="width:{preWorkPct}%"></div>
              {/if}
              <div class="matrix-work-hours" style="width:{workWidthPct}%">
                <!-- Drop targets: quarter-hour cells within work hours only -->
                {#each getQuarterSlots(daySchedule) as slotStart}
                  <div
                    class="matrix-cell-quarter"
                    data-date={dateStr}
                    data-start={slotStart}
                    style="width:{100 / ((daySchedule.endMinutes - daySchedule.startMinutes) / 15)}%"
                  ></div>
                {/each}
              </div>
              {#if postWorkPct > 0}
                <div class="matrix-off-hours" style="width:{postWorkPct}%"></div>
              {/if}
            </div>

            <!-- Hour grid lines aligned to global timeline -->
            <div class="matrix-cells matrix-cells-grid" aria-hidden="true">
              {#each headerHours() as hour}
                <div class="matrix-cell-gridline"></div>
              {/each}
            </div>

            <!-- Blocks overlay -->
            <div class="blocks-overlay">
              {#if isToday}
                {@const clampedNow = Math.min(Math.max(nowMinutes, daySchedule.startMinutes), daySchedule.endMinutes)}
                {#if clampedNow > daySchedule.startMinutes}
                  {@const elapsedWidthPct = toPct(clampedNow) - toPct(daySchedule.startMinutes)}
                  {@const elapsedLeftPct = toPct(daySchedule.startMinutes)}
                  <div class="elapsed-overlay" style="left:{elapsedLeftPct}%; width:{elapsedWidthPct}%"></div>
                {/if}
                {#if nowMinutes >= daySchedule.startMinutes && nowMinutes <= daySchedule.endMinutes}
                  <div class="time-rule" style="left:{toPct(nowMinutes)}%"></div>
                {/if}
              {/if}

              {#each dayBlocks as { block, task }, i}
                {@const displayMinutes = block.totalParts > 1 ? block.durationMinutes : task.estimatedMinutes}
                {@const { leftPct, widthPct } = blockPosition(block.startMinutes, displayMinutes)}
                <ScheduledBlock
                  {block}
                  {task}
                  {leftPct}
                  {widthPct}
                  zIndex={i + 10}
                  overlapOffset={0}
                />
              {/each}

              {#each previewBlock.value.filter(pb => pb.date === dateStr) as pb}
                {@const { leftPct, widthPct } = blockPosition(pb.startMinutes, pb.durationMinutes)}
                {@const previewTask = tasks.value.find(t => t.id === pb.taskId)}
                {#if previewTask}
                  <div
                    class="task-block preview-block"
                    style="left:{leftPct}%; width:{widthPct}%; z-index:50; top:4px; bottom:4px; height:auto;"
                  >
                    <span class="block-label">{previewTask.description}</span>
                  </div>
                {/if}
              {/each}
            </div>

          </div>
          <div class="matrix-row-overflow"></div>
        </div>
      {/each}

    </div>
  </div>
</div>
