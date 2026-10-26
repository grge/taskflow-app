// The protocol conformance suite: what any TaskFlow backend must do, checked
// over the wire with plain fetch and WebSocket. It runs against the reference
// backend in `npm run test:server`, and against any other with
//
//   node tests/conformance/run.mjs --url https://… --token <write token> [--read-token <read token>] [--origin <allowed origin>]
//
// It needs an empty backend (version 0) and leaves test tasks behind, so point
// it at a fresh one, never at one holding real data.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OP_TYPES } from '../../src/core/apply.js';
import { reviveState, stateHash } from '../../src/core/state.js';
import { coreVersion } from '../../scripts/core-version.mjs';

const REPLAY = fileURLToPath(new URL('./replay.mjs', import.meta.url));

export const PROTOCOL = 1;

class Check extends Error {}
const check = (cond, msg) => { if (!cond) throw new Check(msg); };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// Times a backend accepts as-is: an hour ago, give or take a minute per op.
const at = (n = 0) => new Date(Date.now() - 3_600_000 + n * 60_000).toISOString();
let seq = 0;
const uid = p => `conformance-${p}-${Date.now().toString(36)}-${(seq += 1)}`;

const addTask = (id, description, n = 0) => ({
  id: uid('op'), type: 'task.add', at: at(n), tz: 'UTC',
  args: { id, description, onset: at(-60 * 24), peak: at(60 * 24 * 3), peakPressure: 0.5, estimatedMinutes: 30 }
});

