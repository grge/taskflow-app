// The domain core's version: a hash of the source of src/core/apply.js and
// everything it imports. App and backend each compute it from their own copy
// of the code, so it differs exactly when they would apply an operation
// differently. The app gets it at build time (vite.config.js); the backend at
// startup. Line endings are normalised so a Windows checkout agrees.
//
//   node scripts/core-version.mjs [--files]

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Relative path → source, for the entry and its transitive relative imports.
function coreSources() {
  const sources = new Map();
  const visit = file => {
    const rel = relative(ROOT, file);
    if (sources.has(rel)) return;
    const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    sources.set(rel, source);
    for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      visit(resolve(dirname(file), spec));
    }
  };
  visit(join(ROOT, 'src/core/apply.js'));
  return new Map([...sources].sort(([a], [b]) => a.localeCompare(b)));
}

export function coreVersion() {
  const hash = createHash('sha256');
  for (const [file, source] of coreSources()) hash.update(`${file}\n${source}\n`);
  return hash.digest('hex').slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(coreVersion());
  if (process.argv.includes('--files')) console.log([...coreSources().keys()].join('\n'));
}
