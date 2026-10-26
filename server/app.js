// The reference backend's HTTP and WebSocket surface: the protocol contract in
// SYNC-AND-API-DESIGN.md, served with plain node:http and `ws`.
//
//   GET  /v1/info            unauthenticated: name, protocol, coreVersion, features, homeTimeZone
//   GET  /v1/state           { version, state, hash }
//   GET  /v1/ops?since=N     { version, ops, hash }; 410 if pruned, 409 if N is in the future
//   POST /v1/ops             { ops: [op] } → { version, hash, results: [{ id, status, ... }] }
//   GET  /v1/stream          WebSocket; first message { type: 'auth', token, since? }
//   GET  /healthz            for the host's health checks
//
// One process, one writer: operations are applied synchronously, one at a
// time, in the order they arrive, so the log's order is the only order there is.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { apply, OP_TYPES } from '../src/core/apply.js';
import { stateHash } from '../src/core/state.js';

export const PROTOCOL = 1;

// A device's clock may run fast; an operation stamped in the future is applied
// at the server's time instead, so it can't schedule work from a moment that
// hasn't happened. The operation is logged with the time it was applied at,
// and devices replay that.
const MAX_CLOCK_LEAD_MS = 2 * 60_000;
const AUTH_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 25_000;  // under the idle timeouts of common proxies

