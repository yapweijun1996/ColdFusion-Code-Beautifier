#!/usr/bin/env node
/* End-to-end tests for the GitHub-hosted file CLI. */

'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var sourceEncoding = require('../tools/source-encoding.js');
var packageManifest = require('../package.json');

var root = path.join(__dirname, '..');
var cli = path.join(root, 'tools', 'beautify-file.js');
var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfml-beautifier-'));
process.on('exit', function () {
    if (fs.existsSync(tempDir)) {
        // The fixture directory contains files and links only; do not follow
        // links or recursively delete an unexpected directory.
        fs.readdirSync(tempDir).forEach(function (name) {
            fs.unlinkSync(path.join(tempDir, name));
        });
        fs.rmdirSync(tempDir);
    }
});
checkPackageManifest();
var inputPath = path.join(tempDir, 'input.cfm');
var source = [
    '<cfif ok>',
    '<cfset value = 1>',
    '</cfif>',
    ''
].join('\n');
var expected = [
    '<cfif ok>',
    '\t<cfset value = 1>',
    '</cfif>',
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

function checkPackageManifest() {
    check('NPM package exposes the serverless CLI',
        packageManifest.private !== true
        && packageManifest.bin
        && packageManifest.bin['coldfusion-code-beautifier'] === 'tools/beautify-file.js'
        && Array.isArray(packageManifest.files)
        && packageManifest.files.indexOf('vendor/sql-formatter.min.js') !== -1);
}

var fileRun = run([inputPath]);
check('CLI file mode exits successfully', fileRun.status === 0, fileRun.stderr);
var defaultOutput = path.join(tempDir, 'input_beutifier.cfm');
check('CLI file mode writes the fixed _beutifier.cfm suffix', fs.existsSync(defaultOutput));
check('CLI file mode uses the formatter pipeline', fs.readFileSync(defaultOutput, 'utf8') === expected);
check('CLI file mode reports the generated path', fileRun.stderr.indexOf('input_beutifier.cfm') !== -1);
var originalOutput = fs.readFileSync(defaultOutput);
var repeatRun = run([inputPath]);
check('CLI refuses an existing default destination', repeatRun.status !== 0 && /EEXIST|exist/i.test(repeatRun.stderr),
    repeatRun.stderr);
check('CLI preserves existing default output and input',
    fs.readFileSync(defaultOutput).equals(originalOutput) && fs.readFileSync(inputPath, 'utf8') === source);
var fileStdoutRun = run([inputPath, '--stdout']);
check('CLI file stdout ignores the existing default output',
    fileStdoutRun.status === 0 && fileStdoutRun.stdout === expected
    && fs.readFileSync(defaultOutput).equals(originalOutput), fileStdoutRun.stderr);

var collisionInput = path.join(tempDir, 'collision.sql');
var collisionOutput = path.join(tempDir, 'collision_beutifier.cfm');
fs.writeFileSync(collisionInput, 'SELECT 1', 'utf8');
fs.writeFileSync(collisionOutput, 'USER DATA: do not overwrite', 'utf8');
var collisionRun = run([collisionInput, '--language', 'sql']);
check('CLI rejects unrelated existing default output', collisionRun.status !== 0);
check('CLI leaves unrelated output and input unchanged',
    fs.readFileSync(collisionOutput, 'utf8') === 'USER DATA: do not overwrite'
    && fs.readFileSync(collisionInput, 'utf8') === 'SELECT 1');

var linkedInput = path.join(tempDir, 'linked.cfm');
var linkedOutput = path.join(tempDir, 'linked_beutifier.cfm');
fs.writeFileSync(linkedInput, source, 'utf8');
fs.linkSync(linkedInput, linkedOutput);
var linkedRun = run([linkedInput]);
check('CLI refuses a hard-linked default output', linkedRun.status !== 0);
check('CLI preserves hard-linked default input bytes', fs.readFileSync(linkedInput, 'utf8') === source
    && fs.readFileSync(linkedOutput, 'utf8') === source);

function trySymlink(target, linkPath) {
    try {
        fs.symlinkSync(target, linkPath, 'file');
        return true;
    } catch (err) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOSYS'].indexOf(err.code) !== -1) {
            console.log('SKIP: symlink creation unavailable: ' + err.code);
            return false;
        }
        throw err;
    }
}

