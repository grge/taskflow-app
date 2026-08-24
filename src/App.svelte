<script>
  import { activeModal, activeTab, setActiveTab, openModal, narrowPane, setNarrowPane, dragState } from './stores/ui.svelte.js';
  import { paneTabFromPoint } from './lib/dnd-hittest.js';
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

  const PANES = [
    { key: 'today',    label: 'Today'    },
    { key: 'upcoming', label: 'Upcoming' }
  ];

  // Collapsing Upcoming takes away a drop target: a task chip dragged toward a
  // future day has nowhere to land. Hovering the other tab mid-drag switches to
  // it, so the gesture still reaches the hidden pane. The tabs are display:none
  // on wide viewports and elementsFromPoint can't hit them, so this is inert
  // there without needing to know the breakpoint in JS.
  const PANE_SWITCH_MS = 350;

  $effect(() => {
    if (!dragState.value) return;

    let timer = null;
    let hovered = null;

    function onMove(e) {
      const pane = paneTabFromPoint(e.clientX, e.clientY)?.dataset.pane ?? null;
      if (pane === hovered) return;
      hovered = pane;
      clearTimeout(timer);
      if (pane && pane !== narrowPane.value) {
        timer = setTimeout(() => setNarrowPane(pane), PANE_SWITCH_MS);
      }
    }

    document.addEventListener('pointermove', onMove);
    return () => {
      document.removeEventListener('pointermove', onMove);
      clearTimeout(timer);
    };
  });
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
    <main class="plan-layout" class:show-upcoming={narrowPane.value === 'upcoming'}>
      <aside class="task-panel">
        <TaskList />
      </aside>

      <div class="work-region">
        <!-- Only rendered visibly when the window can't hold both panes -->
        <div class="pane-toggle" role="tablist" aria-label="Work region">
          {#each PANES as pane}
            <button
              class="pane-tab"
              class:active={narrowPane.value === pane.key}
              role="tab"
              aria-selected={narrowPane.value === pane.key}
              data-pane={pane.key}
              onclick={() => setNarrowPane(pane.key)}
            >{pane.label}</button>
          {/each}
        </div>

        <div class="work-panes">
          <section class="planner-panel">
            <TodayPlanner />
          </section>
          <aside class="outlook-panel">
            <OutlookSection />
          </aside>
        </div>
      </div>
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
    height: 100dvh;
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
    /* Fluid so the three panels survive down to the stacked breakpoint. */
    width: clamp(300px, 34vw, 380px);
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--color-panel);
  }

  /* Today + Upcoming share this column so the narrow layout can put a toggle
     above them without disturbing the wide layout, where the toggle is hidden
     and the two sit side by side exactly as before. */
  .work-region {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .work-panes {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .pane-toggle { display: none; }

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

  /* ── Narrow window: one of Today / Upcoming at a time ──────────────────────
     Layout only, keyed on width. Nothing here changes how anything is operated
     — a split-screen laptop window is still a mouse. */
  @media (max-width: 1099px) {
    .pane-toggle {
      display: flex;
      gap: 2px;
      padding: 6px 10px;
      background: var(--color-card);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .pane-tab {
      padding: 4px 14px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: background 0.1s, color 0.1s;
    }

    .pane-tab:hover { background: var(--color-panel); color: var(--color-text); }
    .pane-tab.active { background: var(--color-text); color: var(--color-surface); }

    /* Whichever pane is showing takes the whole region. */
    .planner-panel { border-right: none; }
    .outlook-panel { display: none; }

    .plan-layout.show-upcoming .planner-panel { display: none; }

    .plan-layout.show-upcoming .outlook-panel {
      display: flex;
      width: auto;
      flex: 1;
      min-width: 0;
    }

    /* The backlog is designed around a 260px column. Given the whole region it
       would stretch its cards to ~600px, so cap the content and let the panel
       take the leftover width instead. */
    .plan-layout.show-upcoming .outlook-panel :global(.outlook-section) {
      width: 100%;
      max-width: 420px;
    }
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