export function createApp({ store, config }) {
  const {
    allowedOrigins, coreVersion, homeTimeZone,
    historyLimit = 10_000, pruneEvery = 500, maxBodyBytes = 5 * 1024 * 1024,
    rateLimit = { perMinute: 60, burst: 300 },
    clock = () => new Date(),
    log = () => {},
    // Tests only: stand in a different core, to play a backend that hasn't
    // been redeployed since the scheduler changed.
    apply: applyOp = apply
  } = config;

  let { version, state } = store.load();
  let hash = stateHash(state);

  // ─── helpers ───────────────────────────────────────────────────────────────

  const originAllowed = origin => !origin || allowedOrigins.includes(origin);

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }
  const fail = (res, status, code, message, headers) => send(res, status, { error: { code, message } }, headers);

  function bearer(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    return m ? m[1] : null;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', c => {
        size += c.length;
        if (size > maxBodyBytes) {
          reject(Object.assign(new Error('too large'), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  // Token bucket per token: `burst` operations at once (a device flushing an
  // offline queue), refilling at `perMinute` (a looping script hits the floor).
  const buckets = new Map();
  function takeTokens(name, n) {
    const now = Date.now();
    const b = buckets.get(name) ?? { level: rateLimit.burst, at: now };
    b.level = Math.min(rateLimit.burst, b.level + ((now - b.at) / 60_000) * rateLimit.perMinute);
    b.at = now;
    buckets.set(name, b);
    if (b.level < n) return Math.ceil(((n - b.level) / rateLimit.perMinute) * 60);
    b.level -= n;
    return 0;
  }

  // ─── operations ────────────────────────────────────────────────────────────

  const KNOWN = new Set(OP_TYPES);

  function invalid(op) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return 'an operation must be an object';
    if (typeof op.id !== 'string' || op.id.length < 1 || op.id.length > 128) return 'id must be a string of 1–128 characters';
    if (!KNOWN.has(op.type)) return `unknown operation type ${JSON.stringify(op.type)}`;
    if (op.args !== undefined && (typeof op.args !== 'object' || op.args === null || Array.isArray(op.args))) return 'args must be an object';
    if (typeof op.at !== 'string' || Number.isNaN(Date.parse(op.at))) return 'at must be an ISO timestamp';
    if (op.tz !== undefined && (typeof op.tz !== 'string' || op.tz.length > 64)) return 'tz must be a timezone name';
    return null;
  }

  // Apply a batch in order. Each operation stands alone: a rejected one doesn't
  // stop the rest, and one already applied (a retried send) is reported, not
  // applied twice.
  function applyBatch(ops, actor) {
    const results = [];
    const applied = [];
    for (const raw of ops) {
      const id = typeof raw?.id === 'string' ? raw.id : null;
      const seen = id && store.findOp(id);
      if (seen) {
        results.push({ id, status: 'duplicate', version: seen.version, result: seen.result });
        continue;
      }
      const problem = invalid(raw);
      if (problem) {
        results.push({ id, status: 'rejected', error: { code: 'invalid-operation', message: problem } });
        continue;
      }
      const received = clock();
      const at = Date.parse(raw.at) > +received + MAX_CLOCK_LEAD_MS ? received.toISOString() : new Date(raw.at).toISOString();
      const op = { id, type: raw.type, args: raw.args ?? {}, at, tz: raw.tz, actor };
      let outcome;
      try {
        outcome = applyOp(state, op, { now: new Date(op.at) });
      } catch (e) {
        results.push({ id, status: 'rejected', error: { code: 'apply-failed', message: e.message } });
        continue;
      }
      // JSON round trip: the result as stored, so a duplicate reports the same.
      const result = outcome.result === undefined ? undefined : JSON.parse(JSON.stringify(outcome.result));
      store.append(version + 1, op, result, outcome.state, received.toISOString());
      version += 1;
      state = outcome.state;
      applied.push(op);
      results.push({ id, status: 'applied', version, at: op.at, result });
    }
    if (applied.length) {
      hash = stateHash(state);
      broadcast({ type: 'ops', version, ops: applied, hash });
      if (version % pruneEvery < applied.length) store.prune(version, historyLimit);
      log(`applied ${applied.length} op(s) from ${actor} → v${version}`);
    }
    return { version, hash, results };
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;

    if (origin) {
      if (!originAllowed(origin)) {
        return fail(res, 403, 'origin-not-allowed', `This backend doesn't accept requests from ${origin}. Add it to ALLOWED_ORIGINS.`);
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400'
      });
      return res.end();
    }

    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /healthz') return send(res, 200, { ok: true });
    if (route === 'GET /v1/info') {
      return send(res, 200, { name: 'taskflow-server', protocol: PROTOCOL, coreVersion, features: OP_TYPES, homeTimeZone });
    }

    const known = ['GET /v1/state', 'GET /v1/ops', 'POST /v1/ops'];
    if (!known.includes(route)) return fail(res, 404, 'not-found', `No such endpoint: ${req.method} ${url.pathname}`);

    const who = store.authenticate(bearer(req));
    if (!who) return fail(res, 401, 'unauthorized', 'A valid token is required.', { 'WWW-Authenticate': 'Bearer' });

    if (route === 'GET /v1/state') return send(res, 200, { version, state, hash });

    if (route === 'GET /v1/ops') {
      const since = Number(url.searchParams.get('since'));
      if (!Number.isInteger(since) || since < 0) return fail(res, 400, 'bad-request', 'since must be a version number.');
      if (since > version) return fail(res, 409, 'unknown-version', `Version ${since} is ahead of this backend (${version}). Reload the state.`);
      const ops = store.opsSince(since);
      if (!ops) return fail(res, 410, 'history-pruned', `History before version ${store.prunedThrough()} has been pruned. Reload the state.`);
      return send(res, 200, { version, ops, hash });
    }

    // POST /v1/ops
    if (who.scope !== 'write') return fail(res, 403, 'read-only', `The token "${who.name}" can read but not write.`);
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      if (e.status === 413) return fail(res, 413, 'too-large', `A request may be at most ${maxBodyBytes} bytes.`);
      return fail(res, 400, 'bad-request', 'The body must be JSON: { "ops": [ ... ] }.');
    }
    if (!Array.isArray(body?.ops) || body.ops.length === 0) return fail(res, 400, 'bad-request', 'The body must be { "ops": [ ... ] } with at least one operation.');
    const wait = takeTokens(who.name, body.ops.length);
    if (wait) return fail(res, 429, 'rate-limited', `Too many operations; try again in ${wait}s.`, { 'Retry-After': String(wait) });
    return send(res, 200, applyBatch(body.ops, who.name));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      log(`error: ${e.stack ?? e}`);
      if (!res.headersSent) fail(res, 500, 'internal', 'The backend hit an unexpected error.');
      else res.end();
    });
  });

  // ─── WebSocket stream ──────────────────────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const listeners = new Set();  // authenticated sockets: { ws, token, name }

  function broadcast(message) {
    const text = JSON.stringify(message);
    for (const l of listeners) if (l.ws.readyState === l.ws.OPEN) l.ws.send(text);
  }

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/v1/stream' || !originAllowed(req.headers.origin)) {
      socket.write(`HTTP/1.1 ${pathname !== '/v1/stream' ? '404 Not Found' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`);
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, ws => onSocket(ws));
  });

  // Browsers can't set headers on a WebSocket, so the token comes as the first
  // message rather than in the URL, where proxies would log it.
  function onSocket(ws) {
    let listener = null;
    let alive = true;
    const authTimer = setTimeout(() => ws.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);

    ws.on('pong', () => { alive = true; });
    ws.on('message', data => {
      if (listener) return; // the stream is one-way after auth
      let msg;
      try { msg = JSON.parse(String(data)); } catch { msg = null; }
      const who = msg?.type === 'auth' ? store.authenticate(msg.token) : null;
      clearTimeout(authTimer);
      if (!who) return ws.close(4401, 'unauthorized');

      listener = { ws, token: msg.token, name: who.name };
      // Catch up from where the device left off, then say it is current.
      const since = Number.isInteger(msg.since) ? msg.since : null;
      if (since !== null && since !== version) {
        const ops = since < version ? store.opsSince(since) : null;
        ws.send(JSON.stringify(ops ? { type: 'ops', version, ops, hash } : { type: 'reset', version }));
      }
      ws.send(JSON.stringify({ type: 'ready', version }));
      listeners.add(listener);
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (listener) listeners.delete(listener);
    });
    ws.on('error', () => {});

    // Keep the connection alive through proxies, drop dead ones, and notice a
    // token revoked since the socket authenticated.
    const pinger = setInterval(() => {
      if (!alive) return ws.terminate();
      if (listener && !store.authenticate(listener.token)) return ws.close(4401, 'token revoked');
      alive = false;
      ws.ping();
    }, PING_INTERVAL_MS);
    ws.on('close', () => clearInterval(pinger));
  }

  return {
    server,
    get version() { return version; },
    close() {
      for (const l of listeners) l.ws.close(1001, 'server shutting down');
      wss.close();
      const closed = new Promise(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      return closed;
    }
  };
}
