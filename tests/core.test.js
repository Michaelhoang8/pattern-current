import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  start,
  feed,
  finish,
  analyze,
  patterns,
  countsCSV,
  toDOT,
  fixture,
} from '../core.js';
function naive(text, keys) {
  const chars = Array.from(text);
  return keys.map((key) => {
    const p = Array.from(key);
    let count = 0;
    for (let i = 0; i <= chars.length - p.length; i++)
      if (p.every((ch, j) => ch === chars[i + j])) count++;
    return count;
  });
}
test('classic suffix patterns emit overlapping matches through failure links', () => {
  const r = analyze('ushers', ['he', 'she', 'his', 'hers'], 2);
  assert.deepEqual(r.counts, [1, 1, 0, 1]);
  assert.deepEqual(r.matches, [
    { pattern: 1, start: 1, end: 4 },
    { pattern: 0, start: 2, end: 4 },
    { pattern: 3, start: 2, end: 6 },
  ]);
});
test('chunk boundaries do not reset the automaton', () => {
  const text = 'ababababa',
    keys = ['a', 'aba', 'baba', 'abab'];
  const expected = analyze(text, keys, 4096);
  for (let size = 1; size <= 13; size++) {
    const r = analyze(text, keys, size);
    assert.deepEqual(r.counts, expected.counts);
    assert.deepEqual(r.matches, expected.matches);
    assert.equal(r.scanned, 9);
  }
});
test('incremental feed and repeated finish are non-destructive', () => {
  const scanner = start(compile(['abc', 'bc']));
  feed(scanner, 'a');
  assert.deepEqual(finish(scanner).counts, [0, 0]);
  feed(scanner, 'b');
  feed(scanner, '');
  feed(scanner, 'c');
  assert.deepEqual(finish(scanner).counts, [1, 1]);
  assert.deepEqual(finish(scanner), finish(scanner));
});
test('Unicode offsets count code points rather than UTF-16 units', () => {
  const r = analyze('a🛰🛰e\u0301é', ['🛰', '🛰🛰', 'é', 'e\u0301'], 1);
  assert.equal(r.scanned, 6);
  assert.deepEqual(r.counts, [2, 1, 1, 1]);
  assert.ok(r.matches.some((m) => m.pattern === 1 && m.start === 1 && m.end === 3));
  for (const m of r.matches)
    assert.equal(Array.from('a🛰🛰e\u0301é').slice(m.start, m.end).join(''), r.patterns[m.pattern]);
});
test('500 seeded scans match a brute-force multi-pattern oracle', () => {
  let seed = 113;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const alphabet = ['a', 'b', 'c', '🛰', 'é'];
  for (let trial = 0; trial < 500; trial++) {
    const text = Array.from({ length: rand(100) }, () => alphabet[rand(5)]).join(''),
      keys = [
        ...new Set(
          Array.from({ length: 1 + rand(12) }, () =>
            Array.from({ length: 1 + rand(7) }, () => alphabet[rand(5)]).join(''),
          ),
        ),
      ],
      r = analyze(text, keys, 1 + rand(16));
    assert.deepEqual(r.counts, naive(text, keys));
    assert.equal(r.total, r.matches.length);
    for (const m of r.matches)
      assert.equal(Array.from(text).slice(m.start, m.end).join(''), keys[m.pattern]);
  }
});
test('aggregate counts remain exact when the match preview is capped', () => {
  const keys = Array.from({ length: 10 }, (_, i) => 'a'.repeat(i + 1)),
    r = analyze('a'.repeat(10000), keys, 13);
  assert.equal(r.matches.length, 2000);
  assert.equal(r.previewTruncated, true);
  assert.deepEqual(
    r.counts,
    keys.map((p) => 10001 - p.length),
  );
  assert.equal(r.total, 99955);
  assert.equal(r.chunks.length, 128);
  assert.equal(r.totalChunks, 770);
});
test('duplicate patterns collapse while case and spaces remain significant', () => {
  assert.deepEqual(patterns('he\r\nhe\r\n He \nHE'), ['he', ' He ', 'HE']);
  assert.deepEqual(analyze('he HE He', ['he', 'HE', 'He']).counts, [1, 1, 1]);
});
test('failure links strictly decrease depth and transition targets retain prefixes', () => {
  const r = analyze(fixture().text, fixture().patterns, 8);
  for (const n of r.nodes) {
    if (n.id) assert.ok(r.nodes[n.fail].depth < n.depth);
    for (const e of n.edges) assert.equal(r.nodes[e.to].prefix, n.prefix + e.char);
  }
});
test('empty text returns exact zero counts without inventing chunks', () => {
  const r = analyze('', ['needle'], 1);
  assert.deepEqual(r.counts, [0]);
  assert.equal(r.totalChunks, 0);
  assert.equal(r.scanned, 0);
  assert.deepEqual(r.chunks, []);
});
test('invalid Unicode, limits, and invalid chunk sizes are rejected', () => {
  for (const keys of [
    [],
    [''],
    ['a'.repeat(257)],
    ['\ud800'],
    ['a\nb'],
    Array(101).fill('a'),
    Array.from({ length: 21 }, () => 'a'.repeat(250)),
  ])
    assert.throws(() => compile(keys));
  for (const size of [0, 4097, 1.5]) assert.throws(() => analyze('a', ['a'], size));
  assert.throws(() => analyze('\udfff', ['a']));
  assert.throws(() => analyze('a'.repeat(250001), ['a']));
  assert.throws(() => feed(start(compile(['a'])), '\ud800'));
});
test('exports escape DOT labels and neutralize spreadsheet formula patterns', () => {
  const r = analyze('=SUM "x"', ['=SUM', '"x"'], 2);
  assert.match(countsCSV(r), /"'=SUM",1/);
  const dot = toDOT(r);
  assert.ok(dot.includes('style=dashed'));
  assert.ok(dot.includes('\\"'));
  const input = fixture().patterns,
    before = JSON.stringify(input);
  analyze('she', input);
  assert.equal(JSON.stringify(input), before);
});