var symlinkInput = path.join(tempDir, 'symlink.cfm');
var symlinkOutput = path.join(tempDir, 'symlink_beutifier.cfm');
fs.writeFileSync(symlinkInput, source, 'utf8');
if (trySymlink(symlinkInput, symlinkOutput)) {
    var symlinkRun = run([symlinkInput]);
    check('CLI refuses a symlinked default output', symlinkRun.status !== 0
        && fs.readFileSync(symlinkInput, 'utf8') === source);
    var explicitSymlinkRun = run([symlinkInput, '--output', symlinkOutput]);
    check('CLI refuses an explicit symlink to the input', explicitSymlinkRun.status !== 0
        && /input file/i.test(explicitSymlinkRun.stderr) && fs.readFileSync(symlinkInput, 'utf8') === source,
        explicitSymlinkRun.stderr);
}
var danglingInput = path.join(tempDir, 'dangling.cfm');
var danglingOutput = path.join(tempDir, 'dangling_beutifier.cfm');
var missingTarget = path.join(tempDir, 'missing-target.cfm');
fs.writeFileSync(danglingInput, source, 'utf8');
if (trySymlink(missingTarget, danglingOutput)) {
    var danglingRun = run([danglingInput]);
    check('CLI refuses a dangling default symlink without creating its target',
        danglingRun.status !== 0 && !fs.existsSync(missingTarget)
        && fs.lstatSync(danglingOutput).isSymbolicLink());
}

var utf16InputPath = path.join(tempDir, 'utf16_input.cfm');
var utf16Source = source.replace(/\n/g, '\r\n');
fs.writeFileSync(utf16InputPath, sourceEncoding.encodeSource(utf16Source, {
    encoding: 'utf16be', bom: true
}));
var utf16Run = run([utf16InputPath]);
check('CLI UTF-16BE input exits successfully', utf16Run.status === 0, utf16Run.stderr);
var utf16OutputPath = path.join(tempDir, 'utf16_input_beutifier.cfm');
var utf16Output = sourceEncoding.decodeSource(fs.readFileSync(utf16OutputPath));
check('CLI preserves UTF-16BE output encoding',
    utf16Output.encoding === 'utf16be' && utf16Output.bom === true);
check('CLI preserves UTF-16BE formatted content and CRLF', utf16Output.text === [
    '<cfif ok>',
    '\t<cfset value = 1>',
    '</cfif>',
    ''
].join('\r\n'));

