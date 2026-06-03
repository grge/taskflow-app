let _now = $state(new Date());

export const clock = {
  get now() { return _now; }
};

export function initClock() {
  $effect(() => {
    const interval = setInterval(() => { _now = new Date(); }, 1000);
    return () => clearInterval(interval);
  });
}
