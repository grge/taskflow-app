// Work hours and fixed blocks. Mutations dispatch operations to the domain
// core through data.svelte.js; the exports are the app's existing store API.

import { data, dispatch } from './data.svelte.js';

export const workSchedule = {
  get value() { return data.workSchedule; },
  get days()  { return data.workSchedule.days; }
};

export const fixedBlocks = {
  get value() { return data.fixedBlocks; }
};

// Also unschedules task blocks and drops fixed blocks the new hours invalidate.
export function updateWorkSchedule(newSchedule) {
  dispatch('hours.update', { schedule: newSchedule });
}

export function addFixedBlock(block) {
  dispatch('block.add', { block });
}

export function removeFixedBlock(id) {
  dispatch('block.remove', { id });
}

export function editFixedBlock(id, patch) {
  dispatch('block.edit', { id, patch });
}

export function getFixedBlocksForDate(dateStr) {
  return data.fixedBlocks.filter(b => b.date === dateStr);
}