[
    { label: 'UTF-8 BOM', encoding: 'utf8', bom: true },
    { label: 'UTF-16LE', encoding: 'utf16le', bom: true }
].forEach(function (format) {
    var encodedInputPath = path.join(tempDir, format.encoding + '_input.cfm');
    fs.writeFileSync(encodedInputPath, sourceEncoding.encodeSource(source, format));
    var encodedRun = run([encodedInputPath]);
    check('CLI ' + format.label + ' input exits successfully', encodedRun.status === 0, encodedRun.stderr);
    var encodedOutput = sourceEncoding.decodeSource(fs.readFileSync(
        path.join(tempDir, format.encoding + '_input_beutifier.cfm')
    ));
    check('CLI preserves ' + format.label + ' output encoding',
        encodedOutput.encoding === format.encoding && encodedOutput.bom === format.bom);
    check('CLI preserves ' + format.label + ' formatted content', encodedOutput.text === expected);
});
[
    { label: 'UTF-16LE', bom: [0xFF, 0xFE], byte: 0x41 },
    { label: 'UTF-16BE', bom: [0xFE, 0xFF], byte: 0x00 }
].forEach(function (format) {
    var malformed = Buffer.from(format.bom.concat([format.byte]));
    var malformedInput = path.join(tempDir, format.label + '-truncated.cfm');
    var malformedOutput = path.join(tempDir, format.label + '-truncated_beutifier.cfm');
    fs.writeFileSync(malformedInput, malformed);
    var malformedRun = run([malformedInput]);
    check('CLI rejects odd-byte ' + format.label + ' file with a clear error',
        malformedRun.status !== 0 && /UTF-16.*odd/i.test(malformedRun.stderr), malformedRun.stderr);
    check('CLI retains odd-byte ' + format.label + ' input and creates no output',
        fs.readFileSync(malformedInput).equals(malformed) && !fs.existsSync(malformedOutput));
    fs.writeFileSync(malformedOutput, 'preserve me');
    var malformedExplicit = run([malformedInput, '--output', malformedOutput]);
    check('CLI preserves explicit destination for odd-byte ' + format.label,
        malformedExplicit.status !== 0 && fs.readFileSync(malformedOutput, 'utf8') === 'preserve me');
    var malformedStdin = run(['-', '--stdout', '--language', 'cfml'], malformed);
    check('CLI rejects odd-byte ' + format.label + ' stdin without stdout',
        malformedStdin.status !== 0 && malformedStdin.stdout === '' && /UTF-16.*odd/i.test(malformedStdin.stderr),
        malformedStdin.stderr);

    var valid = sourceEncoding.encodeSource(source, {
        encoding: format.label === 'UTF-16LE' ? 'utf16le' : 'utf16be', bom: true
    });
    var validStdout = childProcess.spawnSync(process.execPath, [cli, '-', '--stdout', '--language', 'cfml'], {
        cwd: root, input: valid
    });
    var expectedBytes = sourceEncoding.encodeSource(expected, {
        encoding: format.label === 'UTF-16LE' ? 'utf16le' : 'utf16be', bom: true
    });
    check('CLI preserves ' + format.label + ' BOM on stdout',
        validStdout.status === 0 && validStdout.stdout.equals(expectedBytes),
        String(validStdout.stderr));
});

var stdoutRun = run(['-', '--stdout', '--language', 'cfml'], source);
check('CLI stdin/stdout mode exits successfully', stdoutRun.status === 0, stdoutRun.stderr);
check('CLI stdout contains only formatted code', stdoutRun.stdout === expected,
    'actual=' + JSON.stringify(stdoutRun.stdout));
check('CLI stdout mode does not print a file message', stdoutRun.stderr.indexOf('Wrote ') === -1);

var invalidJs = 'function f() {\n  if (ready) {';
var invalidJsRun = run(['-', '--stdout', '--language', 'js'], invalidJs);
check('CLI preserves unparseable JavaScript', invalidJsRun.status === 0 && invalidJsRun.stdout === invalidJs);
check('CLI reports safe JavaScript fallback without printing input',
    invalidJsRun.stderr.indexOf('kept unchanged') !== -1 && invalidJsRun.stderr.indexOf(invalidJs) === -1);

var sensitiveSql = "SELECT 'SYNTHETIC_PRIVATE_MARKER";
var sensitiveSqlRun = run(['-', '--stdout', '--language', 'sql', '--pro-sql'], sensitiveSql);
check('CLI reports Pro SQL fallback without logging SQL or parser excerpts',
    sensitiveSqlRun.status === 0
    && sensitiveSqlRun.stdout.indexOf('SYNTHETIC_PRIVATE_MARKER') !== -1
    && /falling back/i.test(sensitiveSqlRun.stderr)
    && sensitiveSqlRun.stderr.indexOf('SYNTHETIC') === -1,
    sensitiveSqlRun.stderr);

var customOutput = path.join(tempDir, 'custom_beutifier.cfm');
var customRun = run([inputPath, '--output', customOutput, '--no-deep-sql', '--no-deep-css', '--no-deep-js']);
check('CLI accepts an explicit _beutifier.cfm output', customRun.status === 0, customRun.stderr);
check('CLI writes the explicit output path', fs.existsSync(customOutput));
fs.writeFileSync(customOutput, 'old unrelated output', 'utf8');
var overwriteRun = run([inputPath, '--output', customOutput]);
check('CLI retains explicit output overwrite behavior',
    overwriteRun.status === 0 && fs.readFileSync(customOutput, 'utf8') === expected,
    overwriteRun.stderr);
