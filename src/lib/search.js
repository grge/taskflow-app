// Task search: what the task panel's search field matches, and which parts of a
// description to highlight. Pure, so it is unit-tested on its own.
//
// A query is words; a task matches when every word appears somewhere in its
// description, in any order. Matching ignores case and accents ("cafe" finds
// "Café"), and is a plain substring match, so a partly typed word already finds
// what it starts.

// One character → its folded form: accents stripped, lower-cased. May be
// empty (a lone combining mark) or longer than one character.
const fold = ch => ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// The folded text, plus for each of its characters the index of the original
// character it came from, so a hit in the folded text maps back for highlighting.
function folded(text) {
  let out = '';
  const from = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) from.push(i);
    out += f;
    i += ch.length;
  }
  return { out, from };
}

// The query's words, folded. An empty or blank query has none.
export function parseQuery(query) {
  return [...new Set(
    (query ?? '').split(/\s+/).map(w => [...w].map(fold).join('')).filter(Boolean)
  )];
}

export function matches(text, terms) {
  if (!terms.length) return true;
  const { out } = folded(text ?? '');
  return terms.every(t => out.includes(t));
}

// `text` cut into [{ text, hit }] runs, with every occurrence of every term
// marked. Overlapping hits merge into one run.
export function highlight(text, terms) {
  if (!text || !terms.length) return [{ text: text ?? '', hit: false }];
  const { out, from } = folded(text);
  const hit = new Uint8Array(text.length);
  for (const t of terms) {
    for (let at = out.indexOf(t); at !== -1; at = out.indexOf(t, at + 1)) {
      const start = from[at];
      const lastFolded = at + t.length - 1;
      // Cover the whole original character the last folded one came from
      // (a surrogate pair, or a letter whose accent was stripped).
      const endChar = from[lastFolded];
      const end = endChar + String.fromCodePoint(text.codePointAt(endChar)).length;
      hit.fill(1, start, end);
    }
  }
  const runs = [];
  for (let i = 0; i < text.length; i++) {
    const h = hit[i] === 1;
    const last = runs[runs.length - 1];
    if (last && last.hit === h) last.text += text[i];
    else runs.push({ text: text[i], hit: h });
  }
  return runs;
}
