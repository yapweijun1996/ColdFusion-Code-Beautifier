'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'tools', 'prepare-pages.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-pages-test-'));
const source = path.join(temp, 'source');
const output = path.join(temp, 'site');

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
    else throw new Error('Unexpected non-file in public fixture');
  }
}
function run(...args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: source, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
function removeTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(directory);
}
function rejectsPrivate(relative) {
  const file = path.join(source, relative);
  fs.writeFileSync(file, 'synthetic private data');
  const result = run('--check');
  assert.notStrictEqual(result.status, 0, 'private entry is rejected: ' + relative);
  assert(!result.stderr.includes(path.basename(file)), 'private filenames are not printed');
  const destination = path.join(temp, 'rejected-site');
  assert.notStrictEqual(run('--output', destination).status, 0, 'private entry blocks staging');
  assert(!fs.existsSync(destination), 'no artifact is staged for a private checkout');
  fs.unlinkSync(file);
}

async function main() {
  fs.mkdirSync(source);
  for (const name of ['index.html', 'styles.css', 'favicon.svg', 'manifest.webmanifest', 'og_img.jpg', 'sw.js', 'LICENSE']) {
    fs.copyFileSync(path.join(repo, name), path.join(source, name));
  }
  copyTree(path.join(repo, 'js'), path.join(source, 'js'));
  copyTree(path.join(repo, 'vendor'), path.join(source, 'vendor'));
  fs.mkdirSync(path.join(source, 'sample'));
  fs.mkdirSync(path.join(source, 'sample_codebase'));
  fs.writeFileSync(path.join(source, 'sample', '.gitkeep'), '');
  fs.writeFileSync(path.join(source, 'sample', 'README.md'), 'placeholder');
  fs.writeFileSync(path.join(source, 'sample_codebase', '.gitkeep'), '');
  assert.strictEqual(run('--check').status, 0, 'permitted placeholders do not block CI');
  for (const relative of ['sample/case.cfm', 'sample/case.CFM', 'sample/case.cfc', 'sample/case.txt', 'sample_codebase/case.js']) {
    rejectsPrivate(relative);
  }
  fs.mkdirSync(path.join(source, 'sample', 'nested'));
  assert.notStrictEqual(run('--check').status, 0, 'nested directories cannot hide private files');
  fs.rmdirSync(path.join(source, 'sample', 'nested'));

  fs.writeFileSync(path.join(source, 'unpublished-secret.txt'), 'synthetic private data');
  fs.writeFileSync(path.join(source, 'js', 'unpublished.js'), 'synthetic private data');
  fs.writeFileSync(path.join(source, 'vendor', 'tree-sitter', 'unpublished.txt'), 'synthetic private data');
  const prepared = run('--output', output);
  assert.strictEqual(prepared.status, 0, prepared.stderr);
  for (const relative of ['sample', 'sample_codebase', 'unpublished-secret.txt', 'js/unpublished.js', 'vendor/tree-sitter/unpublished.txt']) {
    assert(!fs.existsSync(path.join(output, relative)), 'non-public entry is not published: ' + relative);
  }
  assert.notStrictEqual(run('--output', output).status, 0, 'existing output cannot be reused');

  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)) {
    assert(fs.existsSync(path.join(output, match[1])), 'page resource exists: ' + match[1]);
  }
  const handlers = {};
  const worker = fs.readFileSync(path.join(output, 'sw.js'), 'utf8');
  vm.runInNewContext(worker, {
    self: { addEventListener(type, handler) { handlers[type] = handler; } },
    caches: { open() { return Promise.resolve({ addAll(requests) {
      for (const request of requests) {
        const resource = request.url === './' ? 'index.html' : request.url.slice(2);
        assert(fs.existsSync(path.join(output, resource)), 'offline resource exists: ' + resource);
      }
      return Promise.resolve();
    } }); } },
    Request: class { constructor(url) { this.url = url; } }
  });
  let installation;
  handlers.install({ waitUntil(promise) { installation = promise; } });
  await installation;
  for (const file of ['web-tree-sitter.js', 'web-tree-sitter.wasm', 'tree-sitter-cfml.wasm', 'tree-sitter-cfscript.wasm']) {
    assert(fs.existsSync(path.join(output, 'vendor', 'tree-sitter', file)), 'lazy parser resource exists: ' + file);
  }

  const link = path.join(source, 'sample', 'link');
  try {
    fs.symlinkSync(path.join(source, 'index.html'), link, 'file');
    assert.notStrictEqual(run('--check').status, 0, 'sample symlinks are rejected');
    fs.unlinkSync(link);
    const app = path.join(source, 'js', 'app.js');
    fs.renameSync(app, app + '.original');
    try {
      fs.symlinkSync(path.join(source, 'index.html'), app, 'file');
      assert.notStrictEqual(run('--output', path.join(temp, 'linked-site')).status, 0, 'public asset symlinks are rejected');
    } finally {
      if (fs.existsSync(app)) fs.unlinkSync(app);
      fs.renameSync(app + '.original', app);
    }
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    console.log('SKIP: symlink checks require permission on this host');
  }
  console.log('PASS: Pages privacy guard and public asset staging');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  removeTree(temp);
});
