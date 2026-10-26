// Connecting a device to a backend (phase 4 of SYNC-AND-API-DESIGN.md): reading
// a connect link, checking a backend before anything is saved, deciding what
// the first connection does with the data already on each side, and merging
// the two when asked to. Plain functions and fetch, so they run in Node too;
// data.svelte.js does the connecting.

import { emptyState, reviveState, serializeState, stateHash } from '../core/state.js';
import { PROTOCOL } from './client.js';

// ─── connect links ───────────────────────────────────────────────────────────

// `taskflow-server token create --link` prints the app's URL with
// #connect=<base64url of { url, token }>. The fragment is never sent to a
// server. Returns { url, token } or null.
export function parseConnectLink(hash) {
  const m = /^#?connect=([A-Za-z0-9_-]+=*)$/.exec(hash ?? '');
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
    if (typeof json?.url !== 'string' || typeof json?.token !== 'string') return null;
    return { url: json.url, token: json.token };
  } catch {
    return null;
  }
}

// ─── the backend URL ─────────────────────────────────────────────────────────

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// What was typed → { url } normalised (scheme added, trailing slashes gone), or
// { error } fit to show. Browsers block an HTTPS page from calling plain HTTP,
// so only a backend on this machine may skip HTTPS.
export function checkBackendUrl(input) {
  let text = (input ?? '').trim();
  if (!text) return { error: 'Enter the backend\'s URL.' };
  if (!/^[a-z]+:\/\//i.test(text)) text = 'https://' + text;
  let u;
  try { u = new URL(text); } catch { return { error: 'That isn\'t a URL.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'The URL must start with https://.' };
  if (u.protocol === 'http:' && !LOCAL_HOSTS.has(u.hostname)) {
    return { error: 'The backend must use https:// (only one on this machine, at localhost, may use http://).' };
  }
  return { url: (u.origin + u.pathname).replace(/\/+$/, '') };
}

// ─── probing ─────────────────────────────────────────────────────────────────

// Check a backend before connecting: it answers, speaks this app's protocol,
// and accepts the token. Saves nothing. Returns
//   { ok: true, url, info, state, version }
//   { ok: false, reason }   with a message fit to show
export async function probeBackend({ url: input, token, fetch: fetchImpl = globalThis.fetch.bind(globalThis), origin = globalThis.location?.origin }) {
  const checked = checkBackendUrl(input);
  if (checked.error) return { ok: false, reason: checked.error };
  const url = checked.url;
  token = (token ?? '').trim();
  if (!token) return { ok: false, reason: 'Enter the token (taskflow-server token create prints one).' };
  const host = new URL(url).host;
  const unreachable = {
    ok: false,
    reason: `Couldn't reach ${host}. Check the URL and that the backend is running`
      + (origin ? `, and that its ALLOWED_ORIGINS includes ${origin}.` : '.')
  };

  let res, info;
  try {
    res = await fetchImpl(url + '/v1/info');
    info = await res.json();
  } catch {
    return unreachable;
  }
  if (!res.ok || typeof info?.protocol !== 'number') return { ok: false, reason: `${host} answered, but it isn't a TaskFlow backend.` };
  if (info.protocol !== PROTOCOL) {
    return {
      ok: false,
      reason: `${host} speaks sync protocol ${info.protocol} and this app speaks ${PROTOCOL}, so they can't sync. Update ${info.protocol > PROTOCOL ? 'the app (reload the page)' : 'the backend (redeploy it)'}.`
    };
  }

  let body;
  try {
    res = await fetchImpl(url + '/v1/state', { headers: { Authorization: `Bearer ${token}` } });
    body = await res.json().catch(() => null);
  } catch {
    return unreachable;
  }
  if (res.status === 401) return { ok: false, reason: `${host} didn't accept that token. It may be mistyped or revoked; create a new one with taskflow-server token create.` };
  if (!res.ok || !body?.state || typeof body.version !== 'number') {
    return { ok: false, reason: body?.error?.message ?? `${host} couldn't send its data (HTTP ${res.status}).` };
  }
  return { ok: true, url, info, state: reviveState(body.state), version: body.version };
}

// ─── the first connection ────────────────────────────────────────────────────

const BLANK = serializeState(emptyState());
export const isBlank = state => serializeState(state) === BLANK;
export const liveTaskCount = state => state.tasks.filter(t => !t.isDeleted).length;

// What connecting does with the data on each side:
//   'download' — take the backend's (this device has nothing, or the same)
//   'upload'   — send this device's (the backend has nothing)
//   'ask'      — both have data: merge, keep the backend's, or keep this device's
export function firstConnectPlan(device, backend) {
  if (isBlank(device) || stateHash(device) === stateHash(backend)) return 'download';
  if (isBlank(backend)) return 'upload';
  return 'ask';
}

// Both copies in one: every task from either side, the more recently modified
// copy where both have it, in the backend's order with this device's own tasks
// after. Fixed blocks are a union by id. Work hours are the backend's, as is
// the timer unless only this device has one running.
export function mergeStates(device, backend) {
  const deviceTasks = new Map(device.tasks.map(t => [t.id, t]));
  const backendIds = new Set(backend.tasks.map(t => t.id));
  const tasks = backend.tasks.map(t => {
    const d = deviceTasks.get(t.id);
    return d && +new Date(d.lastModifiedAt) > +new Date(t.lastModifiedAt) ? d : t;
  });
  for (const t of device.tasks) if (!backendIds.has(t.id)) tasks.push(t);

  const blockIds = new Set(backend.fixedBlocks.map(b => b.id));
  const fixedBlocks = [...backend.fixedBlocks, ...device.fixedBlocks.filter(b => !blockIds.has(b.id))];

  let activeTimer = backend.activeTimer;
  if (!activeTimer && device.activeTimer && tasks.some(t => t.id === device.activeTimer.taskId && !t.isDeleted && !t.isCompleted)) {
    activeTimer = device.activeTimer;
  }
  return { tasks, workSchedule: backend.workSchedule, fixedBlocks, activeTimer };
}
