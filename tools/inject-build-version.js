#!/usr/bin/env node
/* Stamp deployment artifacts with a deterministic source version.
 *
 * GitHub Pages runs this after npm test. The tracked files intentionally keep
 * a placeholder; the published artifacts receive the current commit SHA, so
 * every source commit produces a byte-different service-worker script and a
 * visible version in the page footer.
 *
 * Usage:
 *   node tools/inject-build-version.js
 *   node tools/inject-build-version.js sw.js index.html
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var root = path.resolve(__dirname, '..');
var targets = process.argv.slice(2).map(function (file) {
    return path.resolve(process.cwd(), file);
});
if (!targets.length) targets = [path.join(root, 'sw.js'), path.join(root, 'index.html')];

function gitCommit() {
    try {
        return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8'
        }).trim();
    } catch (e) {
        return '';
    }
}

function buildVersion() {
    var raw = process.env.BUILD_VERSION || process.env.GITHUB_SHA || gitCommit();
    raw = String(raw || '').trim();
    if (!raw) return 'vlocal-' + Date.now();

    /* Full Git SHAs are shortened for readable cache names and footers. */
    if (/^v?[0-9a-f]{40}$/i.test(raw)) {
        raw = raw.replace(/^v/i, '').slice(0, 12);
        return 'v' + raw;
    }

    raw = raw.replace(/[^A-Za-z0-9._-]/g, '-');
    if (raw.charAt(0).toLowerCase() === 'v') return raw;
    return 'v' + raw.slice(0, 32);
}

function stampFile(target, version) {
    var source = fs.readFileSync(target, 'utf8');
    var stamped;
    var swMarker = /(const\s+CACHE_VERSION\s*=\s*')[^']*(';)/;
    var htmlMarker = /(data-build-version\s*=\s*")[^"]*(")/;

    if (swMarker.test(source)) {
        stamped = source.replace(swMarker, '$1' + version + '$2');
    } else if (htmlMarker.test(source)) {
        stamped = source.replace(htmlMarker, '$1' + version + '$2');
    } else {
        throw new Error('Cannot find a version marker in ' + target);
    }
    fs.writeFileSync(target, stamped, 'utf8');
    console.log('Stamped ' + target + ' with BUILD_VERSION=' + version);
}

var version = buildVersion();
try {
    targets.forEach(function (target) { stampFile(target, version); });
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
