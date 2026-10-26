// Runs the core unit tests once per timezone. The core's contract is host-local
// time, so the same expectations must hold everywhere; zones are chosen to
// break a hidden UTC assumption: west of Greenwich, far east, a half-hour
// offset, and America/New_York, whose DST change falls inside the tested week.

import { spawnSync } from 'node:child_process';

const ZONES = ['Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Brisbane', 'Asia/Kolkata'];

let failed = 0;
for (const tz of ZONES) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot', 'tests/core/*.test.mjs'], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8'
  });
  const ok = r.status === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  TZ=${tz}`);
  if (!ok) console.log((r.stdout + r.stderr).split('\n').filter(l => l.trim()).slice(-40).join('\n'));
}

console.log(failed ? `\n${failed} timezone(s) failed` : `\nall passed in ${ZONES.length} timezones`);
process.exit(failed ? 1 : 0);
