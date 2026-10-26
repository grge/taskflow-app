// Replays a backend's operation log with this repo's core and prints the
// resulting state hash. Run as a child process with TZ set to the backend's
// home timezone, since the core computes day boundaries in local time.
//   echo '<ops json>' | TZ=Australia/Brisbane node tests/conformance/replay.mjs

import { apply } from '../../src/core/apply.js';
import { emptyState, stateHash } from '../../src/core/state.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let s = emptyState();
for (const op of JSON.parse(input)) s = apply(s, op, { now: new Date(op.at) }).state;
process.stdout.write(stateHash(s));
