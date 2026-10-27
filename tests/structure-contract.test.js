'use strict';

/*
 * Long-lived JavaScript/CFML structure contract tests.
 *
 * This suite deliberately uses the same classic-script VM loading model as
 * tests/run-tests.js and tools/beautify-file.js. It does not import a second
 * formatter or infer expected output from the formatter under test. Each case
 * pins the route, the deep-format flags, the structural output, and the
 * preservation/fallback invariants that matter when the scanners evolve.
 */

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var SCRIPTS = require('../tools/formatter-script-manifest');

function makeHarness() {
	var elements = {
		language: { value: 'auto' },
		split_html_tag: { checked: false },
		auto_copy: { checked: false },
		auto_clear: { checked: false },
		auto_clear_output: { checked: false },
		deep_sql: { checked: false },
		deep_css: { checked: false },
		deep_js: { checked: false },
		preserve_continuation_alignment: { checked: true },
		normalize_indent: { checked: false },
		normalize_tab_width: { value: '0' },
		semantic_indent: { checked: false },
		pro_sql: { checked: false },
		pro_sql_dialect: { value: 'sql' },
		input: { value: '' },
		output: { value: '', select: function() {} }
	};

	var context = {
		console: { log: function() {}, warn: function() {}, error: function() {} },
		window: {},
		document: {
			getElementById: function(id) { return elements[id] || null; },
			execCommand: function() { return true; },
			querySelector: function() { return { prepend: function() {} }; },
			createElement: function() {
				return {
					className: '',
					innerHTML: '',
					classList: { add: function() {}, remove: function() {} },
					style: { setProperty: function() {} },
					addEventListener: function() {},
					removeEventListener: function() {}
				};
			},
			addEventListener: function() {},
			readyState: 'complete'
		},
		setTimeout: setTimeout,
		clearTimeout: clearTimeout,
		Promise: Promise
	};

	vm.createContext(context);
	vm.runInContext(SCRIPTS.map(function(file) {
		return fs.readFileSync(path.join(ROOT, file), 'utf8');
	}).join('\n'), context, { filename: 'structure-contract.vm.js' });

	return { context: context, elements: elements };
}

var harness = makeHarness();

(function structureVerificationContracts() {
	var verify = harness.context.verifyJavaScriptTransformation;
	assert.strictEqual(verify('function f(){return 1;}', 'function f() {\n\treturn 1;\n}').ok, true);
	assert.strictEqual(verify('function f(){return\n1;}', 'function f(){return 1;}').reason, 'structure-mismatch');
	assert.strictEqual(verify('let value = 1;', 'let value = 2;').reason, 'lexical-mismatch');
	assert.strictEqual(verify('let a = 1; /* note */ let b = 2;',
		'let a = 1; let b = 2; /* note */').reason, 'lexical-mismatch');
	assert.strictEqual(verify('function f(){', 'function f(){}').reason, 'input-parse-error');
	assert.strictEqual(verify('let x = 1;', 'let x = ;').reason, 'output-parse-error');
	assert.strictEqual(verify('export const x=1;', 'export const x = 1;').sourceType, 'module');
	assert.strictEqual(verify('const x = 100n;', 'const x=100n;').ok, true);
	assert.strictEqual(harness.context.verifyMixedJavaScriptTransformation(
		'<cfif ok>\nrun();\n<cfelse>\nother();\n</cfif>',
		'<cfif ok>\n\trun();\n<cfelse>\n\tother();\n</cfif>'), true);
	assert.strictEqual(harness.context.verifyMixedJavaScriptTransformation(
		'<cfif ok>\nrun();\n</cfif>', '<cfif ok>\nother();\n</cfif>'), false);
	assert.strictEqual(harness.context.verifyMixedJavaScriptTransformation(
		'<cfif ok>run();</cfif>', '<cfif disabled>run();</cfif>'), false);
	assert.strictEqual(harness.context.verifyMixedJavaScriptTransformation(
		'var marker = "__CFMLVALIDATION_0__";', 'var marker = "__CFMLVALIDATION_0__";'), true);
	assert.strictEqual(harness.context.verifyMixedJavaScriptTransformation(
		'<cfif ok>var marker = "__CFMLVALIDATION_0__";</cfif>',
		'<cfif ok>var marker = "__CFMLVALIDATION_0__";</cfif>'), false);
	assert.strictEqual(harness.context.verifyMixedJavaScriptTransformation(
		'<cfif x eq "a>b">\nrun("<cfif literal>");\n</cfif>',
		'<cfif x eq "a>b">\n\trun("<cfif literal>");\n</cfif>'), true);
	console.log('PASS structure: parser verification preserves syntax, tokens and comment anchors');
})();

