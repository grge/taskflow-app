<script>
  import { closeModal } from '../../stores/ui.svelte.js';
  import { workSchedule, updateWorkSchedule } from '../../stores/schedule.svelte.js';

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let localDays = $state(workSchedule.days.map(d => ({ ...d })));
  let localBuffer = $state(workSchedule.value.bufferMinutes ?? 15);

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
    updateWorkSchedule({ ...workSchedule.value, days: localDays, bufferMinutes: localBuffer });
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
  <div class="modal settings-modal" onclick={(e) => e.stopPropagation()} role="document">

    <div class="modal-header">
      <h2>Settings</h2>
      <button class="close-btn" onclick={closeModal} aria-label="Close">×</button>
    </div>

    <div class="settings-body">

      <section>
        <h3 class="section-title">Work Hours</h3>
        <div class="schedule-grid">
          {#each localDays as day, i}
            <div class="schedule-row" class:disabled={!day.enabled}>
              <label class="day-toggle">
                <input type="checkbox" bind:checked={localDays[i].enabled} />
                <span class="day-name">{DAY_NAMES[day.dayOfWeek]}</span>
              </label>
              {#if day.enabled}
                <div class="time-range">
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
                </div>
              {:else}
                <span class="off-label">Off</span>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      <section>
        <h3 class="section-title">Scheduling</h3>
        <div class="field-row">
          <div class="field-info">
            <span class="field-label">Buffer between tasks</span>
            <span class="field-hint">Gap left before and after each scheduled block</span>
          </div>
          <div class="buffer-options">
            {#each [0, 5, 10, 15, 30] as mins}
              <button
                class="seg-btn"
                class:active={localBuffer === mins}
                onclick={() => localBuffer = mins}
              >{mins === 0 ? 'None' : `${mins}m`}</button>
            {/each}
          </div>
        </div>
      </section>

    </div>

    <div class="modal-footer">
      <button class="btn btn-danger-ghost" onclick={hardReset}>Reset all data</button>
      <div class="footer-actions">
        <button class="btn" onclick={closeModal}>Cancel</button>
        <button class="btn btn-primary" onclick={save}>Save</button>
      </div>
    </div>

  </div>
</div>

<style>
  .settings-modal {
    min-width: 420px;
    max-width: 520px;
    padding: 0;
  }

  /* ── Header ── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 20px;
    line-height: 1;
    color: var(--color-text-muted);
    padding: 0 2px;
    cursor: pointer;
  }

  .close-btn:hover { color: var(--color-text); }

  /* ── Body sections ── */
  .settings-body {
    padding: 8px 0;
  }

  section {
    padding: 16px 24px;
  }

  section + section {
    border-top: 1px solid var(--color-border);
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    margin-bottom: 12px;
  }

  /* ── Work hours grid ── */
  .schedule-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .schedule-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 32px;
  }

  .schedule-row.disabled { opacity: 0.45; }

  .day-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    width: 58px;
    flex-shrink: 0;
  }

  .day-name {
    font-size: 13px;
    font-weight: 500;
  }

  .time-range {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sep {
    color: var(--color-text-muted);
    font-size: 13px;
  }

  input[type="time"] {
    padding: 4px 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 13px;
    background: var(--color-surface);
    color: var(--color-text);
  }

  input[type="time"]:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .off-label {
    font-size: 13px;
    color: var(--color-text-muted);
  }

  /* ── Field row (label + control side by side) ── */
  .field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .field-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .field-label {
    font-size: 13px;
    font-weight: 500;
  }

  .field-hint {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  /* ── Segmented button group ── */
  .buffer-options {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .seg-btn {
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 500;
    border: none;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
    color: var(--color-text-muted);
    transition: background 0.1s, color 0.1s;
  }

  .seg-btn:first-child { border-left: none; }

  .seg-btn:hover:not(.active) {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .seg-btn.active {
    background: var(--color-primary);
    color: white;
  }

  /* ── Footer ── */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  .btn-danger-ghost {
    background: none;
    border: none;
    font-size: 12px;
    color: var(--color-text-muted);
    padding: 6px 4px;
    cursor: pointer;
    transition: color 0.15s;
  }

  .btn-danger-ghost:hover { color: #EF5350; }
</style>
