let _dragState = $state(null);
let _activeModal = $state(null);
let _editingTaskId = $state(null);
let _previewBlock = $state([]); // array of { taskId, date, startMinutes, durationMinutes }

export const dragState = {
  get value() { return _dragState; }
};

export const activeModal = {
  get value() { return _activeModal; }
};

export const editingTaskId = {
  get value() { return _editingTaskId; }
};

export const previewBlock = {
  get value() { return _previewBlock; }
};

export function setDragState(state) {
  _dragState = state;
}

export function setPreviewBlock(blocks) {
  _previewBlock = blocks ?? [];
}

export function openModal(name) {
  _activeModal = name;
}

export function closeModal() {
  _activeModal = null;
}

export function setEditingTask(id) {
  _editingTaskId = id;
}
