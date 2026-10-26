// Connecting a device: connect links, backend URLs, probing a backend, what the
// first connection does with each side's data, and the merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, reviveState } from '../../src/core/state.js';
import { parseConnectLink, checkBackendUrl, probeBackend, firstConnectPlan, mergeStates, isBlank } from '../../src/sync/connect.js';
import { PROTOCOL } from '../../src/sync/client.js';

const task = (id, modified, extra = {}) => ({
  id, description: id, estimatedMinutes: 30, peakPressure: 0.5,
  onset: '2026-10-26T00:00:00.000Z', peak: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-20T00:00:00.000Z', lastModifiedAt: modified, completedAt: null,
  scheduledBlocks: [], elapsedSeconds: 0, isCompleted: false, isDeleted: false, ...extra
});
const state = (tasks, extra = {}) => reviveState({ ...emptyState(), tasks, ...extra });

// ─── connect links ───────────────────────────────────────────────────────────

test('a connect link made the way taskflow-server makes it reads back', () => {
  const payload = Buffer.from(JSON.stringify({ url: 'https://tf.fly.dev', token: 'tf_abc-_é' })).toString('base64url');
  assert.deepEqual(parseConnectLink(`#connect=${payload}`), { url: 'https://tf.fly.dev', token: 'tf_abc-_é' });
});

test('anything else in the fragment is not a connect link', () => {
  for (const hash of ['', '#', '#settings', '#connect=', '#connect=!!!', `#connect=${Buffer.from('{"url":1}').toString('base64url')}`, `#connect=${Buffer.from('nope').toString('base64url')}`]) {
    assert.equal(parseConnectLink(hash), null, hash);
  }
});

// ─── backend URLs ────────────────────────────────────────────────────────────

test('backend URLs are normalised, and must be https unless on this machine', () => {
  assert.deepEqual(checkBackendUrl('  tf.fly.dev/ '), { url: 'https://tf.fly.dev' });
  assert.deepEqual(checkBackendUrl('https://home.example/taskflow//'), { url: 'https://home.example/taskflow' });
  assert.deepEqual(checkBackendUrl('http://localhost:8080'), { url: 'http://localhost:8080' });
  assert.deepEqual(checkBackendUrl('http://127.0.0.1:8080/'), { url: 'http://127.0.0.1:8080' });
  assert.match(checkBackendUrl('http://192.168.1.5:8080').error, /https/);
  assert.match(checkBackendUrl('').error, /URL/);
  assert.match(checkBackendUrl('ftp://x').error, /https/);
});

// ─── probing ─────────────────────────────────────────────────────────────────

function fakeFetch(routes) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) throw new TypeError('Failed to fetch');
    const { status = 200, body } = typeof route === 'function' ? route(init) : route;
    return { ok: status < 400, status, json: async () => body };
  };
}
const info = { name: 'taskflow-server', protocol: PROTOCOL, coreVersion: 'x', features: [], homeTimeZone: 'Australia/Darwin' };

test('a good backend probes ok, with its state revived', async () => {
  const r = await probeBackend({
    url: 'tf.fly.dev', token: ' tf_good ', origin: 'https://grge.github.io',
    fetch: fakeFetch({
      '/v1/info': { body: info },
      '/v1/state': init => init.headers?.Authorization === 'Bearer tf_good'
        ? { body: { version: 4, state: { ...emptyState(), tasks: [task('a', '2026-10-25T00:00:00.000Z')] }, hash: 'h' } }
        : { status: 401, body: { error: { code: 'unauthorized' } } }
    })
  });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://tf.fly.dev');
  assert.equal(r.version, 4);
  assert.ok(r.state.tasks[0].onset instanceof Date);
});

