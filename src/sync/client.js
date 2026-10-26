// The device side of the sync protocol: a replica (replica.js) kept in step
// with one backend. Operations apply locally at once and wait in the pending
// queue; the client sends the queue over POST /v1/ops and receives every
// device's operations over the /v1/stream WebSocket, falling back to
// GET /v1/ops and GET /v1/state when it has missed some or can't reproduce the
// backend's state.
//
// Plain fetch and WebSocket, so the same code runs in the browser and in Node
// (the tests drive real devices against a real server with it). The app wires
// it to its store in phase 4; until then local-only mode doesn't use it.
//
//   const client = createSyncClient({ url, token, replica, onChange, onPersist, ... });
//   client.start();
//   client.submit(op);   // → the operation's local result, at once
//   client.stop();

import { applyLocal, currentState, pendingOps, receive, rebase, forget, toStored } from './replica.js';
import { reviveState } from '../core/state.js';

export const PROTOCOL = 1;

export function createSyncClient({
  url,
  token,
  replica: initial,
  coreVersion = null,
  onChange = () => {},    // (state) the current state changed
  onPersist = () => {},   // (stored) the replica's stored form changed; save it
  onStatus = () => {},    // ({ state, detail }) connecting | online | offline | error
  onNotice = () => {},    // (message) something the user should hear about
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
  WebSocket: WebSocketImpl = globalThis.WebSocket,
  retry = { minMs: 1000, maxMs: 30_000 }
}) {
  const base = url.replace(/\/+$/, '');
  const streamUrl = base.replace(/^http/, 'ws') + '/v1/stream';

  let replica = initial;
  let status = { state: 'offline', detail: null };
  let info = null;
  let ws = null;
  let stopped = true;
  let online = false;
  let flushing = false;
  let flushAgain = false;
  let attempt = 0;
  let reconnectTimer = null;
  let flushTimer = null;

  // ─── plumbing ──────────────────────────────────────────────────────────────

  function setStatus(state, detail = null) {
    if (status.state === state && status.detail === detail) return;
    status = { state, detail };
    onStatus(status);
  }

  function setReplica(next) {
    if (next === replica) return;
    const before = currentState(replica);
    replica = next;
    const after = currentState(replica);
    if (after !== before) onChange(after);
    onPersist(toStored(replica));
  }

  class HttpError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? `HTTP ${status}`);
      this.status = status;
      this.code = body?.error?.code;
      this.retryAfter = null;
    }
  }

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (auth) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new HttpError(res.status, json);
      err.retryAfter = Number(res.headers.get('Retry-After')) || null;
      throw err;
    }
    return json;
  }

  // Everything that moves the base runs one at a time, so a stream message, a
  // catch-up fetch and a reload can't interleave halfway through each other.
  let chain = Promise.resolve();
  const serial = fn => (chain = chain.then(fn).catch(e => handleError(e)));

  function handleError(e) {
    if (stopped) return;
    if (e instanceof HttpError && e.status === 401) {
      setStatus('error', 'unauthorized');
      return halt();
    }
    // Anything else is a network or server problem; the stream reconnects.
    reconnectSoon();
  }

  // ─── receiving ─────────────────────────────────────────────────────────────

  // A batch of operations the backend applied, ending at batch.version. Parts
  // this device already has are skipped.
  async function ingest(batch) {
    if (replica.version === null) return reload(); // nothing to apply it on top of
    if (batch.version <= replica.version) return;
    let ops = batch.ops;
    const first = batch.version - ops.length;
    if (first < replica.version) ops = ops.slice(replica.version - first);
    const res = receive(replica, { ...batch, ops });
    if (res.gap) return pull();
    if (res.diverged) {
      onNotice('This device and the backend computed different results, so the backend\'s copy was loaded. Updating the app or the backend fixes this.');
      return reload(ops.map(op => op.id));
    }
    for (const { op } of res.dropped) onNotice(`A change (${op.type}) could not be applied on this device and was dropped.`);
    setReplica(res.replica);
  }

  async function pull() {
    if (replica.version === null) return reload();
    let batch;
    try {
      batch = await request(`/v1/ops?since=${replica.version}`);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 409 || e.status === 410)) return reload();
      throw e;
    }
    const res = receive(replica, batch);
    if (res.gap || res.diverged) return reload();
    setReplica(res.replica);
  }

  // `applied`: pending operations known to be in the backend's state already.
  async function reload(applied = []) {
    const { version, state } = await request('/v1/state');
    const res = rebase(replica, { state: reviveState(state), version }, applied);
    for (const { op } of res.dropped) onNotice(`A change (${op.type}) could not be applied on top of the backend's copy and was dropped.`);
    setReplica(res.replica);
  }

  // ─── sending ───────────────────────────────────────────────────────────────

  // Send everything pending. One request at a time; whatever arrives meanwhile
  // goes in the next. Resending is safe: the backend skips ids it has applied.
  async function flush() {
    if (!online) return;
    if (flushing) { flushAgain = true; return; }
    const ops = pendingOps(replica);
    if (!ops.length) return;
    flushing = true;
    try {
      const res = await request('/v1/ops', { method: 'POST', body: { ops } });
      const pending = new Set(pendingOps(replica).map(op => op.id));
      const rejected = res.results.filter(r => r.status === 'rejected' && pending.has(r.id));
      // Normally the stream's batch takes an operation out of the queue. One
      // the backend applied at or before our base version was missed that way
      // (a reload already brought it in), so take it out here.
      const inBase = res.results.filter(r => r.status !== 'rejected' && pending.has(r.id) && replica.version !== null && r.version <= replica.version);
      if (rejected.length || inBase.length) setReplica(forget(replica, [...rejected, ...inBase].map(r => r.id)).replica);
      for (const r of rejected) onNotice(`The backend refused a change: ${r.error?.message ?? 'no reason given'}.`);
      // The stream normally delivers the batch first; if it hasn't, fetch it.
      await serial(() => (replica.version === null || replica.version < res.version ? pull() : undefined));
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) scheduleFlush((e.retryAfter ?? 5) * 1000);
      else if (e instanceof HttpError && e.status === 401) handleError(e);
      else scheduleFlush(backoff());
    } finally {
      flushing = false;
    }
    if (flushAgain) {
      flushAgain = false;
      flush();
    }
  }

  function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), ms);
  }

  // ─── the stream ────────────────────────────────────────────────────────────

  const backoff = () => Math.min(retry.maxMs, retry.minMs * 2 ** Math.min(attempt, 10));

  function reconnectSoon() {
    if (stopped || reconnectTimer) return;
    online = false;
    if (status.state !== 'error') setStatus('offline', 'reconnecting');
    try { ws?.close(); } catch {}
    ws = null;
    const delay = backoff();
    attempt += 1;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }

  function halt() {
    online = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearTimeout(flushTimer);
    try { ws?.close(); } catch {}
    ws = null;
  }

  async function connect() {
    if (stopped) return;
    setStatus('connecting');
    try {
      info = await request('/v1/info', { auth: false });
    } catch {
      return reconnectSoon();
    }
    if (info.protocol !== PROTOCOL) {
      setStatus('error', 'incompatible');
      onNotice(`This backend speaks protocol ${info.protocol}; this app speaks ${PROTOCOL}. Update ${info.protocol > PROTOCOL ? 'the app' : 'the backend'}.`);
      return halt();
    }
    if (coreVersion && info.coreVersion !== coreVersion) {
      onNotice('The backend runs a different version of TaskFlow\'s scheduling code. It still works, but changes may be rearranged when they sync. Redeploy the backend to match.');
    }

    const socket = new WebSocketImpl(streamUrl);
    ws = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token, since: replica.version ?? undefined }));
    socket.onmessage = event => {
      if (socket !== ws) return;
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch { return; }
      if (msg.type === 'ops') serial(() => ingest(msg));
      else if (msg.type === 'reset') serial(() => reload());
      else if (msg.type === 'ready') {
        serial(async () => {
          // A device that has never synced has no version to catch up from.
          if (replica.version === null) await reload();
          attempt = 0;
          online = true;
          setStatus('online');
          flush();
        });
      }
    };
    socket.onclose = event => {
      if (socket !== ws) return;
      if (event.code === 4401) {
        setStatus('error', 'unauthorized');
        return halt();
      }
      reconnectSoon();
    };
    socket.onerror = () => {};
  }

  // ─── public ────────────────────────────────────────────────────────────────

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      halt();
      setStatus('offline', 'stopped');
    },
    // Apply an operation now and queue it for the backend. Returns its local
    // result; throws only if the core does (an unknown type).
    submit(op) {
      const applied = applyLocal(replica, op);
      setReplica(applied.replica);
      flush();
      return applied.result;
    },
    // Resolves once every queued operation is acknowledged and nothing is in
    // flight. For tests and for a "syncing…" indicator.
    async settled() {
      await chain;
      while (flushing || pendingOps(replica).length) {
        await new Promise(r => setTimeout(r, 20));
        await chain;
      }
    },
    get replica() { return replica; },
    get state() { return currentState(replica); },
    get status() { return status; },
    get info() { return info; }
  };
}