var explicitHardlinkRun = run([linkedInput, '--output', linkedOutput]);
check('CLI refuses an explicit hard link to the input',
    explicitHardlinkRun.status !== 0 && /input file/i.test(explicitHardlinkRun.stderr)
    && fs.readFileSync(linkedInput, 'utf8') === source, explicitHardlinkRun.stderr);
var sameInput = path.join(tempDir, 'same_beutifier.cfm');
fs.writeFileSync(sameInput, source, 'utf8');
var sameRun = run([sameInput, '--output', path.join(tempDir, '.', 'same_beutifier.cfm')]);
check('CLI refuses the input itself as explicit output',
    sameRun.status !== 0 && /input file/i.test(sameRun.stderr)
    && fs.readFileSync(sameInput, 'utf8') === source, sameRun.stderr);

var otherTarget = path.join(tempDir, 'other-target.cfm');
var otherSymlink = path.join(tempDir, 'other_beutifier.cfm');
fs.writeFileSync(otherTarget, 'old target', 'utf8');
if (trySymlink(otherTarget, otherSymlink)) {
    var otherRun = run([inputPath, '--output', otherSymlink]);
    check('CLI retains explicit output symlink behavior for a different file',
        otherRun.status === 0 && fs.readFileSync(otherTarget, 'utf8') === expected
        && fs.lstatSync(otherSymlink).isSymbolicLink(), otherRun.stderr);
}

var proInputPath = path.join(tempDir, 'structural-query.cfm');
var proSource = [
    '<cfquery name="q">',
    '\tSELECT id',
    '\tFROM t',
    '\t<cfif flag>',
    '\t\twhere x=1',
    '\t<cfelse>',
    '\t\twhere x=2',
    '\t</cfif>',
    '\tAND y=2',
    '</cfquery>',
    ''
].join('\n');
fs.writeFileSync(proInputPath, proSource, 'utf8');
var proRun = run([proInputPath, '--pro-sql', '--dialect', 'postgresql']);
check('CLI Pro SQL structural query exits successfully', proRun.status === 0, proRun.stderr);
var proOutputPath = path.join(tempDir, 'structural-query_beutifier.cfm');
check('CLI Pro SQL structural query output exists', fs.existsSync(proOutputPath));
var proSecondRun = run([
    '-', '--stdout', '--pro-sql', '--dialect', 'postgresql'
], fs.readFileSync(proOutputPath, 'utf8'));
check('CLI Pro SQL structural query is idempotent',
    proSecondRun.status === 0 && proSecondRun.stdout === fs.readFileSync(proOutputPath, 'utf8'),
    proSecondRun.stderr);

var concurrentInput = path.join(tempDir, 'concurrent.cfm');
var concurrentOutput = path.join(tempDir, 'concurrent_beutifier.cfm');
fs.writeFileSync(concurrentInput, source, 'utf8');
function runConcurrent() {
    return new Promise(function (resolve, reject) {
        var child = childProcess.spawn(process.execPath, [cli, concurrentInput], { cwd: root });
        var stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', function (chunk) { stderr += chunk; });
        child.on('error', reject);
        child.on('close', function (status) { resolve({ status: status, stderr: stderr }); });
    });
}
Promise.all([runConcurrent(), runConcurrent()]).then(function (results) {
    check('CLI concurrent default output has exactly one creator',
        results.filter(function (result) { return result.status === 0; }).length === 1
        && results.filter(function (result) { return result.status !== 0 && /EEXIST|exist/i.test(result.stderr); }).length === 1,
        JSON.stringify(results));
    check('CLI concurrent output and input are intact',
        fs.readFileSync(concurrentOutput, 'utf8') === expected
        && fs.readFileSync(concurrentInput, 'utf8') === source);
    console.log('All CLI tests passed.');
}).catch(function (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
});
