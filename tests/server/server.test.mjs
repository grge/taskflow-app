// The reference backend, end to end over real sockets: the conformance suite,
// what is specific to this implementation (persistence, pruning, rate limits,
// revocation), and real sync clients converging through it.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../server/store.js';
import { createApp } from '../../server/app.js';
import { apply } from '../../src/core/apply.js';
import { coreVersion } from '../../scripts/core-version.mjs';
import { conformanceTests } from '../conformance/suite.mjs';
import { emptyState, stateHash } from '../../src/core/state.js';
import { createReplica, pendingOps } from '../../src/sync/replica.js';
import { createSyncClient } from '../../src/sync/client.js';

const ORIGIN = 'https://grge.github.io';
const dirs = [];
after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

async function startServer({ dir, port = 0, ...config } = {}) {
  if (!dir) { dir = mkdtempSync(join(tmpdir(), 'taskflow-test-')); dirs.push(dir); }
  const store = openStore(join(dir, 'taskflow.db'));
  const app = createApp({ store, config: { allowedOrigins: [ORIGIN], coreVersion: coreVersion(), homeTimeZone: 'UTC', ...config } });
  await new Promise(r => app.server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return {
    dir, url, app, store,
    port: app.server.address().port,
    async stop() { await app.close(); store.close(); }
  };
}

const op = (type, args = {}) => ({ id: crypto.randomUUID(), type, args, at: new Date().toISOString(), tz: 'UTC', actor: 'app' });
const addTask = (id, description) => op('task.add', {
  id, description, onset: new Date(Date.now() - 86_400_000).toISOString(), peak: new Date(Date.now() + 3 * 86_400_000).toISOString(), peakPressure: 0.5, estimatedMinutes: 30
});
const authed = (url, token) => (path, init = {}) => fetch(url + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });

