'use strict';

const fs = require('fs');
const path = require('path');
const formatterScripts = require('./formatter-script-manifest');

// Only browser assets and their license notices belong in the Pages artifact.
// Keep this list in sync with index.html, sw.js, and lazy-loaded resources.
const publicAssets = [
  'index.html', 'styles.css', 'favicon.svg', 'manifest.webmanifest', 'og_img.jpg', 'sw.js', 'LICENSE',
  ...formatterScripts,
  'js/pro-sql.js', 'js/tree-sitter-cfml.js', 'js/editor-ui.js', 'js/app.js', 'js/pwa.js',
  'vendor/acorn.LICENSE', 'vendor/sql-formatter.min.js',
  'vendor/tree-sitter/README.md', 'vendor/tree-sitter/package.json',
  'vendor/tree-sitter/web-tree-sitter.js', 'vendor/tree-sitter/web-tree-sitter.wasm',
  'vendor/tree-sitter/tree-sitter-cfml.wasm', 'vendor/tree-sitter/tree-sitter-cfscript.wasm'
];

function checkPrivateSamples(root) {
  for (const name of fs.readdirSync(root)) {
    const lower = name.toLowerCase();
    if (lower !== 'sample' && lower !== 'sample_codebase') continue;
    const directory = path.join(root, name);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Private sample directory must be a real directory, not a link or file.');
    }
    const allowed = lower === 'sample' ? new Set(['.gitkeep', 'README.md']) : new Set(['.gitkeep']);
    for (const entry of fs.readdirSync(directory)) {
      const entryStat = fs.lstatSync(path.join(directory, entry));
      if (!allowed.has(entry) || !entryStat.isFile() || entryStat.isSymbolicLink()) {
        throw new Error('Private sample directory contains an unexpected entry; remove it from the CI checkout.');
      }
    }
  }
}

function checkedAsset(root, relative) {
  let current = root;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error('Pages assets must be regular files in real directories: ' + relative);
    }
  }
  return current;
}

function preparePages(root, destination) {
  checkPrivateSamples(root);
  const files = publicAssets.map((relative) => [relative, checkedAsset(root, relative)]);
  // Fail rather than reuse an existing directory that might contain private files.
  fs.mkdirSync(destination);
  for (const [relative, source] of files) {
    const target = path.join(destination, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--check') {
    checkPrivateSamples(process.cwd());
  } else if (process.argv.length === 4 && process.argv[2] === '--output') {
    preparePages(process.cwd(), path.resolve(process.argv[3]));
  } else {
    throw new Error('Usage: node tools/prepare-pages.js --check | --output <new-directory>');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
