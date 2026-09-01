/* UI contract tests.
 *
 * These tests intentionally use a tiny DOM double instead of jsdom. The app
 * has no build step and the editor-ui module only needs the small DOM surface
 * represented here. This keeps the suite offline and validates keyboard and
 * async-state behavior without changing the formatter VM harness.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const beautifier = fs.readFileSync(path.join(root, 'js', 'beautifier.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const pwa = fs.readFileSync(path.join(root, 'js', 'pwa.js'), 'utf8');
const toast = fs.readFileSync(path.join(root, 'js', 'toast.js'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function pass(name) {
  console.log('PASS UI: ' + name);
}

function expectMatch(name, value, pattern) {
  assert.match(value, pattern, name);
  pass(name);
}

function expectNoMatch(name, value, pattern) {
  assert.doesNotMatch(value, pattern, name);
  pass(name);
}

// ── Static HTML / loading contracts ─────────────────────────────────────────
expectMatch('main landmark exists', html, /<main\b[^>]*class="container"/);
expectMatch('named toolbar nav exists', html, /<nav\b[^>]*class="toolbar"[^>]*aria-label="[^"]+"/);
expectMatch('toast is a polite status region', html, /class="simpleToastContainer"[^>]*role="status"[^>]*aria-live="polite"/);
expectMatch('input label remains associated', html, /<label[^>]*for="input"[^>]*>Input<\/label>/);
expectMatch('output label remains associated', html, /<label[^>]*for="output"[^>]*>Output<\/label>/);
expectMatch('dialect has a visible label', html, /class="pro-sql-dialect"[\s\S]*?<span>Dialect<\/span>[\s\S]*?id="pro_sql_dialect"/);
expectMatch('input has keyboard help description', html, /id="input"[^>]*aria-describedby="input-keyboard-help"/);
expectMatch('footer contains the deployed version marker', html, /id="app-version"[^>]*data-build-version="__BUILD_VERSION__"/);
expectMatch('app renders the deployed version', app, /data-build-version|app-version/);
expectMatch('auto-clear input defaults off', html, /id="auto_clear"[^>]*>/);
expectNoMatch('auto-clear input is not checked by default', html, /id="auto_clear"[^>]*checked/);
expectNoMatch('auto-clear output is not checked by default', html, /id="auto_clear_output"[^>]*checked/);
expectNoMatch('inline click handlers are removed', html, /\bonclick\s*=/i);
expectMatch('mobile layout breakpoint is 640px', css, /@media\s*\(max-width:\s*640px\)/);
expectNoMatch('legacy 768px mobile breakpoint is removed', css, /@media\s*\(max-width:\s*768px\)/);
expectMatch('dark surface has increased contrast', css, /--surface:\s*#1a212b/);
expectMatch('toolbar options have 44px touch targets', css, /\.toolbar-options label\s*\{[\s\S]*?min-height:\s*var\(--tap\)/);
expectMatch('formatter returns a Promise for UI lifecycle tracking', beautifier, /return Promise\.resolve\(runFormat\(\)\)/);
expectNoMatch('startup debug logging is removed', app, /window - onload|console\.log/);

const scriptMatches = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"[^>]*>/g)];
assert.ok(scriptMatches.length > 0, 'index.html should load application scripts');
for (const match of scriptMatches) {
  assert.match(match[0], /\bdefer\b/, `script must be deferred: ${match[2]}`);
}
pass('all application scripts are deferred');

const scriptSources = scriptMatches.map((match) => match[2]);
const expectedOrder = [
  './js/cfml-comment-utils.js',
  './js/cf-tags.js',
  './js/sql-keywords.js',
  './js/sql-beautifier.js',
  './js/js-lexer-utils.js',
  './js/deep-format.js',
  './js/tag-utils.js',
  './js/cfml-splitter.js',
  './js/toast.js',
  './js/clipboard.js',
  './js/pro-sql.js',
  './js/tree-sitter-cfml.js',
  './js/beautifier.js',
  './js/editor-ui.js',
  './js/app.js',
  './js/pwa.js'
];
assert.deepStrictEqual(scriptSources, expectedOrder, 'script dependency order must stay explicit');
pass('script dependency order is stable');
assert.match(sw, /'\.\/js\/editor-ui\.js'/, 'new UI module must be precached');
pass('new UI module is in the service-worker precache');
expectMatch('service-worker has an automatic build-version marker', sw, /CACHE_VERSION\s*=\s*'__BUILD_VERSION__'/);
expectMatch('PWA exposes an Update now action', pwa, /'Update now'/);
expectMatch('PWA saves the editor draft before activation', pwa, /sessionStorage|DRAFT_KEY/);
expectMatch('toast exposes an action button helper', toast, /simple_toast_action/);
expectMatch('toast action meets the touch target contract', css, /\.simple-toast-action\s*\{[\s\S]*?min-height:\s*var\(--tap\)/);
expectMatch('Pages deployment stamps the service-worker and page versions', deployWorkflow, /inject-build-version\.js/);
expectMatch('deployment version comes from the commit SHA', deployWorkflow, /BUILD_VERSION:\s*\$\{\{\s*github\.sha\s*\}\}/);
assert.match(packageJson.scripts.test, /version\.test\.js/, 'npm test must include version tests');
pass('npm test includes UI tests');

// ── Minimal DOM double ──────────────────────────────────────────────────────
function Element(options) {
  options = options || {};
  this.value = options.value || '';
  this.textContent = options.textContent || '';
  this.disabled = !!options.disabled;
  this.selectionStart = options.selectionStart || 0;
  this.selectionEnd = options.selectionEnd || this.selectionStart;
  this.listeners = Object.create(null);
  this.attributes = Object.create(null);
  this.dispatched = [];
}
Element.prototype.addEventListener = function (type, handler) {
  (this.listeners[type] || (this.listeners[type] = [])).push(handler);
};
Element.prototype.dispatchEvent = function (event) {
  this.dispatched.push(event.type);
  const handlers = this.listeners[event.type] || [];
  handlers.forEach((handler) => handler.call(this, event));
  return true;
};
Element.prototype.click = function () {
  const event = {
    type: 'click',
    target: this,
    preventDefault: function () { this.defaultPrevented = true; }
  };
  (this.listeners.click || []).forEach((handler) => handler.call(this, event));
};
Element.prototype.setAttribute = function (name, value) {
  this.attributes[name] = String(value);
};
Element.prototype.removeAttribute = function (name) {
  delete this.attributes[name];
};

function makeHarness() {
  const elements = {
    beautify: new Element({ textContent: 'Beautify' }),
    copy: new Element({ textContent: 'Copy' }),
    clear: new Element({ textContent: 'Clear' }),
    input: new Element(),
    output: new Element(),
    normalize_tab_width: new Element({ value: '0' })
  };
  const documentListeners = Object.create(null);
  const document = {
    readyState: 'complete',
    getElementById: function (id) { return elements[id] || null; },
    addEventListener: function (type, handler) {
      (documentListeners[type] || (documentListeners[type] = [])).push(handler);
    },
    createEvent: function () {
      return {
        type: '',
        initEvent: function (type) { this.type = type; }
      };
    },
    dispatch: function (event) {
      (documentListeners[event.type] || []).forEach((handler) => handler(event));
    }
  };
  let beautifyCalls = 0;
  let copyCalls = 0;
  let clearCalls = 0;
  const toasts = [];
  const context = {
    document,
    console: { error: function () {} },
    beautifyCodes: function () {
      beautifyCalls++;
      elements.output.value = 'formatted';
    },
    copy_output_data: function () { copyCalls++; return true; },
    clear_data: function () { clearCalls++; },
    simple_toast_msg: function (message) { toasts.push(message); },
    Promise,
    setTimeout,
    clearTimeout
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/editor-ui.js'), 'utf8'), context, {
    filename: 'js/editor-ui.js'
  });
  return { context, elements, document, counts: function () {
    return { beautifyCalls, copyCalls, clearCalls, toasts };
  }};
}

function keyEvent(key, options) {
  options = options || {};
  return {
    key,
    shiftKey: !!options.shiftKey,
    ctrlKey: !!options.ctrlKey,
    metaKey: !!options.metaKey,
    altKey: !!options.altKey,
    defaultPrevented: false,
    preventDefault: function () { this.defaultPrevented = true; }
  };
}

async function runPwaUpdateTest() {
  const input = {
    value: '',
    dispatched: [],
    dispatchEvent: function (event) { this.dispatched.push(event.type); }
  };
  const storageData = { 'cfb.pwa.draft.input': 'restored draft' };
  const storage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null; },
    setItem: function (key, value) { storageData[key] = String(value); },
    removeItem: function (key) { delete storageData[key]; }
  };
  const windowListeners = Object.create(null);
  const serviceWorkerListeners = Object.create(null);
  const registrationListeners = Object.create(null);
  const workerListeners = Object.create(null);
  const updateMessages = [];
  const actionPrompts = [];
  let reloads = 0;
  let updateChecks = 0;

  const registration = {
    waiting: null,
    installing: null,
    addEventListener: function (type, handler) {
      (registrationListeners[type] || (registrationListeners[type] = [])).push(handler);
    },
    dispatch: function (type) {
      (registrationListeners[type] || []).forEach(function (handler) { handler(); });
    },
    update: function () {
      updateChecks++;
      return Promise.resolve();
    }
  };
  const serviceWorker = {
    controller: { id: 'old-worker' },
    addEventListener: function (type, handler) {
      (serviceWorkerListeners[type] || (serviceWorkerListeners[type] = [])).push(handler);
    },
    register: function () { return Promise.resolve(registration); },
    dispatch: function (type) {
      (serviceWorkerListeners[type] || []).forEach(function (handler) { handler(); });
    }
  };
  const document = {
    visibilityState: 'visible',
    getElementById: function (id) { return id === 'input' ? input : null; },
    addEventListener: function () {},
    createEvent: function () {
      return { type: '', initEvent: function (type) { this.type = type; } };
    }
  };
  const context = {
    document,
    navigator: { serviceWorker },
    location: { protocol: 'https:', reload: function () { reloads++; } },
    sessionStorage: storage,
    console: { warn: function () {} },
    Promise,
    setInterval: function () { return 1; },
    simple_toast_msg: function () {},
    simple_toast_action: function (message, label, onAction) {
      actionPrompts.push({ message, label, onAction, remove: function () {} });
      return actionPrompts[actionPrompts.length - 1];
    }
  };
  context.window = context;
  context.addEventListener = function (type, handler) {
    (windowListeners[type] || (windowListeners[type] = [])).push(handler);
  };
  context.dispatchWindow = function (type) {
    (windowListeners[type] || []).forEach(function (handler) { handler(); });
  };
  vm.createContext(context);
  vm.runInContext(pwa, context, { filename: 'js/pwa.js' });

  assert.strictEqual(input.value, 'restored draft');
  assert.strictEqual(storage.getItem('cfb.pwa.draft.input'), null);
  assert.ok(input.dispatched.includes('input'));
  context.dispatchWindow('load');
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(updateChecks, 1);

  const worker = {
    state: 'installing',
    addEventListener: function (type, handler) {
      (workerListeners[type] || (workerListeners[type] = [])).push(handler);
    },
    postMessage: function (message) { updateMessages.push(message); },
    dispatch: function (type) {
      (workerListeners[type] || []).forEach(function (handler) { handler(); });
    }
  };
  registration.installing = worker;
  registration.dispatch('updatefound');
  worker.state = 'installed';
  worker.dispatch('statechange');
  assert.strictEqual(actionPrompts.length, 1);
  assert.strictEqual(actionPrompts[0].label, 'Update now');
  assert.strictEqual(updateMessages.length, 0);

  input.value = 'new draft before update';
  actionPrompts[0].onAction();
  assert.strictEqual(storage.getItem('cfb.pwa.draft.input'), 'new draft before update');
  assert.strictEqual(updateMessages.length, 1);
  assert.strictEqual(updateMessages[0].type, 'SKIP_WAITING');
  serviceWorker.dispatch('controllerchange');
  assert.strictEqual(reloads, 1);
  pass('PWA waits for Update now, saves input, activates and reloads');
}

async function runFormatterAsyncSafetyTest() {
  const ids = {
    split_html_tag: { checked: false },
    auto_copy: { checked: false },
    auto_clear: { checked: true },
    auto_clear_output: { checked: false },
    deep_sql: { checked: false },
    deep_css: { checked: false },
    deep_js: { checked: false },
    preserve_continuation_alignment: { checked: true },
    normalize_indent: { checked: false },
    normalize_tab_width: { value: '0' },
    semantic_indent: { checked: false },
    pro_sql: { checked: true },
    pro_sql_dialect: { value: 'sql' },
    input: { value: 'SELECT old_input' },
    output: { value: 'previous output' },
    language: { value: 'sql' }
  };
  const document = {
    getElementById: function (id) { return ids[id] || null; }
  };
  const scripts = [
    'js/cfml-comment-utils.js', 'js/cf-tags.js', 'js/sql-keywords.js', 'js/sql-beautifier.js',
    'js/js-lexer-utils.js', 'js/deep-format.js', 'js/tag-utils.js',
    'js/cfml-splitter.js', 'js/toast.js', 'js/clipboard.js', 'js/beautifier.js'
  ];
  const context = {
    document,
    console: { warn: function () {}, log: function () {} },
    Promise
  };
  vm.createContext(context);
  vm.runInContext(scripts.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'), context);

  let resolveLoad;
  context.isProSQLLoaded = function () { return false; };
  context.ensureProSQL = function () {
    return new Promise((resolve) => { resolveLoad = resolve; });
  };
  context.formatProSQLSync = function () { return 'formatted old input'; };

  const request = context.beautifyCodes();
  assert.ok(request && typeof request.then === 'function');
  ids.input.value = 'SELECT newer_input';
  resolveLoad();
  const staleResult = await request;
  assert.strictEqual(staleResult, false);
  assert.strictEqual(ids.input.value, 'SELECT newer_input');
  assert.strictEqual(ids.output.value, 'previous output');
  pass('async formatting cannot overwrite or clear newer input');

  ids.input.value = 'SELECT stable_input';
  ids.output.value = '';
  context.isProSQLLoaded = function () { return true; };
  const immediateResult = context.beautifyCodes();
  assert.ok(immediateResult && typeof immediateResult.then === 'function');
  assert.strictEqual(ids.input.value, '');
  assert.strictEqual(ids.output.value, 'formatted old input');
  assert.strictEqual(await immediateResult, true);
  pass('synchronous formatting remains immediate while returning a Promise');
}

(async function runBehaviorTests() {
  await runPwaUpdateTest();
  await runFormatterAsyncSafetyTest();
  const harness = makeHarness();
  const { context, elements, document, counts } = harness;
  const ui = context.CFBEditorUI;
  assert.ok(ui, 'editor UI API should be exposed');

  elements.input.value = 'one\ntwo';
  elements.input.selectionStart = 0;
  elements.input.selectionEnd = elements.input.value.length;
  assert.strictEqual(ui.applyTabEdit(elements.input, false), true);
  assert.strictEqual(elements.input.value, '\tone\n\ttwo');
  pass('multi-line Tab indentation');

  elements.input.value = '\talpha\n    beta';
  elements.input.selectionStart = 0;
  elements.input.selectionEnd = elements.input.value.length;
  assert.strictEqual(ui.applyTabEdit(elements.input, true), true);
  assert.strictEqual(elements.input.value, 'alpha\nbeta');
  pass('Shift-Tab removes one indentation level');

  elements.input.value = 'x';
  elements.input.selectionStart = 1;
  elements.input.selectionEnd = 1;
  const tabEvent = keyEvent('Tab');
  elements.input.dispatchEvent(Object.assign(tabEvent, { type: 'keydown' }));
  assert.strictEqual(elements.input.value, 'x\t');
  assert.strictEqual(tabEvent.defaultPrevented, true);
  assert.ok(elements.input.dispatched.includes('input'));
  pass('caret Tab insertion dispatches input');

  const escapeEvent = keyEvent('Escape');
  elements.input.dispatchEvent(Object.assign(escapeEvent, { type: 'keydown' }));
  const leaveEvent = keyEvent('Tab');
  elements.input.dispatchEvent(Object.assign(leaveEvent, { type: 'keydown' }));
  assert.strictEqual(leaveEvent.defaultPrevented, false);
  pass('Escape then Tab lets focus leave editor');

  elements.beautify.click();
  assert.strictEqual(counts().beautifyCalls, 1);
  assert.strictEqual(elements.output.value, 'formatted');
  assert.strictEqual(elements.beautify.disabled, false);
  assert.strictEqual(elements.beautify.attributes['aria-busy'], undefined);
  elements.copy.click();
  elements.clear.click();
  assert.strictEqual(counts().copyCalls, 1);
  assert.strictEqual(counts().clearCalls, 1);
  pass('button actions are delegated without inline handlers');

  const shortcut = keyEvent('Enter', { ctrlKey: true });
  shortcut.type = 'keydown';
  document.dispatch(shortcut);
  assert.strictEqual(shortcut.defaultPrevented, true);
  assert.strictEqual(counts().beautifyCalls, 2);
  const ordinaryEnter = keyEvent('Enter');
  ordinaryEnter.type = 'keydown';
  document.dispatch(ordinaryEnter);
  assert.strictEqual(counts().beautifyCalls, 2);
  pass('Ctrl-Enter triggers Beautify and plain Enter does not');

  // Replace the formatter with a pending Promise to verify loading lifecycle.
  let resolveFormat;
  let pendingCalls = 0;
  context.beautifyCodes = function () {
    pendingCalls++;
    return new Promise((resolve) => { resolveFormat = resolve; });
  };
  elements.beautify.click();
  elements.beautify.click();
  assert.strictEqual(pendingCalls, 1);
  assert.strictEqual(ui.isBusy(), true);
  assert.strictEqual(elements.beautify.disabled, true);
  assert.strictEqual(elements.beautify.attributes['aria-busy'], 'true');
  assert.strictEqual(elements.beautify.textContent, 'Beautifying…');
  assert.strictEqual(elements.clear.disabled, true);
  pass('Beautify shows an async busy state');

  resolveFormat(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(ui.isBusy(), false);
  assert.strictEqual(elements.beautify.disabled, false);
  assert.strictEqual(elements.beautify.textContent, 'Beautify');
  assert.strictEqual(elements.clear.disabled, false);
  pass('Beautify restores state after async completion');

  elements.output.value = 'output to preserve';
  context.beautifyCodes = function () {
    return Promise.reject(new Error('synthetic formatter failure'));
  };
  elements.beautify.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(elements.output.value, 'output to preserve');
  assert.strictEqual(elements.beautify.disabled, false);
  assert.strictEqual(elements.clear.disabled, false);
  assert.strictEqual(counts().toasts.at(-1), 'Beautify failed. Your input was kept.');
  pass('Beautify restores output and reports async failures');

  console.log('All UI tests passed.');
})().catch((error) => {
  console.error('FAIL UI:', error.stack || error);
  process.exitCode = 1;
});
