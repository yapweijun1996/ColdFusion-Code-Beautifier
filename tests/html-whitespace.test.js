'use strict';

var assert = require('assert');
var path = require('path');
var childProcess = require('child_process');
var fs = require('fs');
var vm = require('vm');
var cli = path.join(__dirname, '..', 'tools', 'beautify-file.js');

function format(source, flags) {
	var result = childProcess.spawnSync(process.execPath,
		[cli, '-', '--language', 'cfml', '--stdout'].concat(flags || []),
		{ input: source, encoding: 'utf8' });
	assert.strictEqual(result.status, 0, result.stderr);
	return result.stdout;
}

var cases = [
	'<div><span>A</span><span>B</span></div>',
	'<div><span>A</span> <span>B</span></div>',
	'<div><span>A</span><cfif flag><span>B</span></cfif><span>C</span></div>',
	'<cfoutput><span>A</span><cfif flag><span>B</span></cfif><span>C</span></cfoutput>',
	'<cfif flag><cfinclude template="noop.cfm">A</cfif>',
	'<cfif flag><cfset value=1>A</cfif>',
	'<cfif flag>\nif (ready) {\nrun();\n}\n</cfif>',
	'<cfoutput><cfset x=1> A <cfset y=2> B </cfoutput>',
	'<cfoutput>\n<cfif ok>\nvalue\n</cfif>\n</cfoutput>\n',
	'<div><p style="display:inline">A</p><p style="display:inline">B</p></div>',
	'<table><tr><td>foo</td><td>bar</td></tr></table>',
	'<div><pre>A B\n  C\n\n D <b>x</b></pre><textarea>A B\n  C <b>x</b></textarea></div>',
	'<div title="left > right"> A\n  B <span>x</span> C </div>',
	'<div><input value="><"><span>ok</span></div>',
	'<cfoutput><div>#replace(value, "<span>", "x")#<span>A</span><span>B</span></div></cfoutput>',
	'<div><span>A</span><!-- note --><span>B</span></div>'
];

cases.forEach(function(source, index) {
	[[], ['--split-html-tag'], ['--no-deep-sql', '--no-deep-css', '--no-deep-js']]
		.forEach(function(flags) {
			var output = format(source, flags);
			assert.strictEqual(output, source, 'rendered text case ' + index + ' ' + flags.join(' '));
			assert.strictEqual(format(output, flags), output, 'idempotence case ' + index);
		});
});
console.log('PASS HTML whitespace: inline, block-display, CFML, pre and textarea cases');

var styled = '<style>div { white-space: pre; }</style><div>A\n  B<span>C</span></div>';
var styledOutput = format(styled);
assert.ok(styledOutput.indexOf('<div>A\n  B<span>C</span></div>') !== -1,
	'CSS whitespace mode preserves rendered text exactly');
assert.ok(styledOutput.indexOf('<style>\n') !== -1, 'embedded CSS still formats independently');
assert.strictEqual(format(styledOutput), styledOutput, 'mixed CSS and HTML is idempotent');

var crlf = '<div>\r\n  <pre>A\r\n  B</pre>\r\n</div>';
assert.strictEqual(format(crlf), crlf, 'CRLF preformatted text remains unchanged');
var mixed = '<div><span>A</span><span>B</span></div>\n'
	+ '<cfquery name="q">\nselect a,b from records\n</cfquery>';
var mixedOutput = format(mixed);
assert.ok(mixedOutput.indexOf('<div><span>A</span><span>B</span></div>') !== -1,
	'HTML text remains intact alongside deep SQL');
assert.ok(mixedOutput.indexOf('SELECT') !== -1 && mixedOutput.indexOf('FROM') !== -1,
	'deep SQL continues to format');
console.log('PASS HTML whitespace: CRLF and independent deep SQL');

var scripts = require('../tools/formatter-script-manifest');
var warnings = [];
var context = { console: { log: function() {}, warn: function(message) { warnings.push(message); } } };
vm.createContext(context);
vm.runInContext(scripts.map(function(file) {
	return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}).join('\n'), context);
var original = '<div><span>A</span><span>B</span></div>';
assert.strictEqual(context.preserveRenderedHTMLWhitespace(original, '<div><span>A</span></div>'), original,
	'changed tag structure falls back to the original document');
assert.strictEqual(context.preserveRenderedHTMLWhitespace(original, '<div><span>A</span><span>B</span>'), original,
	'missing closing tag falls back to the original document');
assert.ok(warnings.length > 0 && warnings.every(function(message) { return message.indexOf(original) === -1; }),
	'fallback reports a warning without logging source');
console.log('PASS HTML whitespace: inconsistent tag sequence safely falls back');