function format(input, language, options) {
	var opts = options || {};
	var elements = harness.elements;
	elements.language.value = language || 'auto';
	elements.split_html_tag.checked = opts.splitHtmlTag === true;
	elements.auto_copy.checked = false;
	elements.auto_clear.checked = false;
	elements.auto_clear_output.checked = false;
	elements.deep_sql.checked = opts.deepSql === true;
	elements.deep_css.checked = opts.deepCss === true;
	elements.deep_js.checked = opts.deepJs === true;
	elements.preserve_continuation_alignment.checked = opts.preserveContinuation !== false;
	elements.normalize_indent.checked = false;
	elements.normalize_tab_width.value = '0';
	elements.semantic_indent.checked = false;
	elements.pro_sql.checked = false;
	elements.pro_sql_dialect.value = 'sql';
	elements.input.value = input;
	elements.output.value = '';

	var result = harness.context.beautifyCodes();
	assert.ok(result && typeof result.then === 'function', 'beautifyCodes must return a Promise');
	return elements.output.value;
}

function pass(name) {
	console.log('PASS structure: ' + name);
}

function equal(name, actual, expected) {
	assert.strictEqual(actual, expected, name + '\nActual:\n' + actual.replace(/\t/g, '->') +
		'\nExpected:\n' + expected.replace(/\t/g, '->'));
	pass(name);
}

function normalizeContent(value) {
	return String(value).replace(/\s+/g, '');
}

function preserveContent(name, input, output) {
	assert.strictEqual(normalizeContent(output), normalizeContent(input), name);
	pass(name);
}

function assertIdempotent(name, input, language, options) {
	var first = format(input, language, options);
	var second = format(first, language, options);
	equal(name, second, first);
}

function assertNoRawLineBreakInQuotedStrings(name, code) {
	var quote = null;
	var escaped = false;
	var hits = 0;
	for (var i = 0; i < code.length; i++) {
		var c = code[i];
		if (quote === '`') {
			if (escaped) {
				escaped = false;
			} else if (c === '\\') {
				escaped = true;
			} else if (c === '`') {
				quote = null;
			}
			continue;
		}
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (c === '\\') {
				escaped = true;
			} else if (c === quote) {
				quote = null;
			} else if (c === '\n' || c === '\r') {
				hits++;
				quote = null;
			}
			continue;
		}
		if (c === '`' || c === '"' || c === "'") {
			quote = c;
		}
	}
	assert.strictEqual(hits, 0, name + ': raw newline found inside a single/double quoted string');
	pass(name);
}

function assertNoInternalSentinels(name, code) {
	assert.doesNotMatch(code, /__BRACE(?:TOKEN|PAREN)_\d+__/, name);
	pass(name);
}

