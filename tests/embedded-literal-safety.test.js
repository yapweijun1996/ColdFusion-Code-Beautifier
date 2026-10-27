'use strict';

var assert = require('assert');
var path = require('path');
var vm = require('vm');
var spawnSync = require('child_process').spawnSync;
var cli = path.join(__dirname, '..', 'tools', 'beautify-file.js');

function format(source, flags) {
	var result = spawnSync(process.execPath, [cli, '-', '--language', 'cfml', '--stdout'].concat(flags || []), {
		input: source, encoding: 'utf8'
	});
	assert.strictEqual(result.status, 0, result.stderr);
	return result.stdout;
}

function executeScripts(source) {
	var result = [];
	var match;
	var scripts = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
	while ((match = scripts.exec(source))) {
		var sandbox = { capture: function(value) { result.push(value); } };
		vm.runInNewContext(match[1], sandbox);
	}
	return result;
}

var js = [
	'<script>',
	'const r = /"/;',
	'const s = `a',
	' b`;',
	'capture(s);',
	'</script>',
	'<script>',
	'if (true) /["\']/ .test("x");',
	'capture("second");',
	'</script>'
].join('\n');
var formattedJs = format(js);
assert.deepStrictEqual(executeScripts(formattedJs), executeScripts(js), 'regex quotes cannot hide either script from validation');
assert.deepStrictEqual(executeScripts(formattedJs), ['a\n b', 'second'], 'actual runtime string values survive');

var precedingRawText = [
	'<script>',
	'const r = /"/;',
	'const value = `a',
	' b`;',
	'capture(value);',
	'capture("<cfquery name=\\"fake\\">select 9</cfquery>");',
	'</script>',
	'<style>.x{content:"<cfquery name=\'cssfake\'>select 8</cfquery>";color:red;}</style>',
	'<style id="normal">.y{color:red;}</style>',
	'<!-- <cfquery name="commentfake">select 7</cfquery> -->',
	'<cfquery name="real">',
	'select 1e-3, @x, $1 from t',
	'</cfquery>'
].join('\n');
var rawTextOutput = format(precedingRawText);
assert.deepStrictEqual(executeScripts(rawTextOutput), ['a\n b', '<cfquery name="fake">select 9</cfquery>'],
	'preceding script values and fake tags remain intact');
assert.ok(rawTextOutput.includes('<cfquery name=\'cssfake\'>select 8</cfquery>'),
	'query-looking CSS string is not formatted');
assert.ok(rawTextOutput.includes('<cfquery name="commentfake">select 7</cfquery>'),
	'query-looking markup comment is not formatted');
var realQuery = rawTextOutput.match(/<cfquery name="real">([\s\S]*?)<\/cfquery>/i);
assert.ok(realQuery, 'real query following raw text is found');
assert.match(realQuery[1], /\bSELECT\b/, 'real query receives SQL formatting');
assert.match(realQuery[1], /1e-3/i, 'scientific numeric token is preserved');
assert.match(realQuery[1], /@x\b/, 'named SQL parameter is preserved');
assert.match(realQuery[1], /\$1\b/, 'positional SQL parameter is preserved');
assert.match(rawTextOutput, /<style id="normal">\s*\n[\s\S]*?color\s*:\s*red/i,
	'style following the regex is formatted');

var sql = [
	'<cfquery name="q">',
	"select 'a </cfif>', 'a",
	"  b', '__CFTOKEN_0__'",
	'/* keep </cfif>',
	'  exact */',
	'from records',
	'</cfquery>',
	'<cfquery name="normal">select id from records</cfquery>'
].join('\n');
[[], ['--pro-sql']].forEach(function(flags) {
	var output = format(sql, flags);
	assert.ok(output.includes("'a </cfif>'"), 'tag-like SQL literal retains whitespace');
	assert.ok(output.includes("'a\n  b'"), 'multiline SQL value retains exact characters');
	assert.ok(output.includes('/* keep </cfif>\n  exact */'), 'multiline SQL comment retains exact characters');
	assert.ok(output.includes("'__CFTOKEN_0__'"), 'marker-like data is preserved');
	assert.match(output, /<cfquery name="normal">\s*SELECT\s+id\s+FROM\s+records/i, 'unaffected query still formats');
});

var ordinary = '<script>function f(){return 1;} capture(f());</script>';
var ordinaryOutput = format(ordinary);

var mixed = '<script>\n<cfif enabled>\nconst x = 2;\ncapture(x);\n</cfif>\n</script>';
var mixedOutput = format(mixed);
assert.match(mixedOutput, /<cfif enabled>/i, 'mixed CFML opening tag survives');
assert.match(mixedOutput, /<\/cfif>/i, 'mixed CFML closing tag survives');
assert.deepStrictEqual(executeScripts(mixedOutput.replace(/<\/?cfif[^>]*>/gi, '')), [2],
	'mixed script remains executable when the CFML branch is enabled');

var style = '<style>.x{content:\"} __BRACETOKEN_0__\";color:red;}</style>';
var styleOutput = format(style);
assert.ok(styleOutput.includes('\"} __BRACETOKEN_0__\"'), 'CSS literal and marker-like text survive');
assert.deepStrictEqual(executeScripts(ordinaryOutput), [1], 'ordinary embedded JS remains executable');
assert.notStrictEqual(ordinaryOutput, ordinary, 'ordinary embedded JS is still formatted');
console.log('PASS embedded literal safety');