async function until(cond, ms = 3000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function device(url, token, { replica, ...rest } = {}) {
  const notices = [];
  const client = createSyncClient({
    url, token,
    replica: replica ?? createReplica({ base: emptyState(), version: null }).replica,
    coreVersion: coreVersion(),
    onNotice: m => notices.push(m),
    retry: { minMs: 50, maxMs: 200 },
    ...rest
  });
  client.notices = notices;
  return client;
}
const online = c => until(() => c.status.state === 'online', 3000, 'online');

// ─── the contract ────────────────────────────────────────────────────────────

describe('conformance', async () => {
  const srv = await startServer();
  const token = srv.store.createToken('suite', 'write');
  const readToken = srv.store.createToken('reader', 'read');
  after(() => srv.stop());
  for (const t of conformanceTests({ url: srv.url, token, readToken, origin: ORIGIN })) {
    test(t.name, async ctx => {
      const note = await t.fn();
      if (note) ctx.diagnostic(note);
    });
  }
});

// ─── this implementation ─────────────────────────────────────────────────────

test('state, log and duplicate detection survive a restart', async () => {
  const srv = await startServer();
  const token = srv.store.createToken('t', 'write');
  const first = addTask('a', 'Survives');
  await authed(srv.url, token)('/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [first, op('schedule.next', { id: 'a' })] }) });
  const before = await (await authed(srv.url, token)('/v1/state')).json();
  await srv.stop();

  const again = await startServer({ dir: srv.dir });
  after(() => again.stop());
  const after_ = await (await authed(again.url, token)('/v1/state')).json();
  assert.deepEqual(after_, before);
  const retry = await (await authed(again.url, token)('/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [first] }) })).json();
  assert.equal(retry.results[0].status, 'duplicate');
});

test('pruned history answers 410, and the stream says reset', async () => {
  const srv = await startServer({ historyLimit: 3, pruneEvery: 5 });
  after(() => srv.stop());
  const token = srv.store.createToken('t', 'write');
  const api = authed(srv.url, token);
  for (let i = 0; i < 6; i++) await api('/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [addTask(`t${i}`, `T${i}`)] }) });
  assert.equal((await api('/v1/ops?since=0')).status, 410);
  assert.equal((await api('/v1/ops?since=3')).status, 200);

  const ws = new WebSocket(srv.url.replace('http', 'ws') + '/v1/stream');
  await new Promise(r => { ws.onopen = r; });
  const first = new Promise(r => { ws.onmessage = e => r(JSON.parse(e.data)); });
  ws.send(JSON.stringify({ type: 'auth', token, since: 0 }));
  assert.equal((await first).type, 'reset');
  ws.close();
});

test('writes are rate limited per token, with Retry-After', async () => {
  const srv = await startServer({ rateLimit: { perMinute: 60, burst: 3 } });
  after(() => srv.stop());
  const api = authed(srv.url, srv.store.createToken('t', 'write'));
  const send = n => api('/v1/ops', { method: 'POST', body: JSON.stringify({ ops: Array.from({ length: n }, (_, i) => addTask(crypto.randomUUID(), `R${i}`)) }) });
  assert.equal((await send(3)).status, 200);
  const limited = await send(2);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  const other = authed(srv.url, srv.store.createToken('other', 'write'));
  assert.equal((await other('/v1/state')).status, 200, 'reads are not limited');
});

test('a revoked token stops working at once', async () => {
  const srv = await startServer();
  after(() => srv.stop());
  const token = srv.store.createToken('laptop', 'write');
  assert.equal((await authed(srv.url, token)('/v1/state')).status, 200);
  assert.equal(srv.store.revokeToken('laptop'), true);
  assert.equal((await authed(srv.url, token)('/v1/state')).status, 401);
});

// ─── sync clients through the real server ────────────────────────────────────

test('two devices converge on the backend within 2 seconds', async () => {
  const srv = await startServer();
  after(() => srv.stop());
  const laptop = device(srv.url, srv.store.createToken('laptop', 'write'));
  const phone = device(srv.url, srv.store.createToken('phone', 'write'));
  after(() => { laptop.stop(); phone.stop(); });
  laptop.start(); phone.start();
  await Promise.all([online(laptop), online(phone)]);

  const started = Date.now();
  laptop.submit(addTask('l', 'From the laptop'));
  phone.submit(addTask('p', 'From the phone'));
  laptop.submit(op('schedule.next', { id: 'l' }));
  phone.submit(op('schedule.next', { id: 'p' }));

  const serverHash = async () => (await (await authed(srv.url, srv.store.createToken(`check${Date.now()}`, 'read'))('/v1/state')).json()).hash;
  await until(() => pendingOps(laptop.replica).length + pendingOps(phone.replica).length === 0 && laptop.replica.version === 4 && phone.replica.version === 4, 2000, 'both devices at version 4');
  const elapsed = Date.now() - started;
  const hash = await serverHash();
  assert.equal(stateHash(laptop.state), hash);
  assert.equal(stateHash(phone.state), hash);
  assert.ok(elapsed < 2000, `converged in ${elapsed}ms`);
  const [a, b] = laptop.state.tasks.map(t => t.scheduledBlocks[0]);
  assert.ok(a && b && (a.startMinutes !== b.startMinutes || a.date !== b.date), 'the two schedule.next calls got different slots');
  assert.deepEqual([...laptop.notices, ...phone.notices], []);
});

test('edits made while the backend is down apply when it returns', async () => {
  const srv = await startServer();
  const token = srv.store.createToken('laptop', 'write');
  const watcherToken = srv.store.createToken('watcher', 'write');
  const laptop = device(srv.url, token);
  const watcher = device(srv.url, watcherToken);
  after(() => { laptop.stop(); watcher.stop(); });
  laptop.start(); watcher.start();
  await Promise.all([online(laptop), online(watcher)]);
  laptop.submit(addTask('before', 'Before the outage'));
  await until(() => watcher.state.tasks.length === 1, 2000, 'first edit synced');

  await srv.stop();
  await until(() => laptop.status.state !== 'online', 2000, 'laptop notices');
  laptop.submit(addTask('during', 'Written offline'));
  laptop.submit(op('schedule.next', { id: 'during' }));
  assert.equal(pendingOps(laptop.replica).length, 2, 'queued');
  assert.equal(laptop.state.tasks.length, 2, 'and already visible on the laptop');

  const back = await startServer({ dir: srv.dir, port: srv.port });
  after(() => back.stop());
  await until(() => watcher.state.tasks.length === 2 && pendingOps(laptop.replica).length === 0, 5000, 'offline edits synced after the restart');
  assert.equal(stateHash(watcher.state), stateHash(laptop.state));
  assert.equal(watcher.state.tasks[1].scheduledBlocks.length, 1);
});

test('a queue left at reload is sent by the next session', async () => {
  const srv = await startServer();
  after(() => srv.stop());
  const token = srv.store.createToken('phone', 'write');
  let stored = null;
  const first = device(srv.url, token, { onPersist: s => { stored = s; } });
  first.start();
  await online(first);
  first.stop();
  first.submit(addTask('q', 'Queued at close'));
  assert.equal(stored.pending.length, 1, 'the queue was handed to storage');

  // What the app does on load: a replica from storage, then connect.
  const json = JSON.parse(JSON.stringify(stored));
  const { reviveState } = await import('../../src/core/state.js');
  const replica = createReplica({ base: reviveState(json.base), version: json.version, pending: json.pending }).replica;
  const second = device(srv.url, token, { replica });
  after(() => second.stop());
  second.start();
  await until(() => pendingOps(second.replica).length === 0 && second.replica.version === 1, 3000, 'queue flushed');
  const state = await (await authed(srv.url, token)('/v1/state')).json();
  assert.deepEqual(state.state.tasks.map(t => t.description), ['Queued at close']);
});

test('a device that has never synced loads the backend and keeps its own pending edits', async () => {
  const srv = await startServer();
  after(() => srv.stop());
  const token = srv.store.createToken('laptop', 'write');
  await authed(srv.url, token)('/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [addTask('existing', 'Already there')] }) });

  let replica = createReplica({ base: emptyState(), version: null }).replica;
  const fresh = device(srv.url, token, { replica });
  after(() => fresh.stop());
  fresh.submit(addTask('mine', 'Added before connecting'));
  fresh.start();
  await until(() => fresh.replica.version === 2 && pendingOps(fresh.replica).length === 0, 3000, 'synced');
  assert.deepEqual(fresh.state.tasks.map(t => t.description), ['Already there', 'Added before connecting']);
});

test('a revoked token disconnects the device with a clear status', async () => {
  const srv = await startServer();
  after(() => srv.stop());
  const token = srv.store.createToken('lost-phone', 'write');
  const phone = device(srv.url, token);
  after(() => phone.stop());
  srv.store.revokeToken('lost-phone');
  phone.start();
  await until(() => phone.status.state === 'error', 3000, 'error status');
  assert.equal(phone.status.detail, 'unauthorized');
});

test('a backend on another protocol is refused', async () => {
  const fake = (await import('node:http')).createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'future', protocol: 2, coreVersion: 'x', features: [], homeTimeZone: 'UTC' }));
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  after(() => fake.close());
  const c = device(`http://127.0.0.1:${fake.address().port}`, 'tf_x');
  after(() => c.stop());
  c.start();
  await until(() => c.status.state === 'error', 2000, 'refused');
  assert.equal(c.status.detail, 'incompatible');
  assert.match(c.notices[0], /protocol 2/);
});

// Version skew: the backend's scheduler differs from the device's (here, it
// schedules everything an hour later). The device's own answer must not stick;
// it takes the backend's, and says why.
test('a backend with a different core wins, and the device says so', async () => {
  const olderCore = (state, o, ctx) => {
    const out = apply(state, o, ctx);
    if (o.type !== 'schedule.next') return out;
    const tasks = out.state.tasks.map(t => (t.id === o.args.id ? { ...t, scheduledBlocks: t.scheduledBlocks.map(b => ({ ...b, startMinutes: b.startMinutes + 60 })) } : t));
    return { ...out, state: { ...out.state, tasks } };
  };
  const srv = await startServer({ apply: olderCore, coreVersion: 'older-core' });
  after(() => srv.stop());
  const token = srv.store.createToken('laptop', 'write');
  const laptop = device(srv.url, token);
  after(() => laptop.stop());
  laptop.start();
  await online(laptop);
  assert.match(laptop.notices[0] ?? '', /different version/, 'warned about the core version on connect');

  laptop.submit(addTask('a', 'Skewed'));
  laptop.submit(op('schedule.next', { id: 'a' }));
  const localStart = laptop.state.tasks[0].scheduledBlocks[0].startMinutes;
  await until(() => pendingOps(laptop.replica).length === 0 && laptop.replica.version === 2, 3000, 'synced');
  const server = await (await authed(srv.url, token)('/v1/state')).json();
  assert.equal(stateHash(laptop.state), server.hash, 'the device holds the backend\'s state');
  assert.equal(laptop.state.tasks[0].scheduledBlocks[0].startMinutes, localStart + 60);
  assert.ok(laptop.notices.some(n => /computed different results/.test(n)), 'and explained the change');
});