(function testVerifiedFormatterFallback() {
	var original = 'function f(){return 1;}';
	var formatter = harness.context.formatBraceCode;
	try {
		harness.context.formatBraceCode = function() { return 'function f(){return 2;}'; };
		equal('bare JS rejects a changed syntax tree', format(original, 'js'), original);
	} finally {
		harness.context.formatBraceCode = formatter;
	}
	var broken = 'function f() {\n  if (ready) {';
	equal('unparseable bare JS remains unchanged', format(broken, 'js'), broken);
	[
		'__BRACETOKEN_0__', '__BRACEPAREN_0__', '__BRACECODE_EMPTY_OBJ__', '__BRACECODE_EMPTY_ARR__'
	].forEach(function(marker) {
		var input = 'function f(){var s="hi";var x=' + marker + ';return x;}';
		var output = format(input, 'js');
		assert.strictEqual(harness.context.verifyJavaScriptTransformation(input, output).ok, true,
			'user identifier must never be substituted: ' + marker);
	});
	pass('user identifiers cannot be replaced by formatter sentinels');
	var parser = harness.context.acorn;
	try {
		harness.context.acorn = undefined;
		equal('bare JS remains unchanged when parser is unavailable', format(original, 'js'), original);
	} finally {
		harness.context.acorn = parser;
	}
	var embedded = '<script>\nfunction f(){return 1;}\n</script>';
	var embeddedFormatter = harness.context.formatBraceCodeWithCFML;
	try {
		harness.context.formatBraceCodeWithCFML = function() { return 'function f(){return 2;}'; };
		equal('embedded JS rejects changed syntax and restores original body',
			format(embedded, 'cfml', { deepJs: true }), embedded);
	} finally {
		harness.context.formatBraceCodeWithCFML = embeddedFormatter;
	}
	var mixed = '<script>\n<cfif ok>\nrun();\n</cfif>\n</script>';
	try {
		harness.context.formatBraceCodeWithCFML = function() { return '<cfif ok>\nother();\n</cfif>'; };
		equal('mixed CFML/JS rejects changed JavaScript and restores original body',
			format(mixed, 'cfml', { deepJs: true }), mixed);
	} finally {
		harness.context.formatBraceCodeWithCFML = embeddedFormatter;
	}
	var multilineTag = '<cfquery name="q">\nselect a,b from t\n</cfquery>\n' +
		'<script\n type="text/javascript">\nfunction f(){return 1;}\n</script>';
	var formatted = format(multilineTag, 'cfml', { deepJs: true, deepSql: true });
	assert.ok(/SELECT\b/.test(formatted), 'multiline script tag must not discard SQL formatting');
	assert.ok(/function f\(\)\{\n\s+return 1;/.test(formatted), 'multiline script body must still format');
	pass('multiline script tag preserves independent SQL and JS formatting');
	var quotedTag = '<script data-value="a>b">\nfunction f(){return 1;}\n</script>';
	assert.ok(/function f\(\)\{\n\s+return 1;/.test(format(quotedTag, 'cfml', { deepJs: true })),
		'quoted greater-than in a script attribute must not truncate the opening tag');
	pass('script attribute containing greater-than remains a complete region');
	var escapedClose = '<script>\nvar value = "a\\\" </script> still";\nfunction f(){return 1;}\n</script>';
	var escapedOutput = format(escapedClose, 'cfml', { deepJs: true });
	assert.ok(escapedOutput.indexOf('"a\\\" </script> still"') !== -1, 'escaped JS string remains intact');
	assert.ok(/function f\(\)\{\n\s+return 1;/.test(escapedOutput), 'real closing tag follows the JS string');
	pass('escaped quote does not expose a closing tag inside a JS string');
	var severalScripts = '<script>\nfunction good(){return 1;}\n</script>\n' +
		'<script>\nfunction broken(){\n</script>';
	var severalOutput = format(severalScripts, 'cfml', { deepJs: true });
	assert.ok(/function good\(\)\{\n\s+return 1;/.test(severalOutput), 'valid script still formats');
	assert.ok(severalOutput.indexOf('<script>\nfunction broken(){\n</script>') !== -1,
		'invalid sibling script must retain its original body');
	pass('independent script regions keep valid formatting and unsafe fallback');
	var decrementScript = '<script>var n=2;n--;</script>\n<script>\nfunction f(){return 1;}\n</script>';
	var decrementOutput = format(decrementScript, 'cfml', { deepJs: true });
	assert.ok(/function f\(\)\{\n\s+return 1;/.test(decrementOutput),
		'JavaScript decrement must not hide the next script region');
	pass('postfix decrement does not become a SQL line comment');
})();

/* -------------------------------------------------------------------------
 * A. Bare JavaScript structure: brace owners, IIFEs, callbacks and calls.
 * ------------------------------------------------------------------------- */

var numericDivisionIife = [
	'(function() {',
	'function finish() {',
	'var percentage = Math.round(restored * 10000 / fields.length) / 100;',
	'var result = {',
	'value: percentage',
	'};',
	'}',
	'function pass() {',
	'run();',
	'}',
	'})();'
].join('\n');
var numericDivisionIifeExpected = [
	'(function() {',
	'\tfunction finish() {',
	'\t\tvar percentage = Math.round(restored * 10000 / fields.length) / 100;',
	'\t\tvar result = {',
	'\t\t\tvalue: percentage',
	'\t\t};',
	'\t}',
	'\tfunction pass() {',
	'\t\trun();',
	'\t}',
	'})();'
].join('\n');
equal('bare JS numeric division keeps IIFE and sibling function levels',
	format(numericDivisionIife, 'js'), numericDivisionIifeExpected);
assertIdempotent('bare JS numeric division is idempotent', numericDivisionIife, 'js');

var nestedCallbackIife = [
	'(function() {',
	'function boot() {',
	'for (var i = 0; i < forms.length; i++) {',
	'(function(form) {',
	'form.addEventListener("change", function() {',
	'update();',
	'}, true);',
	'var state = {',
	'ready: true',
	'};',
	'})(forms[i]);',
	'}',
	'after();',
	'}',
	'})();'
].join('\n');
var nestedCallbackIifeExpected = [
	'(function() {',
	'\tfunction boot() {',
	'\t\tfor (var i = 0; i < forms.length; i++) {',
	'\t\t\t(function(form) {',
	'\t\t\t\tform.addEventListener("change", function() {',
	'\t\t\t\t\tupdate();',
	'\t\t\t\t}, true);',
	'\t\t\t\tvar state = {',
	'\t\t\t\t\tready: true',
	'\t\t\t\t};',
	'\t\t\t})(forms[i]);',
	'\t\t}',
	'\t\tafter();',
	'\t}',
	'})();'
].join('\n');
equal('bare JS nested IIFE and callback use one tab per block',
	format(nestedCallbackIife, 'js'), nestedCallbackIifeExpected);

var multilineCall = [
	'(function() {',
	'call(',
	'function() {',
	'work();',
	'}',
	');',
	'})();'
].join('\n');
equal('multiline call containing a callback keeps call and callback levels',
	format(multilineCall, 'js'), [
	'(function() {',
	'\tcall(',
	'\t\tfunction() {',
	'\t\t\twork();',
	'\t\t}',
	'\t);',
	'})();'
].join('\n'));

equal('AST planner indents an object passed on the next argument line',
	format('function f(){\nvar result = foo(\n{\nx: 1,\ny: 2\n},\nother\n);\n}', 'js'),
	'function f(){\n\tvar result = foo(\n\t\t{\n\t\t\tx: 1,\n\t\t\ty: 2\n\t\t},\n\t\tother\n\t);\n}');

equal('AST planner keeps computed member brackets aligned',
	format('function f(){\nreturn obj[\nkey\n].m(\nx\n);\n}', 'js'),
	'function f(){\n\treturn obj[\n\t\tkey\n\t].m(\n\t\tx\n\t);\n}');

equal('ternary continuation retains nested call and computed member structure',
	format('function f(){\nreturn condition\n? foo(\nobj[\nkey\n]\n)\n: bar;\n}', 'js'),
	'function f(){\n\treturn condition\n\t? foo(\n\t\tobj[\n\t\t\tkey\n\t\t]\n\t)\n\t: bar;\n}');

equal('expression continuation inside a call respects the outer call level',
	format('function f(){\nreturn outer(\na +\nfoo(\nx\n)\n);\n}', 'js'),
	'function f(){\n\treturn outer(\n\t\ta +\n\t\tfoo(\n\t\t\tx\n\t\t)\n\t);\n}');

equal('multiline assignment owns its right-hand expression',
	format('const x =\na +\nfoo(\nobj[\nkey\n]\n);', 'js'),
	'const x =\n\ta +\n\tfoo(\n\t\tobj[\n\t\t\tkey\n\t\t]\n\t);');

equal('concise arrow body on a new line is indented',
	format('const f = (x) =>\nfoo(x);', 'js'),
	'const f = (x) =>\n\tfoo(x);');

equal('concise arrow body composes with its enclosing call',
	format('const list=items.map(item =>\nfoo(\nitem\n)\n);', 'js'),
	'const list=items.map(item =>\n\tfoo(\n\t\titem\n\t)\n);');
assertIdempotent('assignment and arrow continuation remain stable',
	'const f = (x) =>\nfoo(\nx\n);\nconst y =\nbar(\nf\n);', 'js');
assertIdempotent('nested expression continuation is idempotent',
	'function f(){\nreturn outer(\na +\nfoo(\nx\n)\n);\n}', 'js');

equal('leading operator alignment cannot escape its enclosing call',
	format('function f(){\nreturn outer(\na\n  + foo(\nx\n)\n);\n}', 'js'),
	'function f(){\n\treturn outer(\n\t\ta\n\t\t  + foo(\n\t\t\tx\n\t\t)\n\t);\n}');
assertIdempotent('nested leading operator alignment is idempotent',
	'function f(){\nreturn outer(\na\n  + foo(\nx\n)\n);\n}', 'js');

var alignedCall = 'function f(){\nreturn outer(\na\n       + b\n);\n}';
equal('continuation option preserves extra alignment inside a call',
	format(alignedCall, 'js', { preserveContinuation: true }),
	'function f(){\n\treturn outer(\n\t\ta\n\t\t       + b\n\t);\n}');
equal('disabled continuation option uses structural indentation only',
	format(alignedCall, 'js', { preserveContinuation: false }),
	'function f(){\n\treturn outer(\n\t\ta\n\t\t+ b\n\t);\n}');

equal('index and inline object arguments do not add a phantom block',
	format([
		'(function() {',
		'call(items[index], {ready: true},',
		'next);',
		'})();'
	].join('\n'), 'js'), [
		'(function() {',
		'\tcall(items[index], {ready: true},',
		'\t\tnext);',
		'})();'
	].join('\n'));

equal('nested array/object literals close at their owning level',
	format([
		'function f() {',
		'return [',
		'{ a: 1, args: {} },',
		'{ a: 2, b: 3,',
		'  args: { x: 1, y: 2 } },',
		'{ a: 4, args: { nested: { z: 9 } } }',
		'];',
		'}'
	].join('\n'), 'cfml', { deepSql: false, deepCss: false, deepJs: false }), [
		'function f() {',
		'\treturn [',
		'\t\t{ a: 1, args: {} },',
		'\t\t{ a: 2, b: 3,',
		'\t\t  args: { x: 1, y: 2 } },',
		'\t\t{ a: 4, args: { nested: { z: 9 } } }',
		'\t];',
		'}'
	].join('\n'));

/* -------------------------------------------------------------------------
 * B. Lexical protection: division, regex, strings, templates and comments.
 * ------------------------------------------------------------------------- */

equal('regex after return remains a single token',
	format([
		'function check(s) {',
		'return /\\b(total|amount)\\b[^.\\n]{0,80}\\b(all|overall)\\b/.test(s);',
		'}'
	].join('\n'), 'js'), [
		'function check(s) {',
		'\treturn /\\b(total|amount)\\b[^.\\n]{0,80}\\b(all|overall)\\b/.test(s);',
		'}'
	].join('\n'));

equal('regex character class slash is not a close delimiter',
	format('var pat = /[\/\'\\"]+/g;\nvar html = \'<div>x</div>\';', 'js'),
		'var pat = /[\/\'\\"]+/g;\nvar html = \'<div>x</div>\';');

equal('template interpolation and nested template remain opaque',
	format([
		'(function() {',
		'const html = `<div>${items.map(c => `<span>${c}</span>`).join("")}</div>`;',
		'if (ready) {',
		'use(html);',
		'}',
		'})();'
	].join('\n'), 'js'), [
		'(function() {',
		'\tconst html = `<div>${items.map(c => `<span>${c}</span>`).join("")}</div>`;',
		'\tif (ready) {',
		'\t\tuse(html);',
		'\t}',
	'})();'
	].join('\n'));

var embeddedStringInput = [
	'<script>',
	'function render() {',
	'var html = \'<div onclick="open(\\\'x\\\')">\' + name + \'</div>\';',
	'return html;',
	'}',
	'</script>'
].join('\n');
var embeddedStringOutput = format(embeddedStringInput, 'cfml', {
	deepSql: false, deepCss: false, deepJs: true
});
equal('embedded JS strings with HTML and escaped quotes stay intact', embeddedStringOutput, [
	'<script>',
	'\tfunction render() {',
	'\t\tvar html = \'<div onclick="open(\\\'x\\\')">\' + name + \'</div>\';',
	'\t\treturn html;',
	'\t}',
	'</script>'
].join('\n'));
assertNoRawLineBreakInQuotedStrings('embedded JS strings have no raw line break', embeddedStringOutput);
preserveContent('embedded JS string content is preserved', embeddedStringInput, embeddedStringOutput);

/* -------------------------------------------------------------------------
 * C. CFML/HTML structure around and inside JavaScript regions.
 * ------------------------------------------------------------------------- */

var embeddedNestedInput = '<script>\n' + nestedCallbackIife + '\n</script>';
var embeddedNestedExpected = '<script>\n' + nestedCallbackIifeExpected.split('\n').map(function(line) {
	return '\t' + line;
}).join('\n') + '\n</script>';
equal('embedded nested IIFE/callback uses the CFML script body level',
	format(embeddedNestedInput, 'cfml', { deepSql: false, deepCss: false, deepJs: true }),
	embeddedNestedExpected);
assertIdempotent('embedded nested IIFE/callback is idempotent',
	embeddedNestedInput, 'cfml', { deepSql: false, deepCss: false, deepJs: true });
preserveContent('embedded nested IIFE/callback preserves tokens',
	embeddedNestedInput, format(embeddedNestedInput, 'cfml', { deepSql: false, deepCss: false, deepJs: true }));

equal('CFML outer branch contains a correctly nested script',
	format([
		'<cfif enabled>',
		'<script>',
		'(function () {',
		'if (ready) {',
		'run();',
		'}',
		'})();',
		'</script>',
		'</cfif>'
	].join('\n'), 'cfml', { deepSql: false, deepCss: false, deepJs: true }), [
		'<cfif enabled>',
		'\t<script>',
		'\t\t(function () {',
		'\t\t\tif (ready) {',
		'\t\t\t\trun();',
		'\t\t\t}',
		'\t\t})();',
		'\t</script>',
	'</cfif>'
	].join('\n'));

equal('own-line CFML branches inside script keep CFML depth separate from JS braces',
	format([
		'<script>',
		'if (ready) {',
		'<cfif enabled>',
		'run();',
		'<cfelse>',
		'fallback();',
		'</cfif>',
		'}',
		'</script>'
	].join('\n'), 'cfml', { deepSql: false, deepCss: false, deepJs: true }), [
		'<script>',
		'\tif (ready) {',
		'\t\t<cfif enabled>',
		'\t\t\trun();',
		'\t\t<cfelse>',
		'\t\t\tfallback();',
		'\t\t</cfif>',
		'\t}',
		'</script>'
	].join('\n'));

equal('commented script markup stays opaque to CFML and JS scanners',
	format([
		'<cfif active>',
		'<!--- commented <script>if (x) { bad(); }</script> --->',
		'<script>',
		'if (ready) {',
		'run();',
		'}',
		'</script>',
		'</cfif>'
	].join('\n'), 'cfml', { deepSql: false, deepCss: false, deepJs: true }), [
		'<cfif active>',
		'\t<!--- commented <script>if (x) { bad(); }</script> --->',
		'\t<script>',
		'\t\tif (ready) {',
		'\t\t\trun();',
		'\t\t}',
		'\t</script>',
	'</cfif>'
	].join('\n'));

equal('cfscript braces remain under CFML structure',
	format([
		'<cfif active>',
		'<cfscript>',
		'if (ready) {',
		'run();',
		'}',
		'</cfscript>',
		'</cfif>'
	].join('\n'), 'cfml', { deepSql: false, deepCss: false, deepJs: true }), [
		'<cfif active>',
		'\t<cfscript>',
		'\t\tif (ready) {',
		'\t\t\trun();',
		'\t\t}',
		'\t</cfscript>',
	'</cfif>'
	].join('\n'));

/* -------------------------------------------------------------------------
 * D. Continuation alignment is an overlay, not a block level.
 * ------------------------------------------------------------------------- */

var continuationInput = [
	'<script>',
	'function render() {',
	'var rows = Array.isArray(raw.data)    ? raw.data',
	'         : Array.isArray(raw.rows)    ? raw.rows',
	'         : null;',
	'}',
	'</script>'
].join('\n');
equal('preserve alignment keeps legal ternary continuation columns',
	format(continuationInput, 'cfml', {
		deepSql: false, deepCss: false, deepJs: false, preserveContinuation: true
	}), [
	'<script>',
	'\tfunction render() {',
	'\t\tvar rows = Array.isArray(raw.data)    ? raw.data',
	'\t\t         : Array.isArray(raw.rows)    ? raw.rows',
	'\t\t         : null;',
	'\t}',
	'</script>'
	].join('\n'));
equal('disabled alignment falls back to canonical joiner indentation',
	format(continuationInput, 'cfml', {
		deepSql: false, deepCss: false, deepJs: false, preserveContinuation: false
	}), [
	'<script>',
	'\tfunction render() {',
	'\t\tvar rows = Array.isArray(raw.data)    ? raw.data',
	'\t\t: Array.isArray(raw.rows)    ? raw.rows',
	'\t\t: null;',
	'\t}',
	'</script>'
	].join('\n'));

/* -------------------------------------------------------------------------
 * E. Failure boundaries: retain source content and avoid sentinels.
 * ------------------------------------------------------------------------- */

var malformedCases = [
	['unclosed JS braces', '<script>\nfunction broken() {\nif (x) {\nrun();\n</script>'],
	['unclosed IIFE callback', '<script>\n(function () {\nform.addEventListener("change", function () {\nstate = true;\n</script>'],
	['unterminated quoted string', '<script>\nfunction broken() {\nvar x = "unterminated\nrun();\n}\n</script>']
];
malformedCases.forEach(function(pair) {
	var output = format(pair[1], 'cfml', { deepSql: false, deepCss: false, deepJs: true });
	preserveContent(pair[0] + ' preserves source tokens', pair[1], output);
	assertNoInternalSentinels(pair[0] + ' leaves no internal token markers', output);
	assertIdempotent(pair[0] + ' is stable under repeated formatting', pair[1], 'cfml', {
		deepSql: false, deepCss: false, deepJs: true
	});
});

/* -------------------------------------------------------------------------
 * F. Auto route contract: comments are opaque, real tags are authoritative.
 * ------------------------------------------------------------------------- */

assert.strictEqual(harness.context.detectLanguage('function f() { return 1; }'), 'js');
pass('auto route recognizes tag-free JavaScript');
assert.strictEqual(harness.context.detectLanguage('<!--- banner --->\nfunction f() { return 1; }'), 'js');
pass('auto route ignores a leading CFML comment banner');
assert.strictEqual(harness.context.detectLanguage("var html = '<div>x</div>';"), 'js');
pass('auto route ignores HTML-looking text inside JS strings');
assert.strictEqual(harness.context.detectLanguage('<cfif x>run()</cfif>'), 'cfml');
pass('auto route treats real CFML tags as authoritative');

console.log('All structure contract tests passed.');
