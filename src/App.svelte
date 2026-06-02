<script>
  import { activeModal, openModal } from './stores/ui.svelte.js';
  import { initPersistence } from './stores/tasks.svelte.js';
  import TaskList from './lib/components/TaskList.svelte';
  import WeekMatrix from './lib/components/WeekMatrix.svelte';
  import AddTaskModal from './lib/components/AddTaskModal.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';

  initPersistence();
</script>

<div class="app-shell">
  <header class="app-header">
    <div class="app-title">TaskFlow</div>
    <div class="header-actions">
      <button class="btn btn-ghost" onclick={() => openModal('settings')}>⚙ Settings</button>
    </div>
  </header>

  <main class="app-body">
    <div class="matrix-area">
      <WeekMatrix />
    </div>
    <div class="tasklist-area">
      <TaskList />
    </div>
  </main>
</div>

{#if activeModal.value === 'add-task'}
  <AddTaskModal />
{/if}

{#if activeModal.value === 'settings'}
  <SettingsModal />
{/if}

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--spacing-md);
    height: 48px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .app-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--color-primary);
    letter-spacing: -0.02em;
  }

  .header-actions {
    display: flex;
    gap: var(--spacing-sm);
  }

  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .matrix-area {
    flex: 65;
    min-width: 0;
    overflow: hidden;
  }

  .tasklist-area {
    flex: 35;
    min-width: 300px;
    overflow: hidden;
  }
</style>
