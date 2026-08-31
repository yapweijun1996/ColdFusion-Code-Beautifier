#!/usr/bin/env node
/* End-to-end tests for the GitHub-hosted file CLI. */

'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var root = path.join(__dirname, '..');
var cli = path.join(root, 'tools', 'beautify-file.js');
var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfml-beautifier-'));
var inputPath = path.join(tempDir, 'input.cfm');
var source = [
    '<cfoutput>',
    '<cfif ok>',
    'value',
    '</cfif>',
    '</cfoutput>',
    ''
].join('\n');
var expected = [
    '<cfoutput>',
    '\t<cfif ok>',
    '\t\tvalue',
    '\t</cfif>',
    '</cfoutput>',
    ''
].join('\n');

fs.writeFileSync(inputPath, source, 'utf8');

function run(args, input) {
    return childProcess.spawnSync(process.execPath, [cli].concat(args), {
        cwd: root,
        input: input,
        encoding: 'utf8'
    });
}

function check(name, condition, detail) {
    if (!condition) {
        throw new Error('FAIL: ' + name + (detail ? '\n' + detail : ''));
    }
    console.log('PASS: ' + name);
}

var fileRun = run([inputPath]);
check('CLI file mode exits successfully', fileRun.status === 0, fileRun.stderr);
var defaultOutput = path.join(tempDir, 'input_beutifier.cfm');
check('CLI file mode writes the fixed _beutifier.cfm suffix', fs.existsSync(defaultOutput));
check('CLI file mode uses the formatter pipeline', fs.readFileSync(defaultOutput, 'utf8') === expected);
check('CLI file mode reports the generated path', fileRun.stderr.indexOf('input_beutifier.cfm') !== -1);

var stdoutRun = run(['-', '--stdout', '--language', 'cfml'], source);
check('CLI stdin/stdout mode exits successfully', stdoutRun.status === 0, stdoutRun.stderr);
check('CLI stdout contains only formatted code', stdoutRun.stdout === expected,
    'actual=' + JSON.stringify(stdoutRun.stdout));
check('CLI stdout mode does not print a file message', stdoutRun.stderr.indexOf('Wrote ') === -1);

var customOutput = path.join(tempDir, 'custom_beutifier.cfm');
var customRun = run([inputPath, '--output', customOutput, '--no-deep-sql', '--no-deep-css', '--no-deep-js']);
check('CLI accepts an explicit _beutifier.cfm output', customRun.status === 0, customRun.stderr);
check('CLI writes the explicit output path', fs.existsSync(customOutput));

console.log('All CLI tests passed.');
