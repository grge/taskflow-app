// Run the conformance suite against a backend:
//
//   node tests/conformance/run.mjs --url https://… --token <write token> [--read-token …] [--origin …]
//
// Use a fresh, empty backend: the suite adds test data.

import { runConformance } from './suite.mjs';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const url = opt('url'), token = opt('token');
if (!url || !token) {
  console.error('Usage: node tests/conformance/run.mjs --url <backend> --token <write token> [--read-token <read token>] [--origin <allowed origin>]');
  process.exit(2);
}

const results = await runConformance({ url, token, readToken: opt('read-token'), origin: opt('origin') });
for (const r of results) {
  console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.note ? `  (${r.note})` : ''}`);
  if (!r.ok) console.log(`        ${r.error.message}`);
}
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
