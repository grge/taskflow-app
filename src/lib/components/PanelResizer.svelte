<script>
  import {
    taskPanelWidth, setTaskPanelWidth, resetTaskPanelWidth,
    TASK_PANEL_MIN, TASK_PANEL_MAX
  } from '../../stores/layout.svelte.js';

  let { target } = $props();

  const KEY_STEP = 16;

  let el        = $state(null);
  let dragging  = $state(false);
  let measured  = $state(0);
  let startX    = 0;
  let startWidth = 0;

  // The panel is fluid until it is first resized, so its width isn't a number we
  // hold — measure it, both to seed a drag and to report a real aria-valuenow.
  $effect(() => {
    if (!target) return;
    // Border-box, not entry.contentRect: the panel has a 1px border, and a
    // content width would make aria-valuenow and the keyboard step a pixel off
    // from the width a drag actually sets.
    const observer = new ResizeObserver(() => { measured = target.getBoundingClientRect().width; });
    observer.observe(target);
    return () => observer.disconnect();
  });

  let width = $derived(Math.round(taskPanelWidth.value ?? measured));

  function onPointerDown(e) {
    if (!target) return;
    // Suppresses the browser's own selection gesture — without it a resize drag
    // sweeps a text selection across the app.
    e.preventDefault();
    dragging   = true;
    startX     = e.clientX;
    startWidth = target.getBoundingClientRect().width;
    // Capture on the press: the handle is a few pixels wide, so the pointer
    // leaves it on the first move and later moves would go elsewhere.
    el.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('resizing-active');
  }

  function onPointerMove(e) {
    if (!dragging) return;
    setTaskPanelWidth(startWidth + (e.clientX - startX));
  }

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    document.documentElement.classList.remove('resizing-active');
  }

  function onKeydown(e) {
    const from = taskPanelWidth.value ?? measured;
    if (e.key === 'ArrowLeft')       { e.preventDefault(); setTaskPanelWidth(from - KEY_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setTaskPanelWidth(from + KEY_STEP); }
    else if (e.key === 'Home')       { e.preventDefault(); resetTaskPanelWidth(); }
  }
</script>

<div
  class="panel-resizer"
  class:dragging
  bind:this={el}
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize task panel"
  aria-valuenow={width}
  aria-valuemin={TASK_PANEL_MIN}
  aria-valuemax={TASK_PANEL_MAX}
  tabindex="0"
  title="Drag to resize · double-click to reset"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  ondblclick={resetTaskPanelWidth}
  onkeydown={onKeydown}
></div>

<style>
  /* Straddles the panel's own border with negative margins, so the grab area is
     comfortable without costing the layout any width. */
  .panel-resizer {
    flex: 0 0 7px;
    margin: 0 -3px;
    position: relative;
    z-index: 10;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
  }

  .panel-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 2px;
    background: transparent;
    transition: background 0.12s;
  }

  .panel-resizer:hover::after,
  .panel-resizer.dragging::after,
  .panel-resizer:focus-visible::after { background: var(--color-accent); }

  .panel-resizer:focus-visible { outline: none; }

  /* Coarse pointers get a wider grab area; the visible line stays 2px. */
  @media (pointer: coarse) {
    .panel-resizer { flex-basis: 20px; margin: 0 -9px; }
    .panel-resizer::after { left: 9px; }
  }

  /* Stacked phone layout: the panel is full width, so there is nothing to size. */
  @media (max-width: 759px) {
    .panel-resizer { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel-resizer::after { transition: none; }
  }
</style>
