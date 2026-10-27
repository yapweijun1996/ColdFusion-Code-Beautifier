'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const origin = 'https://example.test';
const home = origin + '/';
const index = origin + '/index.html';
const entries = new Map();
const handlers = {};
let network;
let failWrite = false;

function response(status, body) {
  return { status, body, type: 'basic', clone() { return response(status, body); } };
}
function key(request) {
  return new URL(typeof request === 'string' ? request : request.url, home).href;
}
const cache = {
  put(request, value) {
    if (failWrite) return Promise.reject(new Error('storage unavailable'));
    entries.set(key(request), value);
    return Promise.resolve();
  }
};
const caches = {
  open() { return Promise.resolve(cache); },
  match(request) { return Promise.resolve(entries.get(key(request))); }
};
const self = {
  location: { origin },
  addEventListener(type, handler) { handlers[type] = handler; }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
  self, caches, URL,
  Response: { error() { return { status: 0, type: 'error' }; } },
  fetch() { return network(); }
});

async function navigate(url) {
  let delivered;
  const lifetime = [];
  handlers.fetch({
    request: { url, method: 'GET', mode: 'navigate', headers: { get() { return 'text/html'; } } },
    respondWith(promise) { delivered = promise; },
    waitUntil(promise) { lifetime.push(promise); }
  });
  const result = await delivered;
  await Promise.all(lifetime);
  return result;
}

(async function () {
  entries.set(home, response(200, 'working home'));
  entries.set(index, response(200, 'working index'));
  network = () => Promise.resolve(response(503, 'temporary error'));
  assert.strictEqual((await navigate(home)).status, 503, 'online HTTP error is returned');
  assert.strictEqual(entries.get(home).body, 'working home', 'HTTP error cannot replace good cache');
  network = () => Promise.reject(new Error('offline'));
  assert.strictEqual((await navigate(home)).body, 'working home', 'offline reload uses last good page');

  entries.set(home, response(503, 'previously poisoned entry'));
  assert.strictEqual((await navigate(home)).body, 'working index', 'old poisoned entries fall back to index');
  entries.set(index, response(503, 'poisoned fallback'));
  assert.strictEqual((await navigate(home)).type, 'error', 'offline fails instead of serving a cached error');

  entries.set(index, response(200, 'working index'));
  network = () => Promise.resolve(response(200, 'updated home'));
  assert.strictEqual((await navigate(home)).body, 'updated home', 'online success is returned');
  network = () => Promise.reject(new Error('offline'));
  assert.strictEqual((await navigate(home)).body, 'updated home', 'successful response refreshes offline cache');

  network = () => Promise.resolve(response(404, 'not found'));
  assert.strictEqual((await navigate(home)).status, 404, 'online 404 remains visible');
  assert.strictEqual(entries.get(home).body, 'updated home', '404 does not replace working cache');
  failWrite = true;
  network = () => Promise.resolve(response(200, 'online despite storage failure'));
  assert.strictEqual((await navigate(home)).body, 'online despite storage failure', 'cache write failure does not break online navigation');
  console.log('PASS: service-worker navigation preserves usable offline cache');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