test('probe failures say what to do', async () => {
  const base = { url: 'https://tf.fly.dev', token: 'tf_x', origin: 'https://grge.github.io' };
  const reason = async (fetch, extra = {}) => (await probeBackend({ ...base, ...extra, fetch })).reason;

  assert.match(await reason(fakeFetch({})), /Couldn't reach tf\.fly\.dev.*ALLOWED_ORIGINS includes https:\/\/grge\.github\.io/);
  assert.match(await reason(fakeFetch({ '/v1/info': { status: 404, body: null } })), /isn't a TaskFlow backend/);
  assert.match(await reason(fakeFetch({ '/v1/info': { body: { ...info, protocol: PROTOCOL + 1 } } })), /protocol 2.*Update the app/);
  assert.match(await reason(fakeFetch({ '/v1/info': { body: info }, '/v1/state': { status: 401, body: {} } })), /didn't accept that token/);
  assert.match(await reason(fakeFetch({}), { token: '' }), /token/);
  assert.match(await reason(fakeFetch({}), { url: 'http://10.0.0.2' }), /https/);
});

// ─── the first connection ────────────────────────────────────────────────────

test('the first connection downloads, uploads, or asks', () => {
  const mine = state([task('a', '2026-10-25T00:00:00.000Z')]);
  const theirs = state([task('b', '2026-10-25T00:00:00.000Z')]);
  assert.equal(firstConnectPlan(emptyState(), theirs), 'download');
  assert.equal(firstConnectPlan(emptyState(), emptyState()), 'download');
  assert.equal(firstConnectPlan(mine, emptyState()), 'upload');
  assert.equal(firstConnectPlan(mine, state([task('a', '2026-10-25T00:00:00.000Z')])), 'download', 'the same data both sides');
  assert.equal(firstConnectPlan(mine, theirs), 'ask');
  // Custom work hours alone are data worth keeping.
  const hours = state([], { workSchedule: { ...emptyState().workSchedule, bufferMinutes: 30 } });
  assert.equal(isBlank(hours), false);
  assert.equal(firstConnectPlan(hours, emptyState()), 'upload');
});

test('merge keeps every task, the newer copy of each, in the backend\'s order', () => {
  const device = state([task('d1', '2026-10-25T00:00:00.000Z'), task('both', '2026-10-25T12:00:00.000Z', { description: 'device copy' }), task('old', '2026-10-01T00:00:00.000Z', { description: 'device old' })], {
    fixedBlocks: [{ id: 'fb-d' }, { id: 'fb-both', label: 'device' }]
  });
  const backend = state([task('both', '2026-10-25T06:00:00.000Z', { description: 'backend copy' }), task('b1', '2026-10-25T00:00:00.000Z'), task('old', '2026-10-02T00:00:00.000Z', { description: 'backend new' })], {
    fixedBlocks: [{ id: 'fb-both', label: 'backend' }],
    workSchedule: { ...emptyState().workSchedule, bufferMinutes: 5 }
  });
  const m = mergeStates(device, backend);
  assert.deepEqual(m.tasks.map(t => [t.id, t.description]), [['both', 'device copy'], ['b1', 'b1'], ['old', 'backend new'], ['d1', 'd1']]);
  assert.deepEqual(m.fixedBlocks, [{ id: 'fb-both', label: 'backend' }, { id: 'fb-d' }]);
  assert.equal(m.workSchedule.bufferMinutes, 5);
});

test('merge keeps a timer only this device is running, if its task survives', () => {
  const timer = { taskId: 'd1', startedAt: new Date('2026-10-26T01:00:00Z'), baseSeconds: 60 };
  const device = state([task('d1', '2026-10-25T00:00:00.000Z')], { activeTimer: timer });
  assert.deepEqual(mergeStates(device, state([task('b1', '2026-10-25T00:00:00.000Z')])).activeTimer, timer);
  const backendTimer = { taskId: 'b1', startedAt: null, baseSeconds: 5 };
  assert.deepEqual(mergeStates(device, state([task('b1', '2026-10-25T00:00:00.000Z')], { activeTimer: backendTimer })).activeTimer, backendTimer);
  const completed = state([task('d1', '2026-10-25T00:00:00.000Z', { isCompleted: true })], { activeTimer: timer });
  assert.equal(mergeStates(completed, emptyState()).activeTimer, null);
});
