const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export function patterns(text) {
  if (typeof text !== 'string' || text.length > 20000)
    throw Error('Pattern text is limited to 20,000 UTF-16 code units.');
  return validatePatterns(
    text
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n')
      .filter((s) => s.length),
  );
}
export function validatePatterns(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw Error('Use 1–100 nonempty patterns.');
  let total = 0;
  for (const p of input) {
    if (
      typeof p !== 'string' ||
      !p.length ||
      lone.test(p) ||
      /[\r\n]/.test(p) ||
      Array.from(p).length > 256
    )
      throw Error('Patterns need 1–256 Unicode code points without unpaired surrogates.');
    total += Array.from(p).length;
  }
  if (total > 5000) throw Error('Patterns are limited to 5,000 code points in total.');
  return [...new Set(input)];
}
export function compile(input) {
  const keys = validatePatterns(input),
    nodes = [{ next: new Map(), fail: 0, terminal: [], output: [], depth: 0, prefix: '' }],
    terminal = [];
  keys.forEach((key, index) => {
    let state = 0;
    for (const ch of key) {
      if (!nodes[state].next.has(ch)) {
        nodes[state].next.set(ch, nodes.length);
        nodes.push({
          next: new Map(),
          fail: 0,
          terminal: [],
          output: [],
          depth: nodes[state].depth + 1,
          prefix: nodes[state].prefix + ch,
        });
      }
      state = nodes[state].next.get(ch);
    }
    nodes[state].terminal.push(index);
    terminal.push(state);
  });
  const order = [0],
    queue = [];
  for (const state of nodes[0].next.values()) queue.push(state);
  for (let at = 0; at < queue.length; at++) {
    const state = queue[at],
      node = nodes[state];
    order.push(state);
    node.output = [...node.terminal, ...nodes[node.fail].output];
    for (const [ch, next] of node.next) {
      let failure = node.fail;
      while (failure && !nodes[failure].next.has(ch)) failure = nodes[failure].fail;
      nodes[next].fail = nodes[failure].next.get(ch) ?? 0;
      queue.push(next);
    }
  }
  return { patterns: keys, nodes, terminal, order };
}
export function start(machine) {
  return {
    machine,
    state: 0,
    offset: 0,
    visits: Array(machine.nodes.length).fill(0),
    matches: [],
    chunks: [],
    sampleLimit: 2000,
  };
}
export function feed(scanner, text) {
  if (typeof text !== 'string' || lone.test(text))
    throw Error('Chunks must contain complete Unicode code points.');
  const chars = Array.from(text),
    begin = scanner.offset;
  for (const ch of chars) {
    while (scanner.state && !scanner.machine.nodes[scanner.state].next.has(ch))
      scanner.state = scanner.machine.nodes[scanner.state].fail;
    scanner.state = scanner.machine.nodes[scanner.state].next.get(ch) ?? 0;
    scanner.visits[scanner.state]++;
    scanner.offset++;
    if (scanner.matches.length < scanner.sampleLimit)
      for (const pattern of scanner.machine.nodes[scanner.state].output) {
        if (scanner.matches.length >= scanner.sampleLimit) break;
        scanner.matches.push({
          pattern,
          start: scanner.offset - Array.from(scanner.machine.patterns[pattern]).length,
          end: scanner.offset,
        });
      }
  }
  if (scanner.chunks.length < 128)
    scanner.chunks.push({
      start: begin,
      end: scanner.offset,
      state: scanner.state,
      prefix: scanner.machine.nodes[scanner.state].prefix,
    });
  return scanner;
}
export function finish(scanner) {
  const counts = [...scanner.visits];
  for (const state of [...scanner.machine.order].reverse())
    if (state) counts[scanner.machine.nodes[state].fail] += counts[state];
  return {
    counts: scanner.machine.terminal.map((state) => counts[state]),
    matches: scanner.matches.map((m) => ({ ...m })),
    scanned: scanner.offset,
    chunks: scanner.chunks.map((c) => ({ ...c })),
  };
}
export function analyze(text, input, chunkSize = 64) {
  if (typeof text !== 'string' || text.length > 500000 || lone.test(text))
    throw Error('Text is limited to 500,000 UTF-16 code units without unpaired surrogates.');
  const chars = Array.from(text);
  if (chars.length > 250000) throw Error('Text is limited to 250,000 Unicode code points.');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 4096)
    throw Error('Chunk size must be 1–4,096 code points.');
  const machine = compile(input),
    scanner = start(machine);
  for (let i = 0; i < chars.length; i += chunkSize)
    feed(scanner, chars.slice(i, i + chunkSize).join(''));
  const result = finish(scanner),
    total = result.counts.reduce((a, b) => a + b, 0);
  return {
    ...result,
    patterns: machine.patterns,
    total,
    previewTruncated: total > result.matches.length,
    chunkSize,
    totalChunks: Math.ceil(chars.length / chunkSize),
    stateCount: machine.nodes.length,
    nodes: machine.nodes.map((n, id) => ({
      id,
      prefix: n.prefix,
      depth: n.depth,
      fail: n.fail,
      terminal: n.terminal,
      output: n.output,
      edges: [...n.next].map(([char, to]) => ({ char, to })),
    })),
  };
}
export function countsCSV(result) {
  const q = (s) => '"' + String(s).replaceAll('"', '""') + '"';
  return (
    'pattern,count\r\n' +
    result.patterns
      .map((p, i) => `${q(/^[=+@-]/.test(p) ? "'" + p : p)},${result.counts[i]}`)
      .join('\r\n') +
    '\r\n'
  );
}
export function toDOT(result) {
  const quote = (s) => JSON.stringify(s);
  return [
    'digraph Automaton {',
    '  rankdir=LR;',
    ...result.nodes.map(
      (n) =>
        `  n${n.id} [label=${quote(`${n.id}: ${n.prefix || 'root'}`)},shape=${n.terminal.length ? 'doublecircle' : 'circle'}];`,
    ),
    ...result.nodes.flatMap((n) => [
      ...n.edges.map((e) => `  n${n.id} -> n${e.to} [label=${quote(e.char)}];`),
      ...(n.id ? [`  n${n.id} -> n${n.fail} [style=dashed,color=gray,label="fail"];`] : []),
    ]),
    '}',
  ].join('\n');
}
export function fixture() {
  return {
    patterns: ['he', 'she', 'his', 'hers', '🛰', 'data', 'data stream'],
    text: 'She reads data; he reads the data stream.\nCase-sensitive patterns keep She separate from she.\nushers and his notes cross chunk boundaries. 🛰🛰\nA data stream carries hers and she carries data.',
    chunkSize: 8,
  };
}
