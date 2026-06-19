import { toISODate } from '../lib/calendar.js';

let _now    = $state(new Date());
let _minute = $state(new Date());
let _today  = $state(toISODate(new Date()));

export const clock = {
  get now()    { return _now;    },
  get minute() { return _minute; },
  get today()  { return _today;  }
};

export function initClock() {
  $effect(() => {
    const secInterval = setInterval(() => { _now = new Date(); }, 1000);
    const minInterval = setInterval(() => {
      _minute = new Date();
      const newToday = toISODate(_minute);
      if (newToday !== _today) { _today = newToday; }
    }, 60000);
    return () => { clearInterval(secInterval); clearInterval(minInterval); };
  });
}
