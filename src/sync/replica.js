// A device's copy of the data, as the sync protocol sees it: the last state a
// backend acknowledged (`base`, at `version`), plus the operations applied
// locally since then and not yet acknowledged (`pending`). The current state is
// base with pending replayed on top. Pure: every function returns a new replica.
//
//   replica — { base, version, pending: [{ op, after }] }
//
// `after` is the state once that operation was applied, kept in memory so the
// current state is a lookup and an acknowledgement in the expected order costs
// nothing (see receive). It is never stored; toStored writes the operations.
//
// Replaying is sound because operations are intents applied with the time they
// were issued (context.now = op.at), not snapshots: the same operation on the
// same state gives the same result on any device and on the backend.

import { apply } from '../core/apply.js';

const applyOp = (state, op) => apply(state, op, { now: new Date(op.at) });

// Replay `ops` on `base`. An operation the core throws on (in practice, one
// this version of the app doesn't know) is dropped and reported.
function replay(base, version, ops) {
  const pending = [];
  const dropped = [];
  let state = base;
  for (const op of ops) {
    try {
      state = applyOp(state, op).state;
      pending.push({ op, after: state });
    } catch (error) {
      dropped.push({ op, error });
    }
  }
  return { replica: { base, version, pending }, dropped };
}

export function createReplica({ base, version = null, pending = [] }) {
  return replay(base, version, pending);
}

export function currentState(replica) {
  return replica.pending.length ? replica.pending[replica.pending.length - 1].after : replica.base;
}

export function pendingOps(replica) {
  return replica.pending.map(e => e.op);
}

// Apply an operation issued on this device. The core may throw (an unknown
// type, a missing time); the replica is then unchanged and the error is the
// caller's, as it would be without sync.
export function applyLocal(replica, op) {
  const { state, result } = applyOp(currentState(replica), op);
  return { replica: { ...replica, pending: [...replica.pending, { op, after: state }] }, result };
}

// Treat everything pending as acknowledged. Local-only mode does this after
// every operation: with no backend, the device's own order is final.
export function commitLocal(replica) {
  return replica.pending.length ? { ...replica, base: currentState(replica), pending: [] } : replica;
}

// Operations the backend applied, in its order, ending at `version`. They
// become the new base; pending operations the backend has now applied are
// removed by id and the rest replay on top.
//
// Returns { replica, dropped, gap, diverged }:
//   gap      — the batch doesn't follow this replica's version, so some were
//              missed. Nothing changes; fetch the operations since `version`.
//   diverged — the core threw on an operation the backend accepted, so this
//              device can't reproduce the backend's state. Nothing changes;
//              reload the full state (rebase).
export function receive(replica, { version, ops }) {
  const none = { replica, dropped: [], gap: false, diverged: false };
  if (replica.version !== null && version - ops.length !== replica.version) return { ...none, gap: true };

  // The common case: the backend applied exactly our oldest pending operations,
  // in order, on the state we based them on, so its result is the one cached.
  const k = ops.length;
  if (k <= replica.pending.length && ops.every((op, i) => op.id === replica.pending[i].op.id)) {
    const base = k ? replica.pending[k - 1].after : replica.base;
    return { ...none, replica: { base, version, pending: replica.pending.slice(k) } };
  }

  let base = replica.base;
  try {
    for (const op of ops) base = applyOp(base, op).state;
  } catch {
    return { ...none, diverged: true };
  }
  const applied = new Set(ops.map(op => op.id));
  const rest = pendingOps(replica).filter(op => !applied.has(op.id));
  return { ...none, ...replay(base, version, rest) };
}

// Replace the base with a full state from the backend (first connect, history
// pruned, or diverged) and replay what is still pending on top.
export function rebase(replica, { state, version }) {
  return replay(state, version, pendingOps(replica));
}

// Drop a pending operation the backend rejected, replaying the rest.
export function reject(replica, opId) {
  return replay(replica.base, replica.version, pendingOps(replica).filter(op => op.id !== opId));
}

// What persistence stores: the operations, not the cached states.
export function toStored(replica) {
  return { version: replica.version, pending: pendingOps(replica), base: replica.base };
}
