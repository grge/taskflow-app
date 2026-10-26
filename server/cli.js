#!/usr/bin/env node
// taskflow-server: the reference backend and its admin commands.
//
//   taskflow-server [serve]                        run the backend
//   taskflow-server token create --name N [--scope write|read] [--link] [--url URL]
//   taskflow-server token list
//   taskflow-server token revoke N
//   taskflow-server export                         current data as an export file, on stdout
//
// Configuration is environment variables; see server/README.md.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// node:sqlite is still flagged experimental and says so on every start. It is
// stable enough for this; keep the logs for things that matter.
process.removeAllListeners('warning');
process.on('warning', w => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return;
  console.warn(w);
});

const env = process.env;
const DATA_DIR = resolve(env.DATA_DIR ?? './data');
const DEFAULT_APP_URL = 'https://grge.github.io/taskflow-app/';
const DEFAULT_ORIGINS = 'https://grge.github.io';

async function openStoreHere() {
  mkdirSync(DATA_DIR, { recursive: true });
  const { openStore } = await import('./store.js');
  return openStore(join(DATA_DIR, 'taskflow.db'));
}

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function die(message) {
  console.error(message);
  process.exit(1);
}

// ─── serve ───────────────────────────────────────────────────────────────────

async function serve() {
  const { createApp } = await import('./app.js');
  const { coreVersion } = await import('../scripts/core-version.mjs');
  const store = await openStoreHere();

  const homeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const config = {
    allowedOrigins: (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
    coreVersion: coreVersion(),
    homeTimeZone,
    historyLimit: Number(env.HISTORY_LIMIT ?? 10_000),
    rateLimit: { perMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60), burst: Number(env.RATE_LIMIT_BURST ?? 300) },
    log: msg => console.log(`${new Date().toISOString()} ${msg}`)
  };
  const app = createApp({ store, config });

  const port = Number(env.PORT ?? 8080);
  const host = env.HOST ?? '0.0.0.0';
  app.server.listen(port, host, () => {
    config.log(`taskflow-server listening on ${host}:${port}`);
    config.log(`data: ${DATA_DIR}  version: ${app.version}  core: ${config.coreVersion}`);
    config.log(`home timezone: ${homeTimeZone}${env.TZ ? '' : ' (TZ is not set; set it to your timezone)'}`);
    config.log(`allowed origins: ${config.allowedOrigins.join(', ') || '(none)'}`);
    if (store.listTokens().length === 0) config.log('no tokens yet: run `taskflow-server token create --name <device>`');
  });

  const stop = async signal => {
    config.log(`${signal}: shutting down`);
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

// ─── tokens ──────────────────────────────────────────────────────────────────

function connectLink(backendUrl, token) {
  const payload = Buffer.from(JSON.stringify({ url: backendUrl, token })).toString('base64url');
  return `${(env.APP_URL ?? DEFAULT_APP_URL).replace(/#.*$/, '')}#connect=${payload}`;
}

function publicUrl(f) {
  if (typeof f.url === 'string') return f.url.replace(/\/+$/, '');
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, '');
  if (env.FLY_APP_NAME) return `https://${env.FLY_APP_NAME}.fly.dev`;
  return null;
}

async function token(args) {
  const f = flags(args);
  const [sub, maybeName] = f._;
  const store = await openStoreHere();
  try {
    if (sub === 'create') {
      const name = typeof f.name === 'string' ? f.name : die('token create needs --name <name>, e.g. --name laptop');
      if (!/^[\w.-]{1,40}$/.test(name)) die('A token name is 1–40 letters, digits, dots, dashes or underscores.');
      const scope = f.scope === undefined ? 'write' : f.scope;
      if (scope !== 'write' && scope !== 'read') die('--scope is write or read');
      if (store.listTokens().some(t => t.name === name)) die(`A token named "${name}" exists. Revoke it first, or pick another name.`);
      const tok = store.createToken(name, scope);
      console.log(`Created ${scope} token "${name}". It is shown once; store it now.\n\n  ${tok}\n`);
      if (f.link) {
        const url = publicUrl(f) ?? die('--link needs the backend\'s public URL: pass --url https://… or set PUBLIC_URL.');
        console.log(`Connect link (open it on the device; the token stays in the # part, which is never sent to a server):\n\n  ${connectLink(url, tok)}\n`);
      }
    } else if (sub === 'list') {
      const rows = store.listTokens();
      if (!rows.length) return console.log('No tokens.');
      for (const t of rows) console.log(`${t.name.padEnd(20)} ${t.scope.padEnd(6)} created ${t.created_at}  last used ${t.last_used_at ?? 'never'}`);
    } else if (sub === 'revoke') {
      const name = maybeName ?? f.name;
      if (typeof name !== 'string') die('token revoke needs a name');
      console.log(store.revokeToken(name) ? `Revoked "${name}". Its connections close within half a minute.` : `No token named "${name}".`);
    } else {
      die('Usage: taskflow-server token create --name N [--scope write|read] [--link] [--url URL] | token list | token revoke N');
    }
  } finally {
    store.close();
  }
}

async function exportData() {
  const { serializeState } = await import('../src/core/state.js');
  const store = await openStoreHere();
  const { state } = store.load();
  store.close();
  process.stdout.write(serializeState(state, 2) + '\n');
}

// ─── main ────────────────────────────────────────────────────────────────────

const [command = 'serve', ...rest] = process.argv.slice(2);
const commands = { serve, token: () => token(rest), export: exportData };
if (!commands[command]) {
  die(`Unknown command "${command}". Commands: serve, token create|list|revoke, export.`);
}
await commands[command]();
