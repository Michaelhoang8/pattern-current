import { patterns, fixture, countsCSV, toDOT } from './core.js';
const $ = (id) => document.getElementById(id);
let result = null,
  activeText = '',
  rawText = null,
  chars = [],
  worker = null,
  busy = false,
  revision = 0;
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
function status(text) {
  $('status').textContent = text;
}
function controls() {
  for (const n of document.querySelectorAll('button,input,select,textarea')) n.disabled = busy;
  $('cancel').disabled = !busy;
  $('save').disabled = busy || !result;
  if (result) {
    $('match').disabled = busy || !result.matches.length;
    $('trace').disabled = busy || !result.chunks.length;
  }
}
function invalidate() {
  revision++;
  worker?.terminate();
  worker = null;
  busy = false;
  result = null;
  $('results').hidden = true;
  controls();
  status('Inputs changed. Scan again to refresh the analysis.');
}
function scan(candidate = null) {
  let value;
  try {
    value = candidate || {
      text: rawText ?? $('text').value,
      patterns: patterns($('patterns').value),
      chunkSize: Number($('chunk').value),
    };
  } catch (e) {
    status(e.message);
    return;
  }
  invalidate();
  const ticket = revision,
    w = new Worker('worker.js', { type: 'module' });
  worker = w;
  busy = true;
  controls();
  status('Scanning the stream and aggregating failure-link counts…');
  w.onmessage = ({ data }) => {
    if (ticket !== revision) return;
    w.terminate();
    worker = null;
    busy = false;
    if (data.error) {
      status(data.error);
      controls();
      return;
    }
    result = data.result;
    activeText = value.text;
    rawText = value.text;
    chars = Array.from(activeText);
    $('text').value = activeText;
    $('patterns').value = result.patterns.join('\n');
    $('chunk').value = result.chunkSize;
    render();
    status(
      `Scanned ${result.scanned.toLocaleString()} code points. ${result.total.toLocaleString()} total matches across ${result.patterns.length} distinct patterns.`,
    );
  };
  w.onerror = () => {
    if (ticket === revision) {
      w.terminate();
      worker = null;
      busy = false;
      controls();
      status('The search worker failed. Scan again to retry.');
    }
  };
  w.postMessage(value);
}
function context() {
  const m = result?.matches[Number($('match').value)];
  $('context').replaceChildren();
  if (!m) {
    $('match-offset').textContent = 'No matches in this text.';
    return;
  }
  const begin = Math.max(0, m.start - 35),
    end = Math.min(chars.length, m.end + 35);
  $('match-offset').textContent =
    `Pattern ${m.pattern + 1} · code-point interval [${m.start}, ${m.end}) · length ${m.end - m.start}`;
  $('context').append(
    document.createTextNode((begin ? '…' : '') + chars.slice(begin, m.start).join('')),
    el('mark', chars.slice(m.start, m.end).join('')),
    document.createTextNode(chars.slice(m.end, end).join('') + (end < chars.length ? '…' : '')),
  );
}
function trace() {
  const c = result?.chunks[Number($('trace').value)];
  if (!c) {
    $('trace-note').textContent = 'The empty text has no chunks.';
    $('trace-text').textContent = '';
    return;
  }
  $('trace-note').textContent =
    `Chunk [${c.start}, ${c.end}) ends in state ${c.state}, prefix ${JSON.stringify(c.prefix)}. That state becomes the next chunk's starting state.`;
  $('trace-text').textContent = chars.slice(c.start, c.end).join('');
}
function render() {
  $('results').hidden = false;
  $('total').textContent = result.total.toLocaleString();
  $('scanned').textContent = result.scanned.toLocaleString();
  $('states').textContent = result.stateCount;
  $('chunk-count').textContent =
    `${result.totalChunks.toLocaleString()} chunks of up to ${result.chunkSize} code points`;
  $('counts').replaceChildren();
  result.patterns.forEach((p, i) => {
    const row = el('tr');
    row.append(el('td', p), el('td', result.counts[i].toLocaleString()));
    $('counts').append(row);
  });
  $('match').replaceChildren();
  result.matches.forEach((m, i) => {
    const o = el(
      'option',
      `${i + 1}. ${JSON.stringify(result.patterns[m.pattern]).slice(0, 65)} @ ${m.start}–${m.end}`,
    );
    o.value = i;
    $('match').append(o);
  });
  $('preview-note').textContent =
    `${result.matches.length.toLocaleString()} of ${result.total.toLocaleString()} matches retained in the preview. ${result.previewTruncated ? 'Preview capped; every pattern count above still covers the complete text.' : 'All matches fit in this preview.'}`;
  context();
  $('trace').replaceChildren();
  result.chunks.forEach((c, i) => {
    const o = el('option', `Chunk ${i + 1} · [${c.start}, ${c.end}) → state ${c.state}`);
    o.value = i;
    $('trace').append(o);
  });
  $('trace-limit').textContent =
    `Showing ${result.chunks.length} of ${result.totalChunks.toLocaleString()} chunk boundaries. Chunking does not change the match counts or offsets.`;
  trace();
  $('nodes').replaceChildren();
  for (const n of result.nodes.slice(0, 80)) {
    const row = el('tr');
    for (const text of [
      n.id,
      n.prefix || '(root)',
      n.fail,
      n.output.map((i) => `#${i + 1}`).join(', ') || '—',
    ])
      row.append(el('td', text));
    $('nodes').append(row);
  }
  controls();
}
$('text').addEventListener('input', () => {
  rawText = null;
  invalidate();
  $('source-note').textContent = 'Edited text uses the textarea’s normalized line endings.';
});
for (const id of ['patterns', 'chunk']) $(id).addEventListener('input', invalidate);
$('scan').addEventListener('click', () => scan());
$('cancel').addEventListener('click', () => {
  revision++;
  worker?.terminate();
  worker = null;
  busy = false;
  controls();
  status('Operation cancelled.');
});
$('sample').addEventListener('click', () => {
  scan(fixture());
  $('source-note').textContent = 'Synthetic example / literal, case-sensitive matching.';
});
$('match').addEventListener('change', context);
$('trace').addEventListener('change', trace);
function download(name, data, type = 'application/json') {
  const u = URL.createObjectURL(new Blob([data], { type })),
    a = el('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
$('save').addEventListener('click', () => {
  if (result)
    download(
      'pattern-session.json',
      JSON.stringify(
        { text: activeText, patterns: result.patterns, chunkSize: result.chunkSize },
        null,
        2,
      ),
    );
});
$('report').addEventListener('click', () => {
  if (result) download('pattern-analysis.json', JSON.stringify(result, null, 2));
});
$('csv').addEventListener('click', () => {
  if (result) download('pattern-counts.csv', countsCSV(result), 'text/csv;charset=utf-8');
});
$('dot').addEventListener('click', () => {
  if (result) download('pattern-automaton.dot', toDOT(result), 'text/vnd.graphviz;charset=utf-8');
});
$('text-file').addEventListener('change', async () => {
  const f = $('text-file').files[0];
  if (!f) return;
  const ticket = ++revision;
  busy = true;
  controls();
  try {
    if (f.size > 1000000) throw Error('Text files are limited to 1 MB.');
    const bytes = await f.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw Error('The file is not valid UTF-8.');
    }
    if (ticket !== revision) return;
    const candidate = {
      text,
      patterns: patterns($('patterns').value),
      chunkSize: Number($('chunk').value),
    };
    busy = false;
    scan(candidate);
    $('source-note').textContent =
      `${f.name} · exact decoded line endings retained until you edit the text.`;
  } catch (e) {
    if (ticket === revision) {
      busy = false;
      controls();
      status(`File rejected: ${e.message}`);
    }
  } finally {
    $('text-file').value = '';
  }
});
$('session-file').addEventListener('change', async () => {
  const f = $('session-file').files[0];
  if (!f) return;
  const ticket = ++revision;
  busy = true;
  controls();
  try {
    if (f.size > 2000000) throw Error('Sessions are limited to 2 MB.');
    const value = JSON.parse(await f.text());
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'chunkSize,patterns,text'
    )
      throw Error('Session needs text, patterns, and chunkSize only.');
    if (ticket !== revision) return;
    busy = false;
    scan(value);
    $('source-note').textContent = 'Imported session / exact text retained until edited.';
  } catch (e) {
    if (ticket === revision) {
      busy = false;
      controls();
      status(`Session rejected: ${e.message}`);
    }
  } finally {
    $('session-file').value = '';
  }
});
for (const button of document.querySelectorAll('[data-view]'))
  button.addEventListener('click', () => {
    for (const name of ['matches', 'chunks', 'automaton']) {
      $(name + '-view').hidden = name !== button.dataset.view;
      document
        .querySelector(`[data-view="${name}"]`)
        .setAttribute('aria-pressed', String(name === button.dataset.view));
    }
  });
scan(fixture());
