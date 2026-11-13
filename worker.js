import { analyze } from './core.js';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: analyze(data.text, data.patterns, data.chunkSize) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
