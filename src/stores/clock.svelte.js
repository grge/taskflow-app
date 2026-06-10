let _now = $state(new Date());
let _minute = $state(new Date());

export const clock = {
  get now() { return _now; },
  get minute() { return _minute; }
};

export function initClock() {
  $effect(() => {
    const secInterval = setInterval(() => { _now = new Date(); }, 1000);
    const minInterval = setInterval(() => { _minute = new Date(); }, 60000);
    return () => { clearInterval(secInterval); clearInterval(minInterval); };
  });
}
