'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var cli = path.join(root, 'tools', 'beautify-file.js');

function formatCLI(input) {
	var result = childProcess.spawnSync(process.execPath,
		[cli, '-', '--language', 'sql', '--stdout'],
		{ input: input, encoding: 'utf8' });
	assert.strictEqual(result.status, 0, result.stderr);
	return result.stdout;
}

var context = { console: { log: function() {}, warn: function() {} } };
vm.createContext(context);
vm.runInContext(require('../tools/formatter-script-manifest').map(function(file) {
	return fs.readFileSync(path.join(root, file), 'utf8');
}).join('\n'), context);

var sources = [
	'SELECT 1e-3, 2E+4, -1.2e-5, 0xFF, +0x1A FROM t WHERE x=1',
	"SELECT @x, @@version, $1, N'abc', E'hello', foo$1 FROM t WHERE id=@x",
	'SELECT "quoted"suffix, 123name, @name$1 FROM t WHERE x=1',
	"SELECT 'a\\b', \"a\"\"b\", 'it''s' FROM t WHERE x=1"
];
var numberOutput = formatCLI(sources[0]);
['1e-3', '2E+4', '-1.2e-5', '0xFF', '+0x1A'].forEach(function(value) {
	assert.ok(numberOutput.includes(value), 'numeric literal preserved: ' + value);
});
var parameterOutput = formatCLI(sources[1]);
['@x', '@@version', '$1', "N'abc'", "E'hello'", 'foo$1'].forEach(function(value) {
	assert.ok(parameterOutput.includes(value), 'parameter or literal preserved: ' + value);
});
var adjacentOutput = formatCLI(sources[2]);
['"quoted"suffix', '123name', '@name$1'].forEach(function(value) {
	assert.ok(adjacentOutput.includes(value), 'adjacent source preserved: ' + value);
});
var ordinaryOutput = formatCLI(sources[3]);
["'a\\b'", '"a""b"', "'it''s'"].forEach(function(value) {
	assert.ok(ordinaryOutput.includes(value), 'ordinary quoted token preserved: ' + value);
});

// Backslash-quote can end a standard SQL token but not a MySQL-style token.
// Both interpretations must retain the entire uncertain suffix byte-for-byte.
[
	"'x\\' AS a, 'z' AS b FROM t WHERE id=1",
	"E'x\\' AS a, 'z' AS b FROM t WHERE id=1",
	'"x\\" AS a, "z" AS b FROM t WHERE id=1',
	"'x\\' AND 1e-3, N'abc' -- mixed\nFROM t"
].forEach(function(suffix) {
	var source = 'select a,b from t where x = ' + suffix;
	var formatted = context.beautifySQL(source);
	assert.ok(formatted.endsWith(suffix), 'ambiguous suffix preserved exactly');
	assert.notStrictEqual(formatted, source, 'safe preceding SQL still formats');
	assert.ok(formatCLI(source).trim().endsWith(suffix), 'CLI preserves ambiguous suffix exactly');
});

// Exercise the actual embedded consumer and its built-in fallback after Pro fails.
context.isProSQLLoaded = function() { return true; };
context.formatProSQLSync = function() { throw new Error('synthetic formatter failure'); };
var embedded = '<cfquery name="q">\nSELECT 1e-3, 0xFF, @x, $1, N\'abc\' FROM t\n</cfquery>';
var fallback = context.deepFormatEmbedded(embedded, { sql: true, css: false, js: false, sqlPro: true }, embedded);
['1e-3', '0xFF', '@x', '$1', "N'abc'"].forEach(function(value) {
	assert.ok(fallback.includes(value), 'embedded fallback preserves ' + value);
});
console.log('PASS SQL lexical safety');
