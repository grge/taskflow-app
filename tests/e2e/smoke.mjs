// End-to-end smoke suite for the data layer: every way the UI changes tasks,
// blocks, fixed blocks, work hours and the timer, checked against what lands in
// localStorage. Written against the app before the domain-core refactor, so it
// pins today's behaviour and catches any drift the refactor introduces.
//
// Run with `npm run test:e2e` (builds, serves dist/ with vite preview, runs).
// Set PW_CHROMIUM to a Chromium binary if Playwright's own browser isn't
// installed (`npx playwright install chromium` installs it).
//
// The clock is frozen at Wednesday 28 Oct 2026, 10:00 in Europe/London (GMT
// that day), mid-way through the default 9:00–17:00 work day. Every expected
// minute below follows from that, so the suite never depends on when it runs.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4179;
const BASE = `http://localhost:${PORT}/taskflow-app/`;
const NOW = new Date('2026-10-28T10:00:00Z');
const TZ = 'Europe/London';
const TODAY = '2026-10-28';      // Wednesday
const TOMORROW = '2026-10-29';   // Thursday
const FRIDAY = '2026-10-30';
const DAY = 86_400_000;

// ─── fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
function task(description, overrides = {}) {
  seq += 1;
  return {
    id: `task-${seq}`,
    description,
    estimatedMinutes: 60,
    onset: new Date(NOW - 2 * DAY).toISOString(),
    peak: new Date(+NOW + 4 * DAY).toISOString(),
    peakPressure: 0.6,
    createdAt: new Date(NOW - 3 * DAY).toISOString(),
    lastModifiedAt: new Date(NOW - 3 * DAY).toISOString(),
    completedAt: null,
    scheduledBlocks: [],
    elapsedSeconds: 0,
    remainingOverride: null,
    isCompleted: false,
    isDeleted: false,
    isLocked: false,
    ...overrides
  };
}

function block(t, date, startMinutes, durationMinutes = t.estimatedMinutes) {
  return { id: `blk-${t.id}-${date}`, taskId: t.id, date, startMinutes, durationMinutes, partIndex: null, totalParts: null };
}

// ─── harness ─────────────────────────────────────────────────────────────────

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function assert(cond, what) {
  if (!cond) throw new Error(what);
}

let browser;
let pageErrors = [];

async function open(seed, { viewport = { width: 1400, height: 950 } } = {}) {
  const context = await browser.newContext({ viewport, timezoneId: TZ });
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.clock.setFixedTime(NOW);
  await page.goto(BASE);
  if (seed) {
    await page.evaluate(s => localStorage.setItem('taskflow_v2', JSON.stringify(s)), {
      tasks: [], activeTimer: null, fixedBlocks: [], ...seed
    });
    await page.reload();
  }
  await page.waitForSelector('.app-shell');
  await page.waitForTimeout(300);
  return { context, page };
}

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('taskflow_v2')));
const storedTask = async (page, id) => (await stored(page)).tasks.find(t => t.id === id);
const blocksOf = async (page, id) =>
  (await storedTask(page, id)).scheduledBlocks.map(b => [b.date, b.startMinutes, b.durationMinutes]);

