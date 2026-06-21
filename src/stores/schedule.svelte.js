import { loadState } from '../lib/persistence.js';
import { DEFAULT_WORK_SCHEDULE } from '../lib/constants.js';
import { getDaySchedule } from '../lib/calendar.js';
import { revalidateScheduleAfterHoursChange } from './tasks.svelte.js';

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
  revalidateScheduleAfterHoursChange(newSchedule);
  _fixedBlocks = _fixedBlocks.filter(b => {
    const day = getDaySchedule(new Date(b.date + 'T00:00:00'), newSchedule);
    return !!day && b.startMinutes >= day.startMinutes && b.startMinutes + b.durationMinutes <= day.endMinutes;
  });
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
