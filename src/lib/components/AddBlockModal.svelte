<script>
  import { closeModal } from '../../stores/ui.svelte.js';
  import { addFixedBlock } from '../../stores/schedule.svelte.js';
  import { toISODate } from '../calendar.js';

  const DURATION_PRESETS = [
    { label: '30m', value: 30 },
    { label: '1h',  value: 60 },
    { label: '1.5h', value: 90 },
    { label: '2h',  value: 120 },
  ];

  function todayStr() { return toISODate(new Date()); }
  function nowTimeStr() {
    const n = new Date();
    const h = String(n.getHours()).padStart(2, '0');
    const m = String(Math.round(n.getMinutes() / 15) * 15 % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  let date            = $state(todayStr());
  let startTime       = $state(nowTimeStr());
  let durationMinutes = $state(60);
  let label           = $state('');
  let customDuration  = $state('');
  let useCustom       = $state(false);

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function effectiveDuration() {
    if (useCustom) {
      const v = parseInt(customDuration, 10);
      return isNaN(v) || v <= 0 ? durationMinutes : v;
    }
    return durationMinutes;
  }

  function submit() {
    if (!label.trim() || !date || !startTime) return;
    addFixedBlock({
      id:              crypto.randomUUID(),
      date,
      startMinutes:    timeToMinutes(startTime),
      durationMinutes: effectiveDuration(),
      label:           label.trim()
    });
    closeModal();
    reset();
  }

  function reset() {
    date            = todayStr();
    startTime       = nowTimeStr();
    durationMinutes = 60;
    label           = '';
    customDuration  = '';
    useCustom       = false;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') submit();
  }
</script>

<div class="modal-backdrop" onclick={closeModal} role="dialog" aria-modal="true">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={onKeydown} role="document">
    <h2>Add Block</h2>

    <div class="form-field">
      <label for="block-label">Label</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="block-label" type="text" bind:value={label} placeholder="Meeting / Lunch / etc." autofocus />
    </div>

    <div class="form-row">
      <div class="form-field">
        <label for="block-date">Date</label>
        <input id="block-date" type="date" bind:value={date} />
      </div>
      <div class="form-field">
        <label for="block-time">Start time</label>
        <input id="block-time" type="time" bind:value={startTime} />
      </div>
    </div>

    <div class="form-field">
      <label>Duration</label>
      <div class="duration-options">
        {#each DURATION_PRESETS as preset}
          <button
            class="seg-btn"
            class:active={!useCustom && durationMinutes === preset.value}
            onclick={() => { durationMinutes = preset.value; useCustom = false; }}
          >{preset.label}</button>
        {/each}
        <button
          class="seg-btn"
          class:active={useCustom}
          onclick={() => useCustom = true}
        >Custom</button>
      </div>
      {#if useCustom}
        <div class="custom-duration">
          <input type="number" min="5" max="480" step="5" bind:value={customDuration} placeholder="minutes" />
          <span class="custom-hint">minutes</span>
        </div>
      {/if}
    </div>

    <div class="modal-actions">
      <button class="btn" onclick={closeModal}>Cancel</button>
      <button class="btn btn-primary" onclick={submit} disabled={!label.trim()}>Add Block</button>
    </div>
  </div>
</div>

<style>
  .form-row {
    display: flex;
    gap: 12px;
  }

  .form-row .form-field {
    flex: 1;
  }

  .duration-options {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
    width: fit-content;
  }

  .seg-btn {
    padding: 5px 14px;
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
  .seg-btn:hover:not(.active) { background: var(--color-bg); color: var(--color-text); }
  .seg-btn.active { background: var(--color-primary); color: white; }

  .custom-duration {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }

  .custom-duration input {
    width: 80px;
    padding: 4px 8px;
    font-size: 13px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  .custom-hint {
    font-size: 12px;
    color: var(--color-text-muted);
  }
</style>
