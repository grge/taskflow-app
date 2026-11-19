// Task search matching and highlighting (src/lib/search.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matches, highlight } from '../../src/lib/search.js';

const hits = (text, query) => highlight(text, parseQuery(query)).filter(r => r.hit).map(r => r.text);

test('a query is its words, folded, without repeats', () => {
  assert.deepEqual(parseQuery('  Write  REPORT write '), ['write', 'report']);
  assert.deepEqual(parseQuery(''), []);
  assert.deepEqual(parseQuery('   '), []);
  assert.deepEqual(parseQuery(undefined), []);
});

test('every word must appear, in any order, as part of a word or whole', () => {
  assert.equal(matches('Write quarterly report', parseQuery('report write')), true);
  assert.equal(matches('Write quarterly report', parseQuery('quart')), true);
  assert.equal(matches('Write quarterly report', parseQuery('report email')), false);
  assert.equal(matches('Anything', parseQuery('')), true, 'no words matches everything');
});

test('case and accents are ignored, both ways', () => {
  assert.equal(matches('Café meeting', parseQuery('cafe')), true);
  assert.equal(matches('Cafe meeting', parseQuery('CAFÉ')), true);
  assert.equal(matches('Résumé for Zoë', parseQuery('resume zoe')), true);
});

test('highlighting marks every occurrence of every word in the original text', () => {
  assert.deepEqual(hits('Write report, then report back', 'report'), ['report', 'report']);
  assert.deepEqual(hits('Write quarterly report', 'write rep'), ['Write', 'rep']);
  assert.deepEqual(hits('Café meeting', 'cafe'), ['Café'], 'the accented original is marked');
  assert.deepEqual(highlight('Plain', []), [{ text: 'Plain', hit: false }]);
});

test('overlapping words merge into one highlighted run', () => {
  assert.deepEqual(highlight('banana', parseQuery('ana nan')), [{ text: 'b', hit: false }, { text: 'anana', hit: true }]);
});

test('runs always rebuild the original text exactly', () => {
  for (const [text, q] of [['Ünïcödé "quotes" 🎉 party', 'party code'], ['ﬁle the ﬁnal form', 'fi'], ['emoji 🎉🎉 twice', '🎉']]) {
    assert.equal(highlight(text, parseQuery(q)).map(r => r.text).join(''), text, text);
  }
  assert.deepEqual(hits('emoji 🎉🎉 twice', '🎉'), ['🎉🎉']);
});
