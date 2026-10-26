// End-to-end suite for connecting the app to a backend (phase 4 of
// SYNC-AND-API-DESIGN.md): the built app in real browsers against the
// reference backend running in this process. Each test gets a fresh backend.
//
// Run with `npm run test:e2e` (after the smoke suite), or on its own after
// `vite build`: `node tests/e2e/sync.mjs [name filter]`.
//
// Unlike the smoke suite the clock is real: the backend applies an operation
// stamped more than two minutes ahead at its own time, so a frozen browser
// clock would make every device disagree with it. Browsers run in this
// process's timezone, which is the backend's home timezone.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { openStore } from '../../server/store.js';
import { createApp } from '../../server/app.js';
import { coreVersion } from '../../scripts/core-version.mjs';

const PORT = 4180;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/taskflow-app/`;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DAY = 86_400_000;

// ─── fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
function task(description, overrides = {}) {
  seq += 1;
  const now = Date.now();
  return {
    id: `task-${seq}`,
    description,
    estimatedMinutes: 30,
    onset: new Date(now - 2 * DAY).toISOString(),
    peak: new Date(now + 4 * DAY).toISOString(),
    peakPressure: 0.6,
    createdAt: new Date(now - 3 * DAY).toISOString(),
    lastModifiedAt: new Date(now - 3 * DAY).toISOString(),
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

const op = (type, args) => ({ id: crypto.randomUUID(), type, args, at: new Date().toISOString(), tz: TZ, actor: 'test' });

// ─── harness ─────────────────────────────────────────────────────────────────

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let cleanups = [];

function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function assert(cond, what) {
  if (!cond) throw new Error(what);
}

async function until(cond, what, ms = 5000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { if ((last = await cond())) return last; } catch {}
    await sleep(50);
  }
  throw new Error(`timed out: ${what}`);
}

async function startBackend({ dir, port = 0 } = {}) {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'taskflow-e2e-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  }
  const store = openStore(join(dir, 'taskflow.db'));
  const app = createApp({ store, config: { allowedOrigins: [ORIGIN], coreVersion: coreVersion(), homeTimeZone: TZ } });
  await new Promise(r => app.server.listen(port, '127.0.0.1', r));
  const url = `http://localhost:${app.server.address().port}`;
  let stopped = false;
  const tokenName = `t${seq++}`;
  const backend = {
    dir, url, store, port: app.server.address().port, tokenName,
    token: store.createToken(tokenName, 'write'),
    async stop() { if (stopped) return; stopped = true; await app.close(); store.close(); },
    async state() {
      const r = await fetch(url + '/v1/state', { headers: { Authorization: `Bearer ${backend.token}` } });
      return (await r.json()).state;
    },
    async post(...ops) {
      const r = await fetch(url + '/v1/ops', { method: 'POST', headers: { Authorization: `Bearer ${backend.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) });
      assertEqual(r.status, 200, 'POST /v1/ops');
    }
  };
  cleanups.push(() => backend.stop());
  return backend;
}

let browser;
let pageErrors = [];

// A device: its own browser context, so its own localStorage.
async function device({ seed, hash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, timezoneId: TZ });
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  if (seed) {
    await page.goto(BASE);
    await page.evaluate(s => localStorage.setItem('taskflow_v2', JSON.stringify(s)), { tasks: [], activeTimer: null, fixedBlocks: [], ...seed });
  }
  await page.goto(BASE + hash);
  if (seed && hash) await page.reload(); // a hash-only navigation doesn't reload
  await page.waitForSelector('.app-shell');
  return page;
}

const stored = (page, key = 'taskflow_v2') => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
// The four slices in the stored order; the backend's JSON orders keys its own way.
const slices = s => ({ tasks: s.tasks, workSchedule: s.workSchedule, activeTimer: s.activeTimer, fixedBlocks: s.fixedBlocks });
const descriptions = state => state.tasks.filter(t => !t.isDeleted).map(t => t.description);
const pill = page => page.locator('[data-testid="sync-pill"]');
const synced = (page, what = 'synced') => until(async () => (await pill(page).textContent())?.trim() === 'Synced', `${what}: pill says Synced`);

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('[data-testid="sync-section"]');
}

async function connectForm(page, url, token) {
  await openSettings(page);
  await page.locator('#sync-url').fill(url);
  await page.locator('#sync-token').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
}

// ─── tests ───────────────────────────────────────────────────────────────────

test('a local-only user connects to an empty backend and loses nothing', async () => {
  const be = await startBackend();
  const a = task('Alpha'), b = task('Bravo', { isCompleted: true, completedAt: new Date().toISOString() });
  const page = await device({ seed: { tasks: [a, b], fixedBlocks: [{ id: 'fb1', label: 'Lunch', date: '2026-11-02', startMinutes: 720, durationMinutes: 60 }] } });
  const before = await stored(page);

  await connectForm(page, be.url, be.token);
  await synced(page);
  assert((await page.getByRole('status').filter({ hasText: 'being sent to the backend' }).count()) === 1, 'says it uploads');

  const remote = await be.state();
  assertEqual(slices(remote), slices(before), 'the backend holds exactly what the device had');
  assertEqual(await stored(page), before, 'the device still has it all');
  assertEqual((await stored(page, 'taskflow_backend')).url, be.url, 'connection saved');

  await page.reload();
  await synced(page, 'after reload');
  assertEqual(await stored(page), before, 'unchanged by reloading');
});

test('a connect link fills Settings in and connecting downloads the backend\'s data', async () => {
  const be = await startBackend();
  const t = task('From the backend');
  await be.post(op('task.add', t));
  const link = '#connect=' + Buffer.from(JSON.stringify({ url: be.url, token: be.token })).toString('base64url');

  const page = await device({ hash: link });
  await page.waitForSelector('[data-testid="sync-section"]');
  assertEqual(new URL(page.url()).hash, '', 'token gone from the address bar');
  assertEqual(await page.locator('#sync-url').inputValue(), be.url, 'URL filled in');
  assert(await page.getByText('A connect link filled these in').isVisible(), 'says where the values came from');
  assertEqual(await stored(page, 'taskflow_backend'), null, 'nothing saved before the click');

  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await synced(page);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await until(async () => (await page.locator('.task-card').count()) === 1, 'the backend\'s task shows');
  assertEqual(descriptions(await stored(page)), ['From the backend'], 'saved locally');
});

test('changes on one device appear on the other', async () => {
  const be = await startBackend();
  await be.post(op('task.add', task('Alpha')), op('task.add', task('Bravo')));
  const token2 = be.store.createToken('second', 'write');
  const laptop = await device(), phone = await device();
  await connectForm(laptop, be.url, be.token);
  await connectForm(phone, be.url, token2);
  await Promise.all([synced(laptop), synced(phone)]);
  for (const p of [laptop, phone]) await p.getByRole('button', { name: 'Plan', exact: true }).click();

  await laptop.locator('.task-card', { hasText: 'Alpha' }).locator('.schedule-btn').click();
  await until(async () => (await stored(phone)).tasks.find(t => t.description === 'Alpha').scheduledBlocks.length > 0, 'the phone sees the laptop\'s scheduling');

  await phone.locator('.task-card', { hasText: 'Bravo' }).locator('.complete-circle').click();
  await until(async () => (await stored(laptop)).tasks.find(t => t.description === 'Bravo').isCompleted, 'the laptop sees the phone\'s completion');
  await until(async () => (await laptop.locator('.task-card').count()) === 1, 'and stops listing it');

  // Something else writing to the backend (an assistant, later) reaches both.
  await be.post(op('task.add', task('Charlie')));
  for (const p of [laptop, phone]) await until(async () => descriptions(await stored(p)).includes('Charlie'), 'a third writer\'s task arrives');
  assertEqual(await stored(laptop), await stored(phone), 'the devices agree');
});

test('both sides have data: merging keeps both', async () => {
  const be = await startBackend();
  await be.post(op('task.add', task('On the backend')));
  const page = await device({ seed: { tasks: [task('On this device')] } });

  await connectForm(page, be.url, be.token);
  const choice = page.locator('[data-testid="sync-choice"]');
  await choice.waitFor();
  assert((await choice.textContent()).includes('This device has 1 task and'), 'counts shown');
  assertEqual(await stored(page, 'taskflow_backend'), null, 'nothing saved while asking');

  await choice.getByRole('button', { name: /Merge both/ }).click();
  await synced(page);
  assertEqual(descriptions(await be.state()), ['On the backend', 'On this device'], 'the backend has both');
  assertEqual(descriptions(await stored(page)), ['On the backend', 'On this device'], 'the device has both');
});

test('both sides have data: keeping the backend\'s replaces this device\'s', async () => {
  const be = await startBackend();
  await be.post(op('task.add', task('On the backend')));
  const page = await device({ seed: { tasks: [task('On this device')] } });
  await connectForm(page, be.url, be.token);
  await page.locator('[data-testid="sync-choice"]').getByRole('button', { name: /Use the backend's/ }).click();
  await synced(page);
  assertEqual(descriptions(await stored(page)), ['On the backend'], 'device took the backend\'s');
  assertEqual(descriptions(await be.state()), ['On the backend'], 'backend unchanged');
});

test('disconnecting leaves a working local copy', async () => {
  const be = await startBackend();
  await be.post(op('task.add', task('Alpha')));
  const page = await device();
  await connectForm(page, be.url, be.token);
  await synced(page);

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByText('Disconnected. This device keeps its copy').waitFor();
  assertEqual(await pill(page).count(), 0, 'no sync pill');
  assertEqual(await stored(page, 'taskflow_backend'), null, 'connection forgotten');
  assertEqual(await stored(page, 'taskflow_sync'), null, 'no sync bookkeeping left');

  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.locator('.add-btn').click();
  await page.locator('#task-desc').fill('Offline only');
  await page.getByRole('button', { name: 'Add Task' }).click();
  await until(async () => descriptions(await stored(page)).length === 2, 'added locally');
  await page.reload();
  await page.waitForSelector('.app-shell');
  assertEqual(descriptions(await stored(page)), ['Alpha', 'Offline only'], 'kept across a reload');
  assertEqual(descriptions(await be.state()), ['Alpha'], 'the backend never saw it');
});

test('an incompatible backend is refused with a clear message', async () => {
  const fake = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    res.end(JSON.stringify(req.url === '/v1/info' ? { name: 'future', protocol: 99, coreVersion: 'x', features: [], homeTimeZone: TZ } : { version: 0, state: {} }));
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise(r => fake.close(r)));
  const page = await device({ seed: { tasks: [task('Mine')] } });

  await connectForm(page, `http://localhost:${fake.address().port}`, 'tf_whatever');
  await page.getByText(/speaks sync protocol 99 and this app speaks 1.*Update the app/).waitFor();
  assertEqual(await stored(page, 'taskflow_backend'), null, 'not connected');
  assertEqual(descriptions(await stored(page)), ['Mine'], 'data untouched');
});

test('an unreachable backend or a wrong token is refused before anything changes', async () => {
  const be = await startBackend();
  const page = await device({ seed: { tasks: [task('Mine')] } });
  await connectForm(page, be.url, 'tf_wrong');
  await page.getByText('didn\'t accept that token').waitFor();
  await page.locator('#sync-url').fill('http://localhost:1');
  await page.locator('#sync-token').fill(be.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText(`ALLOWED_ORIGINS includes ${ORIGIN}`).waitFor();
  assertEqual(await stored(page, 'taskflow_backend'), null, 'not connected');
});

test('a revoked token stops sync and says so', async () => {
  const be = await startBackend();
  const page = await device({ seed: { tasks: [task('Alpha')] } });
  await connectForm(page, be.url, be.token);
  await synced(page);
  be.store.revokeToken(be.tokenName);
  // The next write meets the revocation at once (an idle stream notices within 30s).
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.locator('.task-card', { hasText: 'Alpha' }).locator('.schedule-btn').click();
  await until(async () => (await pill(page).textContent()).trim() === 'Sync stopped', 'pill says Sync stopped');
  assert((await pill(page).getAttribute('title')).includes('no longer accepts this device\'s token'), 'and why');
  assert((await stored(page)).tasks[0].scheduledBlocks.length > 0, 'the edit is kept on the device');
});

test('edits made while the backend is down sync when it returns', async () => {
  const be = await startBackend();
  const page = await device({ seed: { tasks: [task('Alpha')] } });
  await connectForm(page, be.url, be.token);
  await synced(page);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();

  await be.stop();
  await until(async () => (await pill(page).textContent()).trim() === 'Offline', 'pill says Offline');
  await page.locator('.task-card', { hasText: 'Alpha' }).locator('.schedule-btn').click();
  await until(async () => (await stored(page, 'taskflow_sync'))?.pending.length === 1, 'queued and saved');

  // A reload while offline keeps the queue.
  await page.reload();
  await page.waitForSelector('.app-shell');
  assert((await stored(page)).tasks[0].scheduledBlocks.length > 0, 'still scheduled after reload');

  const back = await startBackend({ dir: be.dir, port: be.port });
  back.token = be.token;
  await synced(page, 'after the backend returns');
  assert((await back.state()).tasks[0].scheduledBlocks.length > 0, 'the backend has the offline edit');
});

// ─── runner ──────────────────────────────────────────────────────────────────

async function waitForServer(url, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`preview server did not start at ${url}`);
}

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
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
      if (pageErrors.length) throw new Error(`page error: ${pageErrors[0]}`);
      console.log(`  ok    ${name}  (${Date.now() - started}ms)`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
    } finally {
      for (const c of browser.contexts()) await c.close();
      for (const fn of cleanups.reverse()) await fn();
      cleanups = [];
    }
  }
} finally {
  await browser?.close();
  preview.kill();
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
