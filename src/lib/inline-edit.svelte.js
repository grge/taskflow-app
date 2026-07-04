// Reusable "double-click to rename" controller. Captures the small state machine
// that appeared three times across TaskRow / TodayPlanner: track which item is
// being edited plus its draft text, commit on Enter/blur (trimmed, only when
// changed), cancel on Escape.
//
// Usage in a component's <script>:
//   const rename = createInlineEdit((id, value) => editTask(id, { description: value }));
//   // start:  rename.start(task.id, task.description)
//   // markup: rename.isEditing(task.id) ? <input> : <span ondblclick={...}>
//   // input:  bind:value={rename.draft}, onblur={rename.commit}, onkeydown={rename.onKeydown}
//
// `commitFn(id, trimmedValue)` performs the actual mutation; it is only invoked
// when the trimmed draft is non-empty (the change-vs-original check is the
// caller's concern if it wants one, but empty is always rejected here).
export function createInlineEdit(commitFn) {
  let editingId = $state(null);
  let draft     = $state('');

  // Arrow functions so the handlers can be passed bare (onkeydown={rename.onKeydown})
  // without losing their binding — they close over editingId/draft, not `this`.
  function commit() {
    if (editingId != null && draft.trim()) {
      commitFn(editingId, draft.trim());
    }
    editingId = null;
  }

  function cancel() {
    editingId = null;
  }

  return {
    get draft() { return draft; },
    set draft(v) { draft = v; },

    isEditing: (id) => editingId === id,

    start: (id, initialValue) => {
      editingId = id;
      draft = initialValue ?? '';
    },

    commit,
    cancel,

    onKeydown: (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cancel();
    }
  };
}