export function conformanceTests({ url, token, readToken = null, origin = null }) {
  const base = url.replace(/\/+$/, '');

  async function api(path, { method = 'GET', body, auth = token, headers = {} } = {}) {
    const h = { ...headers };
    if (auth) h.Authorization = `Bearer ${auth}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, headers: res.headers };
  }
  const post = ops => api('/v1/ops', { method: 'POST', body: { ops } });

  // A stream socket whose messages can be awaited in order.
  function stream() {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/v1/stream');
    const inbox = [];
    const waiters = [];
    let closed = null;
    const settle = () => {
      while (waiters.length && (inbox.length || closed)) {
        const w = waiters.shift();
        clearTimeout(w.timer);
        inbox.length ? w.resolve(inbox.shift()) : w.reject(new Check(`stream closed (${closed.code} ${closed.reason})`));
      }
    };
    ws.onmessage = e => { inbox.push(JSON.parse(e.data)); settle(); };
    ws.onclose = e => { closed = { code: e.code, reason: e.reason }; settle(); };
    const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Check('stream failed to open')); });
    return {
      opened,
      send: msg => ws.send(JSON.stringify(msg)),
      next(ms = 3000) {
        return new Promise((resolve, reject) => {
          const w = { resolve, reject, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Check(`no stream message within ${ms}ms`)); }, ms) };
          waiters.push(w);
          settle();
        });
      },
      closed: () => new Promise(resolve => { if (closed) resolve(closed); else ws.addEventListener('close', e => resolve({ code: e.code, reason: e.reason })); }),
      close: () => ws.close()
    };
  }

  // Every operation the backend has applied, as it reports them, replayed with
  // this repo's core in the backend's home timezone, must reproduce the
  // backend's hash, provided the two run the same core.
  async function replayMatches() {
    const { json: info } = await api('/v1/info', { auth: null });
    if (info.coreVersion !== coreVersion()) return 'skipped: backend runs a different core';
    const { json: log } = await api('/v1/ops?since=0');
    const r = spawnSync(process.execPath, [REPLAY], { input: JSON.stringify(log.ops), env: { ...process.env, TZ: info.homeTimeZone }, encoding: 'utf8' });
    check(r.status === 0, `replay failed: ${r.stderr}`);
    eq(r.stdout, log.hash, `hash of the log replayed in ${info.homeTimeZone}`);
    return null;
  }

  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('starts empty (run the suite against a fresh backend)', async () => {
    const r = await api('/v1/state');
    eq(r.status, 200, 'GET /v1/state');
    eq(r.json.version, 0, 'version of a fresh backend');
  });

  test('/v1/info is public and describes the backend', async () => {
    const r = await api('/v1/info', { auth: null });
    eq(r.status, 200, 'status');
    eq(r.json.protocol, PROTOCOL, 'protocol');
    check(typeof r.json.name === 'string', 'name is a string');
    check(typeof r.json.coreVersion === 'string', 'coreVersion is a string');
    check(typeof r.json.homeTimeZone === 'string', 'homeTimeZone is a string');
    check(Array.isArray(r.json.features), 'features is a list');
    for (const t of ['task.add', 'schedule.next', 'data.import']) check(r.json.features.includes(t), `features include ${t}`);
    check(r.json.features.every(f => OP_TYPES.includes(f)), 'features are operation types this app knows');
  });

  test('everything else needs a valid token', async () => {
    for (const [path, method] of [['/v1/state', 'GET'], ['/v1/ops?since=0', 'GET'], ['/v1/ops', 'POST']]) {
      eq((await api(path, { method, auth: null, body: method === 'POST' ? { ops: [] } : undefined })).status, 401, `${method} ${path} without a token`);
      eq((await api(path, { method, auth: 'tf_not-a-real-token', body: method === 'POST' ? { ops: [] } : undefined })).status, 401, `${method} ${path} with a wrong token`);
    }
  });

  test('POST /v1/ops applies operations in order, one version each', async () => {
    const a = uid('task'), b = uid('task');
    const ops = [addTask(a, 'Alpha', 0), addTask(b, 'Bravo', 1), { id: uid('op'), type: 'schedule.next', at: at(2), args: { id: a } }];
    const r = await post(ops);
    eq(r.status, 200, 'status');
    eq(r.json.results.map(x => [x.id, x.status, x.version]), ops.map((o, i) => [o.id, 'applied', i + 1]), 'results');
    eq(r.json.version, 3, 'version');
    check(r.json.results[2].result?.ok === true, 'schedule.next reports its placement');
    const s = await api('/v1/state');
    eq(s.json.version, 3, 'state version');
    eq(s.json.state.tasks.map(t => t.description), ['Alpha', 'Bravo'], 'tasks in order');
    eq(s.json.hash, r.json.hash, 'state hash matches the POST response');
    eq(stateHash(reviveState(s.json.state)), s.json.hash, 'hash is stateHash of the state');
    const skipped = await replayMatches();
    if (skipped) return skipped;
  });

  test('a retried operation is applied once', async () => {
    const before = (await api('/v1/state')).json;
    const op = addTask(uid('task'), 'Once');
    const first = await post([op]);
    const again = await post([op]);
    eq(again.json.results[0].status, 'duplicate', 'status of the retry');
    eq(again.json.results[0].version, first.json.results[0].version, 'reports the original version');
    eq(again.json.version, before.version + 1, 'version moved once');
    eq((await api('/v1/state')).json.state.tasks.filter(t => t.description === 'Once').length, 1, 'one task');
  });

  test('a bad operation is rejected alone; the rest of the batch applies', async () => {
    const before = (await api('/v1/state')).json.version;
    const good = addTask(uid('task'), 'Survivor');
    const r = await post([
      { id: uid('op'), type: 'task.noSuchThing', at: at(), args: {} },
      { id: uid('op'), type: 'task.add', args: {} },
      good
    ]);
    eq(r.json.results.map(x => x.status), ['rejected', 'rejected', 'applied'], 'statuses');
    check(typeof r.json.results[0].error?.message === 'string', 'a rejection says why');
    eq(r.json.version, before + 1, 'only the good one took a version');
  });

  test('an operation stamped in the future is applied at the backend\'s time', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const r = await post([{ ...addTask(uid('task'), 'Time traveller'), at: tomorrow }]);
    const appliedAt = Date.parse(r.json.results[0].at);
    check(appliedAt < Date.now() + 5 * 60_000, `applied at ${r.json.results[0].at}, not tomorrow`);
    const { json: log } = await api(`/v1/ops?since=${r.json.version - 1}`);
    eq(log.ops[0].at, r.json.results[0].at, 'the log records the time it was applied at');
  });

  test('malformed requests get 400', async () => {
    eq((await api('/v1/ops', { method: 'POST', body: 'not json' })).status, 400, 'non-JSON body');
    eq((await api('/v1/ops', { method: 'POST', body: { ops: [] } })).status, 400, 'empty ops');
    eq((await api('/v1/ops', { method: 'POST', body: { nope: 1 } })).status, 400, 'no ops');
    eq((await api('/v1/ops?since=-1')).status, 400, 'negative since');
    eq((await api('/v1/ops?since=abc')).status, 400, 'non-numeric since');
  });

  test('GET /v1/ops returns the log after a version', async () => {
    const { json: now } = await api('/v1/state');
    const all = await api('/v1/ops?since=0');
    eq(all.status, 200, 'status');
    eq(all.json.version, now.version, 'version');
    eq(all.json.ops.length, now.version, 'one op per version');
    eq(all.json.hash, now.hash, 'hash of the state at that version');
    const tail = await api(`/v1/ops?since=${now.version - 2}`);
    eq(tail.json.ops.map(o => o.id), all.json.ops.slice(-2).map(o => o.id), 'the last two');
    eq((await api(`/v1/ops?since=${now.version}`)).json.ops, [], 'nothing after the current version');
    eq((await api(`/v1/ops?since=${now.version + 5}`)).status, 409, 'a version from the future');
  });

  test('a read token can read but not write', async () => {
    if (!readToken) return 'skipped: no --read-token';
    eq((await api('/v1/state', { auth: readToken })).status, 200, 'read');
    eq((await api('/v1/ops', { method: 'POST', auth: readToken, body: { ops: [addTask(uid('task'), 'Nope')] } })).status, 403, 'write');
  });

  test('the stream needs a token as its first message', async () => {
    const s = stream();
    await s.opened;
    s.send({ type: 'auth', token: 'tf_wrong' });
    eq((await s.closed()).code, 4401, 'close code for a wrong token');
  });

  test('the stream pushes every applied batch, with version and hash', async () => {
    const { json: now } = await api('/v1/state');
    const s = stream();
    await s.opened;
    s.send({ type: 'auth', token, since: now.version });
    eq((await s.next()).type, 'ready', 'first message when already current');
    const r = await post([addTask(uid('task'), 'Pushed'), addTask(uid('task'), 'Pushed too')]);
    const msg = await s.next();
    eq([msg.type, msg.version, msg.hash], ['ops', r.json.version, r.json.hash], 'pushed batch');
    eq(msg.ops.map(o => o.id), r.json.results.map(x => x.id), 'the batch\'s operations');
    s.close();
  });

  test('the stream catches a device up from its version', async () => {
    const { json: now } = await api('/v1/state');
    const s = stream();
    await s.opened;
    s.send({ type: 'auth', token, since: now.version - 2 });
    const catchUp = await s.next();
    eq([catchUp.type, catchUp.version, catchUp.ops.length, catchUp.hash], ['ops', now.version, 2, now.hash], 'catch-up batch');
    eq((await s.next()).type, 'ready', 'then ready');
    s.close();

    const ahead = stream();
    await ahead.opened;
    ahead.send({ type: 'auth', token, since: now.version + 10 });
    eq((await ahead.next()).type, 'reset', 'a version it can\'t serve means reload');
    ahead.close();
  });

  test('CORS: an allowed origin may call, others may not', async () => {
    if (!origin) return 'skipped: no --origin';
    const pre = await api('/v1/ops', { method: 'OPTIONS', auth: null, headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    check(pre.status === 204 || pre.status === 200, `preflight status ${pre.status}`);
    eq(pre.headers.get('access-control-allow-origin'), origin, 'preflight allows the origin');
    check(/authorization/i.test(pre.headers.get('access-control-allow-headers') ?? ''), 'preflight allows Authorization');
    const real = await api('/v1/state', { headers: { Origin: origin } });
    eq(real.headers.get('access-control-allow-origin'), origin, 'response allows the origin');
    const evil = await api('/v1/state', { headers: { Origin: 'https://not-allowed.example' } });
    check(evil.headers.get('access-control-allow-origin') !== 'https://not-allowed.example', 'another origin is not allowed');
  });

  test('data.import replaces the state through the log', async () => {
    const r = await post([{ id: uid('op'), type: 'data.import', at: at(), args: { data: { tasks: [], workSchedule: null, activeTimer: null, fixedBlocks: [] } } }]);
    eq(r.json.results[0].status, 'applied', 'status');
    eq((await api('/v1/state')).json.state.tasks, [], 'tasks after importing an empty file');
    const skipped = await replayMatches();
    if (skipped) return skipped;
  });

  return tests;
}

// Run the tests in order, stopping the clock on none of them. Returns
// [{ name, ok, note, error }].
export async function runConformance(opts, { only } = {}) {
  const out = [];
  for (const t of conformanceTests(opts)) {
    if (only && !t.name.includes(only)) continue;
    try {
      const note = await t.fn();
      out.push({ name: t.name, ok: true, note: note ?? null });
    } catch (error) {
      out.push({ name: t.name, ok: false, error });
      if (t.name.startsWith('starts empty')) break;
    }
  }
  return out;
}
