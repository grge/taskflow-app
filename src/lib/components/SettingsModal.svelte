<script>
  import { closeModal } from '../../stores/ui.svelte.js';
  import { workSchedule, updateWorkSchedule } from '../../stores/schedule.svelte.js';

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let localDays = $state(workSchedule.days.map(d => ({ ...d })));

  function minutesToTime(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function save() {
    updateWorkSchedule({ days: localDays });
    closeModal();
  }

  function hardReset() {
    if (!confirm('Delete all tasks and reset to defaults? This cannot be undone.')) return;
    localStorage.clear();
    location.reload();
  }
</script>

<div class="modal-backdrop" onclick={closeModal} role="dialog" aria-modal="true">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()} role="document">
    <h2>Work Schedule</h2>

    <div class="schedule-grid">
      {#each localDays as day, i}
        <div class="schedule-row" class:disabled={!day.enabled}>
          <label class="day-toggle">
            <input type="checkbox" bind:checked={localDays[i].enabled} />
            <span class="day-name">{DAY_NAMES[day.dayOfWeek]}</span>
          </label>
          {#if day.enabled}
            <input
              type="time"
              value={minutesToTime(day.startMinutes)}
              oninput={(e) => { localDays[i].startMinutes = timeToMinutes(e.target.value); }}
            />
            <span class="sep">–</span>
            <input
              type="time"
              value={minutesToTime(day.endMinutes)}
              oninput={(e) => { localDays[i].endMinutes = timeToMinutes(e.target.value); }}
            />
          {:else}
            <span class="off-label">Off</span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="modal-actions">
      <button class="btn btn-danger" onclick={hardReset}>Reset all data</button>
      <div style="flex:1"></div>
      <button class="btn" onclick={closeModal}>Cancel</button>
      <button class="btn btn-primary" onclick={save}>Save</button>
    </div>
  </div>
</div>

<style>
  .schedule-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: var(--spacing-md);
  }

  .schedule-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .schedule-row.disabled { opacity: 0.5; }

  .day-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    width: 60px;
    flex-shrink: 0;
  }

  .day-name {
    font-weight: 600;
    font-size: 13px;
  }

  .sep { color: var(--color-text-muted); }

  input[type="time"] {
    padding: 4px 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 13px;
  }

  .off-label {
    font-size: 13px;
    color: var(--color-text-muted);
  }

  :global(.btn-danger) {
    border-color: #EF5350;
    color: #EF5350;
  }

  :global(.btn-danger:hover) {
    background: #EF5350;
    color: white;
  }
</style>
