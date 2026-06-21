import { loadState } from '../lib/persistence.js';
import { DEFAULT_WORK_SCHEDULE } from '../lib/constants.js';
import { unscheduleTasksOnDisabledDays } from './tasks.svelte.js';

const _initialState = loadState();

let _workSchedule = $state(_initialState.workSchedule ?? DEFAULT_WORK_SCHEDULE);
let _fixedBlocks  = $state(_initialState.fixedBlocks ?? []);

export const workSchedule = {
  get value() { return _workSchedule; },
  get days()  { return _workSchedule.days; }
};

export const fixedBlocks = {
  get value() { return _fixedBlocks; }
};

export function updateWorkSchedule(newSchedule) {
  _workSchedule = newSchedule;
  unscheduleTasksOnDisabledDays(newSchedule);
}

export function addFixedBlock(block) {
  _fixedBlocks = [..._fixedBlocks, block];
}

export function removeFixedBlock(id) {
  _fixedBlocks = _fixedBlocks.filter(b => b.id !== id);
}

export function editFixedBlock(id, patch) {
  _fixedBlocks = _fixedBlocks.map(b => b.id === id ? { ...b, ...patch } : b);
}

export function getFixedBlocksForDate(dateStr) {
  return _fixedBlocks.filter(b => b.date === dateStr);
}
