#!/usr/bin/env node
/* Stamp the deploy artifact with a deterministic source version.
 *
 * GitHub Pages runs this after npm test. The tracked sw.js intentionally keeps
 * a placeholder; the published artifact receives the current commit SHA, so
 * every source commit produces a byte-different service-worker script without
 * requiring a manual cache-version edit.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var target = process.argv[2] || path.resolve(__dirname, '..', 'sw.js');

function gitCommit() {
    try {
        return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: path.dirname(target),
            encoding: 'utf8'
        }).trim();
    } catch (e) {
        return '';
    }
}

function buildVersion() {
    var raw = process.env.BUILD_VERSION || process.env.GITHUB_SHA || gitCommit();
    raw = String(raw || '').trim();
    if (!raw) return 'vlocal';

    /* Full Git SHAs are shortened for readable cache names. */
    if (/^v?[0-9a-f]{40}$/i.test(raw)) {
        raw = raw.replace(/^v/i, '').slice(0, 12);
        return 'v' + raw;
    }

    raw = raw.replace(/[^A-Za-z0-9._-]/g, '-');
    if (raw.charAt(0).toLowerCase() === 'v') return raw;
    return 'v' + raw.slice(0, 32);
}

var source = fs.readFileSync(target, 'utf8');
var marker = /(const\s+CACHE_VERSION\s*=\s*')[^']*(';)/;
if (!marker.test(source)) {
    console.error('Cannot find CACHE_VERSION in ' + target);
    process.exit(1);
}

var version = buildVersion();
var stamped = source.replace(marker, '$1' + version + '$2');
fs.writeFileSync(target, stamped, 'utf8');
console.log('Stamped ' + target + ' with CACHE_VERSION=' + version);
