'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tool = path.join(root, 'tools', 'inject-build-version.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-version-'));
const swPath = path.join(tempDir, 'sw.js');

try {
  fs.writeFileSync(swPath, "const CACHE_VERSION = '__BUILD_VERSION__';\n", 'utf8');
  const env = Object.assign({}, process.env, {
    BUILD_VERSION: '0123456789abcdef0123456789abcdef01234567'
  });
  childProcess.execFileSync(process.execPath, [tool, swPath], { env, encoding: 'utf8' });
  assert.match(fs.readFileSync(swPath, 'utf8'), /CACHE_VERSION = 'v0123456789ab';/);

  const secondEnv = Object.assign({}, process.env, { BUILD_VERSION: 'vtest-42' });
  childProcess.execFileSync(process.execPath, [tool, swPath], { env: secondEnv, encoding: 'utf8' });
  assert.match(fs.readFileSync(swPath, 'utf8'), /CACHE_VERSION = 'vtest-42';/);
  console.log('PASS: deployment version stamping uses deterministic source versions');
} finally {
  try { fs.unlinkSync(swPath); } catch (e) {}
  try { fs.rmdirSync(tempDir); } catch (e) {}
}
