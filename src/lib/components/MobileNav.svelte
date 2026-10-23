<script>
  import { activeTab, setActiveTab, pane, setPane } from '../../stores/ui.svelte.js';

  const ITEMS = [
    { key: 'tasks',    label: 'Tasks'    },
    { key: 'today',    label: 'Today'    },
    { key: 'upcoming', label: 'Upcoming' }
  ];

  // Always returns to Plan, so this doubles as the way back from Insights and
  // Settings — the only other places the phone layout can be.
  function go(key) {
    setActiveTab('plan');
    setPane(key);
  }

  let onPlan = $derived(activeTab.value === 'plan');
</script>

<nav class="mobile-nav" aria-label="Main">
  {#each ITEMS as item (item.key)}
    <button
      class="nav-item"
      class:active={onPlan && pane.value === item.key}
      aria-current={onPlan && pane.value === item.key ? 'page' : undefined}
      onclick={() => go(item.key)}
    >{item.label}</button>
  {/each}
</nav>

<style>
  /* Phone shell only. Above the stacked breakpoint the panels coexist and this
     has nothing to switch between. The conditions must stay in step with the
     phone shell in App.svelte — a landscape phone stacks too, and losing the
     nav there leaves no way to switch panes at all. */
  .mobile-nav { display: none; }

  @media (max-width: 759px), (max-height: 500px) and (pointer: coarse) {
    .mobile-nav {
      display: flex;
      flex-shrink: 0;
      background: var(--color-card);
      border-top: 1px solid var(--color-border);
      /* Bottom-most chrome on the phone: clear the home indicator, and in
         landscape the notch on whichever side it falls. */
      padding-bottom: env(safe-area-inset-bottom, 0px);
      padding-left: env(safe-area-inset-left, 0px);
      padding-right: env(safe-area-inset-right, 0px);
    }

    .nav-item {
      flex: 1;
      min-height: 52px;
      border: none;
      background: none;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--color-text-muted);
      cursor: pointer;
      border-top: 2px solid transparent;
      margin-top: -1px;
    }

    .nav-item.active {
      color: var(--color-text);
      border-top-color: var(--color-accent);
    }
  }
</style>
