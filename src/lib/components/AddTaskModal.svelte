<script>
  import { closeModal } from '../../stores/ui.svelte.js';
  import { addTask } from '../../stores/tasks.svelte.js';
  import EnvelopeEditor from './EnvelopeEditor.svelte';

  const DAY_MS = 24 * 60 * 60 * 1000;

  function defaultOnset() { return new Date(Date.now() + DAY_MS); }
  function defaultPeak()  { return new Date(Date.now() + 3 * DAY_MS); }

  let description     = $state('');
  let onset           = $state(defaultOnset());
  let peak            = $state(defaultPeak());
  let peakPressure    = $state(0.7);
  let estimatedMinutes = $state(30);

  // Proxy task object for the EnvelopeEditor preview
  let previewTask = $derived({ onset, peak, peakPressure, createdAt: new Date() });

  function toDatetimeLocal(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocal(s) {
    return s ? new Date(s) : null;
  }

  function formatDuration(mins) {
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    if (mins >= 60) return `${(mins / 60).toFixed(1)}h`;
    return `${mins}m`;
  }

  function submit() {
    if (!description.trim()) return;
    addTask(description.trim(), onset, peak, peakPressure, estimatedMinutes);
    closeModal();
    reset();
  }

  function reset() {
    description      = '';
    onset            = defaultOnset();
    peak             = defaultPeak();
    peakPressure     = 0.7;
    estimatedMinutes = 30;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') submit();
  }

  function handleEnvelopeChange({ onset: o, peak: p, peakPressure: pp }) {
    onset = o;
    peak  = p;
    peakPressure = pp;
  }
</script>

<div class="modal-backdrop" onclick={closeModal} role="dialog" aria-modal="true">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={onKeydown} role="document">
    <h2>Add Task</h2>

    <div class="form-field">
      <label for="task-desc">Description</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="task-desc" type="text" bind:value={description} placeholder="What needs doing?" autofocus />
    </div>

    <div class="form-field">
      <label for="task-duration">Estimated Duration</label>
      <div class="duration-row">
        <input id="task-duration" type="range" min="5" max="480" step="5" bind:value={estimatedMinutes} />
        <span class="duration-value">{formatDuration(estimatedMinutes)}</span>
      </div>
    </div>

    <div class="form-field">
      <label>Pressure Envelope</label>
      <div class="envelope-row">
        <div class="datetime-fields">
          <label class="sub-label">
            Onset
            <input type="datetime-local" value={toDatetimeLocal(onset)}
              oninput={(e) => { const d = fromDatetimeLocal(e.target.value); if (d) onset = d; }} />
          </label>
          <label class="sub-label">
            Peak
            <input type="datetime-local" value={toDatetimeLocal(peak)}
              oninput={(e) => { const d = fromDatetimeLocal(e.target.value); if (d) peak = d; }} />
          </label>
          <label class="sub-label">
            Severity {Math.round(peakPressure * 100)}%
            <input type="range" min="0.05" max="1" step="0.05" bind:value={peakPressure} />
          </label>
        </div>
        <div class="envelope-preview">
          <EnvelopeEditor task={previewTask} onchange={handleEnvelopeChange} />
        </div>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn" onclick={closeModal}>Cancel</button>
      <button class="btn btn-primary" onclick={submit} disabled={!description.trim()}>Add Task</button>
    </div>
  </div>
</div>

<style>
  .duration-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .duration-row input[type="range"] {
    flex: 1;
    padding: 0;
    border: none;
  }

  .duration-value {
    font-weight: 600;
    min-width: 40px;
    text-align: right;
  }

  .envelope-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .datetime-fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sub-label {
    font-size: 11px;
    color: var(--color-text-muted);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sub-label input {
    font-size: 12px;
    padding: 3px 6px;
  }

  .envelope-preview {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow: hidden;
    background: white;
  }
</style>
