// Everything the backend keeps, in one SQLite file: the current state and its
// version, the operation log, and hashed tokens. node:sqlite is synchronous,
// which suits a single-writer server: an operation is applied and committed
// before the next one is looked at.
//
// The current state is written with every operation, in the same transaction
// as its log entry, so a restart resumes exactly where it stopped and there is
// nothing to replay. The log is kept for devices catching up (/v1/ops) and,
// later, for undo and history; it is pruned to the newest HISTORY_LIMIT entries.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { emptyState, reviveState, serializeState } from '../src/core/state.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS current (
    one     INTEGER PRIMARY KEY CHECK (one = 1),
    version INTEGER NOT NULL,
    state   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ops (
    version     INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    op          TEXT NOT NULL,
    result      TEXT,
    received_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    name         TEXT PRIMARY KEY,
    hash         TEXT NOT NULL UNIQUE,
    scope        TEXT NOT NULL CHECK (scope IN ('read', 'write')),
    created_at   TEXT NOT NULL,
    last_used_at TEXT
  );
`;

// Tokens are 32 random bytes, so a plain SHA-256 is enough to store them: there
// is nothing to brute-force, unlike a password.
const hashToken = token => createHash('sha256').update(token).digest('hex');

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const q = {
    current:     db.prepare('SELECT version, state FROM current WHERE one = 1'),
    putCurrent:  db.prepare('INSERT INTO current (one, version, state) VALUES (1, ?, ?) ON CONFLICT (one) DO UPDATE SET version = excluded.version, state = excluded.state'),
    putOp:       db.prepare('INSERT INTO ops (version, id, op, result, received_at) VALUES (?, ?, ?, ?, ?)'),
    findOp:      db.prepare('SELECT version, result FROM ops WHERE id = ?'),
    opsSince:    db.prepare('SELECT op FROM ops WHERE version > ? ORDER BY version'),
    prune:       db.prepare('DELETE FROM ops WHERE version <= ?'),
    getMeta:     db.prepare('SELECT value FROM meta WHERE key = ?'),
    putMeta:     db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    addToken:    db.prepare('INSERT INTO tokens (name, hash, scope, created_at) VALUES (?, ?, ?, ?)'),
    tokenByHash: db.prepare('SELECT name, scope FROM tokens WHERE hash = ?'),
    touchToken:  db.prepare('UPDATE tokens SET last_used_at = ? WHERE name = ?'),
    listTokens:  db.prepare('SELECT name, scope, created_at, last_used_at FROM tokens ORDER BY created_at'),
    dropToken:   db.prepare('DELETE FROM tokens WHERE name = ?')
  };

  const meta = key => q.getMeta.get(key)?.value ?? null;

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // last_used_at is informational; writing it on every request would turn each
  // read into a write, so it is refreshed at most once a minute per token.
  const touched = new Map();

  return {
    load() {
      const row = q.current.get();
      return row ? { version: row.version, state: reviveState(JSON.parse(row.state)) } : { version: 0, state: emptyState() };
    },

    // Record one applied operation and the state after it.
    append(version, op, result, state, receivedAt) {
      transaction(() => {
        q.putOp.run(version, op.id, JSON.stringify(op), result === undefined ? null : JSON.stringify(result), receivedAt);
        q.putCurrent.run(version, serializeState(state));
      });
    },

    // The version and result an operation id was applied with, if it was.
    findOp(id) {
      const row = q.findOp.get(id);
      return row ? { version: row.version, result: row.result === null ? undefined : JSON.parse(row.result) } : null;
    },

    // Operations after `since`, or null when the log no longer reaches back
    // that far.
    opsSince(since) {
      if (since < this.prunedThrough()) return null;
      return q.opsSince.all(since).map(r => JSON.parse(r.op));
    },

    prunedThrough() {
      return Number(meta('pruned_through') ?? 0);
    },

    prune(currentVersion, keep) {
      const through = currentVersion - keep;
      if (through <= this.prunedThrough()) return;
      transaction(() => {
        q.prune.run(through);
        q.putMeta.run('pruned_through', String(through));
      });
    },

    // ─── tokens ──────────────────────────────────────────────────────────────

    createToken(name, scope) {
      const token = `tf_${randomBytes(32).toString('base64url')}`;
      q.addToken.run(name, hashToken(token), scope, new Date().toISOString());
      return token;
    },

    authenticate(token) {
      if (typeof token !== 'string' || !token) return null;
      const row = q.tokenByHash.get(hashToken(token));
      if (!row) return null;
      const now = Date.now();
      if ((touched.get(row.name) ?? 0) < now - 60_000) {
        touched.set(row.name, now);
        q.touchToken.run(new Date(now).toISOString(), row.name);
      }
      return { name: row.name, scope: row.scope };
    },

    listTokens() {
      return q.listTokens.all();
    },

    revokeToken(name) {
      touched.delete(name);
      return q.dropToken.run(name).changes > 0;
    },

    close() {
      db.close();
    }
  };
}
