<script>
  import { activeModal, activeTab, setActiveTab, openModal } from './stores/ui.svelte.js';
  import { activeTasks, initPersistence } from './stores/tasks.svelte.js';
  import { initClock } from './stores/clock.svelte.js';
  import { initTheme } from './stores/theme.svelte.js';
  import TaskList from './lib/components/TaskList.svelte';
  import TodayPlanner from './lib/components/TodayPlanner.svelte';
  import OutlookSection from './lib/components/OutlookSection.svelte';
  import TimerBar from './lib/components/TimerBar.svelte';
  import AddTaskModal from './lib/components/AddTaskModal.svelte';
  import AddBlockModal from './lib/components/AddBlockModal.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import InsightsModal from './lib/components/InsightsModal.svelte';

  initPersistence();
  initClock();
  initTheme();

  let totalCount       = $derived(activeTasks.value.length);
  let unscheduledCount = $derived(activeTasks.value.filter(t => !t.scheduledBlocks.length).length);
</script>

<div class="app-shell">
  <header class="app-header">
    <div class="app-title"><span class="app-title-dot"></span>TaskFlow</div>

    <nav class="nav-tabs">
      <button
        class="nav-tab"
        class:active={activeTab.value === 'plan'}
        onclick={() => setActiveTab('plan')}
      >Plan</button>
      <button
        class="nav-tab"
        class:active={activeTab.value === 'insights'}
        onclick={() => setActiveTab('insights')}
      >Insights</button>
      <button
        class="nav-tab"
        class:active={activeTab.value === 'settings'}
        onclick={() => setActiveTab('settings')}
      >Settings</button>
    </nav>

    <div class="header-meta">
      {#if totalCount > 0}
        <span class="task-counter">{totalCount} total · {unscheduledCount} unscheduled</span>
      {/if}
    </div>
  </header>

  {#if activeTab.value === 'plan'}
    <main class="plan-layout">
      <aside class="task-panel">
        <TaskList />
      </aside>
      <section class="planner-panel">
        <TodayPlanner />
      </section>
      <aside class="outlook-panel">
        <OutlookSection />
      </aside>
    </main>
  {:else if activeTab.value === 'insights'}
    <main class="tab-panel">
      <div class="inline-panel">
        <InsightsModal inline />
      </div>
    </main>
  {:else if activeTab.value === 'settings'}
    <main class="tab-panel">
      <div class="inline-panel">
        <SettingsModal inline />
      </div>
    </main>
  {/if}

  <TimerBar />
</div>

{#if activeModal.value === 'add-task'}
  <AddTaskModal />
{/if}

{#if activeModal.value === 'add-block'}
  <AddBlockModal />
{/if}

{#if activeModal.value === 'settings'}
  <SettingsModal />
{/if}

{#if activeModal.value === 'insights'}
  <InsightsModal />
{/if}

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--color-bg);
  }

  /* ── Header ── */
  .app-header {
    display: flex;
    align-items: center;
    padding: 0 20px;
    height: 52px;
    background: var(--color-card);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    gap: 20px;
  }

  .app-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text);
    letter-spacing: -0.02em;
    flex-shrink: 0;
  }

  .app-title-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-accent);
    flex-shrink: 0;
  }

  /* ── Nav tabs ── */
  .nav-tabs {
    display: flex;
    gap: 2px;
  }

  .nav-tab {
    padding: 5px 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .nav-tab:hover { background: var(--color-panel); color: var(--color-text); }
  .nav-tab.active { background: var(--color-text); color: var(--color-surface); }

  /* ── Header meta ── */
  .header-meta {
    margin-left: auto;
  }

  .task-counter {
    font-size: 12px;
    color: var(--color-text-muted);
    font-weight: 500;
  }

  /* ── Plan layout ── */
  .plan-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .task-panel {
    width: 380px;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--color-panel);
  }

  .planner-panel {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
  }

  .outlook-panel {
    width: 260px;
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--color-panel);
    display: flex;
    flex-direction: column;
  }

  /* ── Insights/Settings tab panels ── */
  .tab-panel {
    flex: 1;
    overflow-y: auto;
    padding: 32px 24px;
    display: flex;
    justify-content: center;
    background: var(--color-bg);
  }

  .inline-panel {
    width: 100%;
    max-width: 600px;
  }

  :global(.inline-wrap) {
    width: 100%;
  }

  :global(.inline-wrap .modal) {
    position: static;
    transform: none;
    box-shadow: 0 2px 16px var(--color-shadow);
    width: 100%;
    max-width: none;
  }
</style>