async function center(locator) {
  const b = await locator.boundingBox();
  assert(b, `no box for ${locator}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

// A mouse drag that settles on the target before releasing, so the drop
// preview has computed before pointerup.
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.move(to.x + 1, to.y, { steps: 2 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

const card = (page, name) => page.locator('.task-card', { hasText: name });
const slot = (page, minutes) => page.locator(`.drop-slot[data-start="${minutes}"]`);

// ─── tests ───────────────────────────────────────────────────────────────────

test('renders seeded tasks', async () => {
  const a = task('Alpha'), b = task('Bravo');
  const { page } = await open({ tasks: [a, b] });
  assertEqual(await page.locator('.task-card').count(), 2, 'task rows');
});

test('rendering a task leaves its deadline alone', async () => {
  // peaksLabel once truncated the task's own peak Date to midnight while
  // rendering "peaks Friday", and the next save persisted it.
  const a = task('Alpha', { peak: '2026-11-01T15:30:00.000Z' });
  const { page } = await open({ tasks: [a] });
  await page.waitForTimeout(300);
  assertEqual((await storedTask(page, a.id)).peak, '2026-11-01T15:30:00.000Z', 'peak after render and save');
});

test('add task through the modal', async () => {
  const { page } = await open({});
  await page.locator('.add-btn').click();
  await page.locator('#task-desc').fill('Write report');
  await page.locator('#task-duration').fill('90');
  await page.getByRole('button', { name: 'Add Task' }).click();
  await page.waitForTimeout(300);
  const [t] = (await stored(page)).tasks;
  assertEqual(t.description, 'Write report', 'description');
  assertEqual(t.estimatedMinutes, 90, 'estimate');
  assertEqual(t.peakPressure, 0.7, 'default peak pressure');
  assertEqual(t.onset, new Date(+NOW + DAY).toISOString(), 'default onset');
  assertEqual(t.peak, new Date(+NOW + 3 * DAY).toISOString(), 'default peak');
  assertEqual(t.createdAt, NOW.toISOString(), 'createdAt from the clock');
});

test('schedule next free slot, then undo', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').hover();
  await card(page, 'Alpha').locator('.schedule-btn').click();
  await page.waitForTimeout(300);
  assertEqual(await blocksOf(page, a.id), [[TODAY, 600, 60]], 'placed at 10:00');
  const flash = (await page.locator('.flash').first().textContent()).trim();
  assertEqual(flash, 'Scheduled 10am', 'flash text');
  await page.locator('.flash-undo').first().click();
  await page.waitForTimeout(300);
  assertEqual(await blocksOf(page, a.id), [], 'undo restores no blocks');
});

test('schedule next respects other tasks and the buffer', async () => {
  const a = task('Alpha'), b = task('Bravo');
  const { page } = await open({ tasks: [a, b] });
  for (const name of ['Alpha', 'Bravo']) {
    await card(page, name).hover();
    await card(page, name).locator('.schedule-btn').click();
    await page.waitForTimeout(250);
  }
  assertEqual(await blocksOf(page, a.id), [[TODAY, 600, 60]], 'first');
  assertEqual(await blocksOf(page, b.id), [[TODAY, 675, 60]], 'second after 15m buffer');
});

test('schedule next reports when nothing fits', async () => {
  const a = task('Enormous', { estimatedMinutes: 600 * 60 });
  const { page } = await open({ tasks: [a] });
  await card(page, 'Enormous').hover();
  await card(page, 'Enormous').locator('.schedule-btn').click();
  await page.waitForTimeout(300);
  assertEqual(await blocksOf(page, a.id), [], 'no blocks');
  const flash = (await page.locator('.flash').first().textContent()).trim();
  assert(flash.startsWith('No free slot'), `failure flash, got "${flash}"`);
});

test('drag a task chip onto the timeline', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  await drag(page, await center(card(page, 'Alpha').locator('.task-chip')), await center(slot(page, 780)));
  assertEqual(await blocksOf(page, a.id), [[TODAY, 780, 60]], 'dropped at 13:00');
});

test('move a scheduled block within today', async () => {
  const a = task('Alpha');
  a.scheduledBlocks = [block(a, TODAY, 600)];
  const { page } = await open({ tasks: [a] });
  const blk = page.locator('.task-block').first();
  const b = (await center(blk)).box;
  const target = (await center(slot(page, 840))).box;
  // Grab near the block's top edge and drop on the 14:00 slot's top edge, so
  // the grab offset is a fraction of a minute and snaps away.
  await drag(page, { x: b.x + b.width / 2, y: b.y + 3 }, { x: b.x + b.width / 2, y: target.y + 3 });
  assertEqual(await blocksOf(page, a.id), [[TODAY, 840, 60]], 'moved to 14:00');
});

test('auto-schedule places unlocked tasks and skips locked ones', async () => {
  const a = task('Alpha', { peakPressure: 0.9 });
  const b = task('Bravo', { isLocked: true });
  const c = task('Charlie', { peakPressure: 0.3, estimatedMinutes: 30 });
  const { page } = await open({ tasks: [a, b, c] });
  await page.getByRole('button', { name: /Auto-schedule/ }).click();
  await page.waitForTimeout(400);
  assertEqual(await blocksOf(page, a.id), [[TODAY, 600, 60]], 'Alpha (highest pressure) first');
  assertEqual(await blocksOf(page, b.id), [], 'locked Bravo untouched');
  assertEqual(await blocksOf(page, c.id), [[TODAY, 675, 30]], 'Charlie after the buffer');
});

test('clear schedule keeps locked tasks', async () => {
  const a = task('Alpha'), b = task('Bravo', { isLocked: true });
  a.scheduledBlocks = [block(a, TODAY, 600)];
  b.scheduledBlocks = [block(b, TODAY, 720)];
  const { page } = await open({ tasks: [a, b] });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForTimeout(300);
  assertEqual(await blocksOf(page, a.id), [], 'unlocked cleared');
  assertEqual(await blocksOf(page, b.id), [[TODAY, 720, 60]], 'locked kept');
});

test('complete a task', async () => {
  const a = task('Alpha');
  a.scheduledBlocks = [block(a, TODAY, 600)];
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').locator('.complete-circle').click();
  await page.waitForTimeout(300);
  const t = await storedTask(page, a.id);
  assertEqual(t.isCompleted, true, 'completed');
  assertEqual(t.completedAt, NOW.toISOString(), 'completedAt from the clock');
  assertEqual(t.scheduledBlocks, [], 'blocks cleared');
  assertEqual(await page.locator('.task-card').count(), 0, 'gone from the active list');
});

test('timer: start, pause, resume, stop', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').hover();
  await card(page, 'Alpha').locator('.play-hover-btn').click();
  await page.clock.setFixedTime(+NOW + 2 * 60_000);
  await page.locator('.timer-bar').getByRole('button', { name: /Pause/ }).click();
  await page.waitForTimeout(200);
  assertEqual((await storedTask(page, a.id)).elapsedSeconds, 120, 'flushed on pause');
  await page.clock.setFixedTime(+NOW + 5 * 60_000);          // paused: no accrual
  await page.locator('.timer-bar').getByRole('button', { name: /Resume/ }).click();
  await page.clock.setFixedTime(+NOW + 6 * 60_000);
  await page.locator('.timer-bar').getByRole('button', { name: /Stop/ }).click();
  await page.waitForTimeout(200);
  const s = await stored(page);
  assertEqual(s.tasks[0].elapsedSeconds, 180, '2m + 1m, not the paused 3m');
  assertEqual(s.activeTimer, null, 'timer cleared');
});

test('lock toggle', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  const lock = card(page, 'Alpha').locator('.chip-lock');
  await card(page, 'Alpha').hover();
  await lock.click();
  await page.waitForTimeout(200);
  assertEqual((await storedTask(page, a.id)).isLocked, true, 'locked');
  await lock.click();
  await page.waitForTimeout(200);
  assertEqual((await storedTask(page, a.id)).isLocked, false, 'unlocked');
});

test('move an upcoming card to another day', async () => {
  const a = task('Alpha');
  a.scheduledBlocks = [block(a, TOMORROW, 540)];
  const { page } = await open({ tasks: [a] });
  const from = await center(page.locator(`[data-outlook-day="${TOMORROW}"] [data-outlook-task-id]`).first());
  const to = await center(page.locator(`[data-outlook-day="${FRIDAY}"]`));
  await drag(page, from, to);
  assertEqual(await blocksOf(page, a.id), [[FRIDAY, 540, 60]], 'packed at Friday 9:00');
});

test('reorder upcoming cards within a day', async () => {
  const a = task('Alpha'), b = task('Bravo');
  a.scheduledBlocks = [block(a, TOMORROW, 540)];
  b.scheduledBlocks = [block(b, TOMORROW, 660)];
  const { page } = await open({ tasks: [a, b] });
  const cards = page.locator(`[data-outlook-day="${TOMORROW}"] [data-outlook-task-id]`);
  const first = (await center(cards.nth(0))).box;
  await drag(page, await center(cards.nth(1)), { x: first.x + first.width / 2, y: first.y + 4 });
  assertEqual(await blocksOf(page, b.id), [[TOMORROW, 540, 60]], 'Bravo now first');
  assertEqual(await blocksOf(page, a.id), [[TOMORROW, 615, 60]], 'Alpha bumped after the buffer');
});

test('drop onto a card on another day lands where the ghost showed', async () => {
  // The drop used to re-hit-test at release, where the pointer sits on the
  // ghost rather than a card, and appended instead of inserting.
  const a = task('Alpha'), b = task('Bravo');
  a.scheduledBlocks = [block(a, TOMORROW, 540)];
  b.scheduledBlocks = [block(b, FRIDAY, 540)];
  const { page } = await open({ tasks: [a, b] });
  const target = (await center(page.locator(`[data-outlook-day="${FRIDAY}"] [data-outlook-task-id]`).first())).box;
  await drag(page,
    await center(page.locator(`[data-outlook-day="${TOMORROW}"] [data-outlook-task-id]`).first()),
    { x: target.x + target.width / 2, y: target.y + 4 });
  assertEqual(await blocksOf(page, a.id), [[FRIDAY, 540, 60]], 'Alpha inserted first on Friday');
  assertEqual(await blocksOf(page, b.id), [[FRIDAY, 615, 60]], 'Bravo bumped after the buffer');
});

test('drag a fixed block', async () => {
  const fb = { id: 'fb-1', label: 'Standup', date: TODAY, startMinutes: 660, durationMinutes: 30 };
  const { page } = await open({ fixedBlocks: [fb] });
  const b = (await center(page.locator('.fixed-block').first())).box;
  const target = (await center(slot(page, 900))).box;
  await drag(page, { x: b.x + b.width / 2, y: b.y + 3 }, { x: b.x + b.width / 2, y: target.y + 3 });
  const [moved] = (await stored(page)).fixedBlocks;
  assertEqual([moved.date, moved.startMinutes, moved.durationMinutes], [TODAY, 900, 30], 'moved to 15:00');
});

test('disabling today in Settings unschedules today', async () => {
  const a = task('Alpha'), b = task('Bravo');
  a.scheduledBlocks = [block(a, TODAY, 600)];
  b.scheduledBlocks = [block(b, '2026-11-02', 600)];   // Monday, still a work day
  const fb = { id: 'fb-1', label: 'Standup', date: TODAY, startMinutes: 660, durationMinutes: 30 };
  const { page } = await open({ tasks: [a, b], fixedBlocks: [fb] });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disable Wed' }).click();
  await page.waitForTimeout(300);
  const s = await stored(page);
  assertEqual(s.workSchedule.days.find(d => d.dayOfWeek === 3).enabled, false, 'Wednesday off');
  assertEqual(await blocksOf(page, a.id), [], "today's task unscheduled");
  assertEqual(await blocksOf(page, b.id), [], 'later block unscheduled too (packed on top of an invalid one)');
  assertEqual(s.fixedBlocks, [], "today's fixed block removed");
});

test('edit the envelope by dragging the peak handle', async () => {
  const a = task('Alpha', { peakPressure: 0.5 });
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').locator('.task-header').click();
  await page.waitForTimeout(300);
  const h = await center(page.locator('.handle-peak'));
  await drag(page, h, { x: h.x, y: h.y - 30 });
  const p = (await storedTask(page, a.id)).peakPressure;
  assert(p > 0.5 && p <= 1, `peak pressure rose, got ${p}`);
});

test('rename a task', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').locator('.task-desc').dblclick();
  await page.locator('.desc-input').fill('Alpha renamed');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  assertEqual((await storedTask(page, a.id)).description, 'Alpha renamed', 'renamed');
});

test('step remaining time up', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').locator('.task-header').click();
  await page.waitForTimeout(300);
  await page.getByTitle('More time left').click();
  await page.waitForTimeout(250);
  assertEqual((await storedTask(page, a.id)).remainingOverride, { atElapsedSeconds: 0, remainingMinutes: 90 }, 'override');
});

test('delete a task', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').locator('.task-header').click();
  await page.waitForTimeout(300);
  await page.locator('.delete-btn').click();
  await page.waitForTimeout(250);
  assertEqual((await storedTask(page, a.id)).isDeleted, true, 'soft-deleted');
  assertEqual(await page.locator('.task-card').count(), 0, 'gone from the list');
});

test('changes survive a reload', async () => {
  const a = task('Alpha');
  const { page } = await open({ tasks: [a] });
  await card(page, 'Alpha').hover();
  await card(page, 'Alpha').locator('.schedule-btn').click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(400);
  assertEqual(await blocksOf(page, a.id), [[TODAY, 600, 60]], 'still scheduled');
  assertEqual(await page.locator('.task-block').count(), 1, 'rendered on the timeline');
});

// ─── runner ──────────────────────────────────────────────────────────────────

async function waitForServer(url, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`preview server did not start at ${url}`);
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'inherit']
});

let failed = 0;
try {
  await waitForServer(BASE);
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--no-proxy-server']
  });
  const only = process.argv[2];
  for (const { name, fn } of tests) {
    if (only && !name.includes(only)) continue;
    const started = Date.now();
    pageErrors = [];
    try {
      await fn();
      // An uncaught error in the page fails the test even if its checks passed.
      if (pageErrors.length) throw new Error(`page error: ${pageErrors[0]}`);
      console.log(`  ok    ${name}  (${Date.now() - started}ms)`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
    } finally {
      for (const c of browser.contexts()) await c.close();
    }
  }
} finally {
  await browser?.close();
  server.kill();
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
