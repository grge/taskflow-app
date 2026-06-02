<script>
  import { openModal, closeModal } from '../../stores/ui.svelte.js';
  import { addTask } from '../../stores/tasks.svelte.js';
  import { URGENCY_PROFILE_LABELS, URGENCY_PROFILE_ORDER } from '../constants.js';

  let description = $state('');
  let urgencyProfile = $state('cob-today');
  let importance = $state('medium');
  let estimatedMinutes = $state(30);

  function submit() {
    if (!description.trim()) return;
    addTask(description.trim(), urgencyProfile, importance, estimatedMinutes);
    closeModal();
    description = '';
    urgencyProfile = 'cob-today';
    importance = 'medium';
    estimatedMinutes = 30;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') submit();
  }
</script>

<div class="modal-backdrop" onclick={closeModal} role="dialog" aria-modal="true">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={onKeydown} role="document">
    <h2>Add Task</h2>

    <div class="form-field">
      <label for="task-desc">Description</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="task-desc"
        type="text"
        bind:value={description}
        placeholder="What needs doing?"
        autofocus
      />
    </div>

    <div class="form-field">
      <label for="task-urgency">Urgency</label>
      <select id="task-urgency" bind:value={urgencyProfile}>
        {#each URGENCY_PROFILE_ORDER as profile}
          <option value={profile}>{URGENCY_PROFILE_LABELS[profile]}</option>
        {/each}
      </select>
    </div>

    <div class="form-field">
      <label>Importance</label>
      <div class="importance-toggle">
        {#each ['low', 'medium', 'high'] as level}
          <button
            class:active={importance === level}
            onclick={() => importance = level}
          >
            {level.charAt(0).toUpperCase()}
          </button>
        {/each}
      </div>
    </div>

    <div class="form-field">
      <label for="task-duration">Estimated Duration</label>
      <div class="duration-row">
        <input
          id="task-duration"
          type="range"
          min="5"
          max="480"
          step="5"
          bind:value={estimatedMinutes}
        />
        <span class="duration-value">{estimatedMinutes}m</span>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn" onclick={closeModal}>Cancel</button>
      <button class="btn btn-primary" onclick={submit} disabled={!description.trim()}>Add Task</button>
    </div>
  </div>
</div>

<style>
  .importance-toggle {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
    width: fit-content;
  }

  .importance-toggle button {
    padding: 6px 20px;
    border: none;
    background: transparent;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .importance-toggle button.active {
    background: var(--color-primary);
    color: white;
  }

  .importance-toggle button + button {
    border-left: 1px solid var(--color-border);
  }

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
</style>
