'use strict';

var assert = require('assert');
var path = require('path');
var childProcess = require('child_process');
var fs = require('fs');
var vm = require('vm');
var root = path.join(__dirname, '..');
var cli = path.join(root, 'tools', 'beautify-file.js');

function format(source, flags) {
	var result = childProcess.spawnSync(process.execPath,
		[cli, '-', '--language', 'cfml', '--stdout'].concat(flags || []),
		{ input: source, encoding: 'utf8' });
	assert.strictEqual(result.status, 0, result.stderr);
	return result.stdout;
}

var input = [
	'<cfquery name="q">',
	'SELECT __CFTOKEN_0__, __cftoken_1__, __CFTOKEN_1_0__,',
	"'__CFTOKEN_0__',",
	'<cfqueryparam value="1" cfsqltype="cf_sql_integer">',
	'FROM records /* __CFTOKEN_1__ */',
	'</cfquery>'
].join('\n');

[['built-in', []], ['Pro SQL', ['--pro-sql']], ['deep SQL disabled', ['--no-deep-sql']]]
	.forEach(function(test) {
		var output = format(input, test[1]);
		assert.ok(/SELECT\s+__CFTOKEN_0__\s*,/.test(output), test[0] + ': first identifier preserved');
		assert.ok(output.indexOf('__cftoken_1__') !== -1, test[0] + ': mixed-case identifier preserved');
		assert.ok(output.indexOf('__CFTOKEN_1_0__') !== -1, test[0] + ': alternate identifier preserved');
		assert.ok(output.indexOf("'__CFTOKEN_0__'") !== -1, test[0] + ': SQL literal preserved');
		assert.ok(output.indexOf('/* __CFTOKEN_1__ */') !== -1, test[0] + ': SQL comment preserved');
		assert.strictEqual((output.match(/<cfqueryparam\b/gi) || []).length, 1,
			test[0] + ': CFML parameter appears exactly once');
		assert.strictEqual(format(output, test[1]), output, test[0] + ': output is idempotent');
		console.log('PASS SQL token safety: ' + test[0]);
	});

var structural = [
	'<cfquery name="q">',
	'SELECT',
	'  __cfm_0__,',
	'  <cfif enabled>',
	'    field_a,',
	'  </cfif>',
	'  field_b',
	'FROM records',
	'</cfquery>'
].join('\n');
var structuralOutput = format(structural, ['--pro-sql']);
assert.ok(structuralOutput.indexOf('__cfm_0__') !== -1, 'SQL structural marker-like identifier preserved');
assert.strictEqual((structuralOutput.match(/<cfif\b/gi) || []).length, 1, 'structural opening tag preserved');
assert.strictEqual((structuralOutput.match(/<\/cfif\s*>/gi) || []).length, 1, 'structural closing tag preserved');
assert.strictEqual(format(structuralOutput, ['--pro-sql']), structuralOutput, 'structural output is idempotent');
console.log('PASS SQL token safety: structural marker-like identifier');

var warnings = [];
var context = { console: { log: function() {}, warn: function() {
	warnings.push(Array.prototype.join.call(arguments, ' '));
} } };
vm.createContext(context);
vm.runInContext(require('../tools/formatter-script-manifest').map(function(file) {
	return fs.readFileSync(path.join(root, file), 'utf8');
}).join('\n'), context);
var original = "SELECT __CFTOKEN_0__, '__CFTOKEN_1__', <cfqueryparam value=\"1\">";
var protectedSql = context.protectCFMLTokens(original);
assert.strictEqual(context.restoreCFMLTokens(protectedSql.code, protectedSql.tokens), original,
	'protect/restore is collision-free and non-recursive');
var firstMarker = protectedSql.tokens.markerPrefix + '0__';
assert.throws(function() {
	context.restoreCFMLTokens(protectedSql.code.replace(firstMarker, ''), protectedSql.tokens);
}, /token/i, 'missing token must be rejected');
assert.throws(function() {
	context.restoreCFMLTokens(protectedSql.code + ' ' + firstMarker, protectedSql.tokens);
}, /token/i, 'duplicate token must be rejected');
console.log('PASS SQL token safety: direct token round trip');

var parameterWithGreaterThan = '<cfqueryparam value="left > right" cfsqltype="cf_sql_varchar">';
var protectedParameter = context.protectCFMLTokens(parameterWithGreaterThan);
assert.strictEqual(protectedParameter.tokens.length, 1, 'quoted greater-than must not split a CFML tag');
assert.strictEqual(context.restoreCFMLTokens(protectedParameter.code, protectedParameter.tokens), parameterWithGreaterThan);
console.log('PASS SQL token safety: quoted tag boundary');

