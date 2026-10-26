import { STORAGE_KEY, SYNC_STORAGE_KEY } from './constants.js';
import { emptyState, reviveState, serializeState } from '../core/state.js';

// The current state, in the shape TaskFlow has always saved under taskflow_v2.
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? reviveState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

// The replica's sync bookkeeping, kept beside the state rather than inside it
// so taskflow_v2 stays readable by older versions of the app:
//   { version, pending: [op], base }
// `version` is the backend version `base` corresponds to (null when the device
// has never connected); `pending` the operations not yet acknowledged; `base`
// the last acknowledged state, stored only while something is pending, since
// otherwise it equals the current state. Absent means nothing to track.
export function loadSync() {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version ?? null,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      base:    parsed.base ? reviveState(parsed.base) : null
    };
  } catch {
    return null;
  }
}

export function saveSync(sync) {
  try {
    if (sync.version === null && sync.pending.length === 0) {
      localStorage.removeItem(SYNC_STORAGE_KEY);
      return;
    }
    const base = sync.pending.length ? JSON.parse(serializeState(sync.base)) : undefined;
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ version: sync.version, pending: sync.pending, base }));
  } catch {
    // As above. The state itself is still saved under taskflow_v2.
  }
}

// The backend this device syncs with, { url, token }, or null for local-only.
// Per device: each connects with its own token. Kept out of constants.js, which
// the core imports: changing it would change coreVersion for no reason.
const BACKEND_STORAGE_KEY = 'taskflow_backend';

export function loadBackend() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKEND_STORAGE_KEY));
    return typeof parsed?.url === 'string' && typeof parsed?.token === 'string' ? { url: parsed.url, token: parsed.token } : null;
  } catch {
    return null;
  }
}

export function saveBackend(backend) {
  try {
    if (backend) localStorage.setItem(BACKEND_STORAGE_KEY, JSON.stringify({ url: backend.url, token: backend.token }));
    else localStorage.removeItem(BACKEND_STORAGE_KEY);
  } catch {
    // As above.
  }
}
