import { loadState } from '../lib/persistence.js';
import { DEFAULT_WORK_SCHEDULE } from '../lib/constants.js';
import { unscheduleTasksOnDisabledDays } from './tasks.svelte.js';

let _workSchedule = $state(loadState().workSchedule ?? DEFAULT_WORK_SCHEDULE);

export const workSchedule = {
  get value() { return _workSchedule; },
  get days() { return _workSchedule.days; }
};

export function getWorkSchedule() {
  return _workSchedule;
}

export function updateWorkSchedule(newSchedule) {
  _workSchedule = newSchedule;
  unscheduleTasksOnDisabledDays(newSchedule);
}