var tokenCases = [
	"SELECT '__CFTOKEN_0__', \"__cftoken_1__\", #value#, ##",
	'SELECT __CFTOKEN_0__ -- __CFTOKEN_1__\n/* __CFTOKEN_2__ */ <cfqueryparam value="x">',
	'SELECT <!--- __CFTOKEN_0__ ---> <cfqueryparam\r\n value="left > right"\r\n cfsqltype="cf_sql_varchar">'
];
tokenCases.forEach(function(source) {
	var result = context.protectCFMLTokens(source);
	assert.strictEqual(context.restoreCFMLTokens(result.code, result.tokens), source,
		'comments, hashes, newlines and quoted attributes round-trip');
});
var multilineParameterInput = '<cfquery name="q">\nSELECT <cfqueryparam value="left > right" cfsqltype="cf_sql_varchar">\n</cfquery>';
[['built-in', []], ['Pro SQL', ['--pro-sql']]].forEach(function(test) {
	assert.ok(format(multilineParameterInput, test[1]).indexOf(parameterWithGreaterThan) !== -1,
		test[0] + ': quoted greater-than survives end-to-end');
});
console.log('PASS SQL token safety: comments, hashes, CRLF and tag boundaries');

var expression = "value eq '__CFEXPSTR_1__' and other eq '__CFEXPSTR_0__'";
var normalizedExpression = context.normalizeCFMLExpression(expression);
assert.ok(normalizedExpression.indexOf("'__CFEXPSTR_1__'") !== -1,
	'first expression string must not be replaced by a later marker');
assert.ok(normalizedExpression.indexOf("'__CFEXPSTR_0__'") !== -1,
	'second expression string must remain intact');
console.log('PASS SQL token safety: CFML expression strings');

var marked = context.protectStructuralCFMLAsColumnMarkers('<cfif flag>\na\n<cfelse>\nb\n</cfif>');
assert.strictEqual(context.restoreStructuralCFMLMarkers(
	'__cfm_0__,\na\n__cfm_1__,\nb\n__cfm_1__,\nc\n__cfm_2__,', marked.markers), null,
	'duplicate structural markers must be rejected');
assert.strictEqual(context.restoreStructuralCFMLMarkers('__cfm_0__,\na\n__cfm_2__,', marked.markers), null,
	'missing and out-of-order structural markers must be rejected');
assert.strictEqual(context.restoreStructuralCFMLMarkers(
	'__cfm_0__,\na __cfm_1__\n__cfm_1__,\nb\n__cfm_2__,', marked.markers), null,
	'extra inline structural markers must be rejected');
console.log('PASS SQL token safety: duplicate structural markers rejected');

context.isProSQLLoaded = function() { return true; };
context.formatProSQLSync = function() { throw new Error('SYNTHETIC_SOURCE_SHOULD_NOT_BE_LOGGED'); };
var fallbackOutput = context.deepFormatEmbedded(input, {
	sql: true, css: false, js: false, sqlPro: true
}, input);
assert.ok(/SELECT\s+__CFTOKEN_0__\s*,/.test(fallbackOutput), 'Pro failure preserves user identifier');
assert.strictEqual((fallbackOutput.match(/<cfqueryparam\b/gi) || []).length, 1,
	'Pro failure preserves one CFML parameter');
assert.ok(warnings.every(function(message) {
	return message.indexOf('SYNTHETIC_SOURCE_SHOULD_NOT_BE_LOGGED') === -1 &&
		message.indexOf('__CFTOKEN_0__') === -1;
}), 'fallback warnings must not include SQL source or parser message');
console.log('PASS SQL token safety: Pro failure falls back without leaking source');

warnings.length = 0;
var postFragment = context.formatPhase4PostFragment('order by customer_name', 'sql');
assert.ok(/ORDER BY\s+customer_name/i.test(postFragment), 'post-tree fallback keeps the SQL clause');
assert.ok(warnings.some(function(message) { return /Phase 4/.test(message); }),
	'post-tree failure must remain visible');
assert.ok(warnings.every(function(message) {
	return message.indexOf('SYNTHETIC_SOURCE_SHOULD_NOT_BE_LOGGED') === -1 &&
		message.indexOf('customer_name') === -1;
}), 'post-tree fallback must not log exception text or SQL');
console.log('PASS SQL token safety: post-tree fallback reports no source');

var lostTokenInput = '<cfquery name="q">\nSELECT <cfqueryparam value="7">\n</cfquery>';
context.formatProSQLSync = function() { return 'SELECT 1'; };
assert.strictEqual(context.deepFormatEmbedded(lostTokenInput, {
	sql: true, css: false, js: false, sqlPro: true
}, lostTokenInput), lostTokenInput, 'lost protected marker must preserve original document');
console.log('PASS SQL token safety: missing formatter token retains original');
