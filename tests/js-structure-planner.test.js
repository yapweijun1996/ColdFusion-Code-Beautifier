'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var context = {
	console: { log: function() {}, warn: function() {}, error: function() {} }
};
vm.createContext(context);
vm.runInContext([
	'vendor/acorn.js',
	'js/js-structure.js',
	'js/js-structure-planner.js'
].map(function(file) {
	return fs.readFileSync(path.join(ROOT, file), 'utf8');
}).join('\n'), context, { filename: 'js-structure-planner.vm.js' });

function plan(source, options) {
	return context.planJavaScriptIndentation(source, options);
}

function levels(source, options) {
	var result = plan(source, options);
	assert.ok(result, 'planner should support input');
	return Array.prototype.slice.call(result.indentLevels);
}

function apply(source, options) {
	var result = plan(source, options);
	assert.ok(result, 'planner should support input before apply');
	var output = context.applyJavaScriptIndentPlan(source, result);
	assert.ok(output !== null, 'indent plan should verify after application');
	return output;
}

function pass(name) {
	console.log('PASS planner: ' + name);
}

var nested = [
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
assert.deepStrictEqual(levels(nested), [0, 1, 2, 3, 4, 5, 4, 4, 5, 4, 3, 2, 2, 1, 0]);
pass('nested IIFE and callback owners use one visual level per block');

var sameLevel = 'function f() {\nif (ok) {\nrun();\n}\nafter();\n}';
assert.deepStrictEqual(levels(sameLevel), [0, 1, 2, 1, 1, 0]);
pass('same-level closers align with their owning block');

var multilineArgs = 'function f() {\ncall(\nfirst,\nsecond\n);\n}';
assert.deepStrictEqual(levels(multilineArgs), [0, 1, 2, 2, 1, 0]);
pass('multiline call arguments get a continuation level');

var expressionAlignment = 'function f() {\n\tvar value = first &&\n\t        second && third;\n\treturn value;\n}';
assert.strictEqual(apply(expressionAlignment), expressionAlignment);
var leadingOperator = 'function f() {\n\tvar value = first\n\t       + second\n\t       + third;\n\treturn value;\n}';
assert.strictEqual(apply(leadingOperator), leadingOperator);
pass('multiline binary and logical continuation alignment remains unchanged');

var containers = 'function f() {\nreturn [\n{\na: 1\n},\n{ b: 2 }\n];\n}';
assert.deepStrictEqual(levels(containers), [0, 1, 2, 3, 2, 2, 1, 0]);
pass('arrays and multiline object literals own their lines');

var computedMember = 'function f(){\nreturn obj[\nkey\n].m(\nx\n);\n}';
assert.deepStrictEqual(levels(computedMember), [0, 1, 2, 1, 2, 1, 0]);
var optionalMember = 'function f(){\nreturn obj?.[\nkey\n];\n}';
assert.deepStrictEqual(levels(optionalMember), [0, 1, 2, 1, 0]);
var computedProperty = 'var obj = {\n[\nkey\n]: value\n};';
assert.deepStrictEqual(levels(computedProperty), [0, 1, 2, 1, 0]);
pass('computed member and object keys retain bracket ownership');

var switchCode = 'function f() {\nswitch (x) {\ncase 1:\nrun();\nbreak;\ndefault:\nother();\n}\n}';
assert.deepStrictEqual(levels(switchCode), [0, 1, 2, 3, 3, 2, 3, 1, 0]);
pass('switch cases and consequents have separate levels');

var multilineCase = [
	'function f() {',
	'\tswitch (value) {',
	'\t\tcase fn(',
	'\t\t\targ',
	'\t\t):',
	'\t\t\twork();',
	'\t\t\tbreak;',
	'\t}',
	'}'
].join('\n');
var multilineCasePlan = plan(multilineCase);
assert.ok(multilineCasePlan);
assert.strictEqual(multilineCasePlan.lines[2].protected, true);
assert.strictEqual(multilineCasePlan.lines[3].protected, true);
assert.strictEqual(multilineCasePlan.lines[4].protected, true);
assert.strictEqual(apply(multilineCase), multilineCase);
pass('multiline switch case expressions remain source-aligned');

var controlContinuation = [
	'function evaluate() {',
	'\tif (',
	'\t\t\tfirst &&',
	'\t\t\tsecond',
	'\t\t\t) {',
	'\t\twhile (',
	'\t\t\tready &&',
	'\t\t\tstillReady',
	'\t\t\t) {',
	'\t\t\tfor (',
	'\t\t\t\tvar i = 0;',
	'\t\t\t\ti < 2;',
	'\t\t\t\ti++',
	'\t\t\t\t) {',
	'\t\t\t\twork(i);',
	'\t\t\t}',
	'\t\t}',
	'\t}',
	'\tswitch (',
	'\t\t\tvalue &&',
	'\t\t\tother',
	'\t\t\t) {',
	'\t\tcase 1:',
	'\t\t\tbreak;',
	'\t}',
	'}'
].join('\n');
var controlPlan = plan(controlContinuation);
assert.ok(controlPlan);
for (var controlLine = 1; controlLine <= 13; controlLine++) {
	assert.strictEqual(controlPlan.lines[controlLine].protected, true);
}
for (var switchLine = 18; switchLine <= 21; switchLine++) {
	assert.strictEqual(controlPlan.lines[switchLine].protected, true);
}
assert.strictEqual(apply(controlContinuation), controlContinuation);
assert.strictEqual(context.verifyJavaScriptTransformation(
	controlContinuation, apply(controlContinuation)).ok, true);
assert.strictEqual(plan('function evaluate() {\nif (\nvalue\n) {'), null);
assert.strictEqual(plan('function evaluate() {\nif (\nvalue +\n) {\nwork();\n}\n}'), null);
pass('multiline control conditions preserve exact continuation alignment and reject malformed input');

var doWhileContinuation = [
	'function repeat() {',
	'\tdo {',
	'\t\twork();',
	'\t} while (',
	'\t\t\tready &&',
	'\t\t\tagain',
	'\t\t\t);',
	'}'
].join('\n');
var doWhilePlan = plan(doWhileContinuation);
assert.ok(doWhilePlan);
for (var doWhileLine = 3; doWhileLine <= 6; doWhileLine++) {
	assert.strictEqual(doWhilePlan.lines[doWhileLine].protected, true);
}
assert.strictEqual(apply(doWhileContinuation), doWhileContinuation);
pass('multiline do-while conditions remain protected');

var multilineParameters = [
	'function parameters(',
	'\tfirst,',
	'\tsecond',
	') {',
	'\treturn first + second;',
	'}'
].join('\n');
var multilineParametersPlan = plan(multilineParameters);
assert.ok(multilineParametersPlan);
assert.strictEqual(multilineParametersPlan.lines[1].protected, true);
assert.strictEqual(multilineParametersPlan.lines[2].protected, true);
assert.strictEqual(multilineParametersPlan.lines[3].protected, true);
assert.strictEqual(apply(multilineParameters), multilineParameters);
pass('multiline function parameters remain source-aligned');

var protectedInput = 'function f() {\nvar text = "}";\n/* keep {\n comment */\nvar template = `line\n${value}`;\nreturn { text: text, template: template };\n}';
var protectedPlan = plan(protectedInput);
assert.ok(protectedPlan);
assert.strictEqual(protectedPlan.lines[3].protected, true);
assert.strictEqual(protectedPlan.lines[5].protected, true);
assert.strictEqual(context.verifyJavaScriptTransformation(protectedInput, apply(protectedInput)).ok, true);
pass('strings, templates and comments remain lexically opaque');

var nestedTemplate = 'var template = `outer ${`inner ${value}`} tail`;';
assert.ok(plan(nestedTemplate));
assert.strictEqual(context.verifyJavaScriptTransformation(nestedTemplate, apply(nestedTemplate)).ok, true);
pass('nested template literals remain one protected lexical range');

assert.strictEqual(plan('function broken( {'), null);
assert.strictEqual(plan('<cfif active>\nrun();\n</cfif>'), null);
assert.ok(plan('var html = "<cfif active>";'));
assert.strictEqual(plan('var relation = a < b;') !== null, true);
var stalePlan = plan('var value = 1;');
assert.strictEqual(context.applyJavaScriptIndentPlan('var other = 1;', stalePlan), null);
stalePlan.lines[0].indent = -1;
assert.strictEqual(context.applyJavaScriptIndentPlan('var value = 1;', stalePlan), null);
pass('illegal and CFML-like input safely returns null while strings stay valid');

var semanticInput = 'function f() {\nreturn call({\nvalue: next(\nsource\n)\n});\n}';
var semanticOutput = apply(semanticInput);
assert.strictEqual(context.verifyJavaScriptTransformation(semanticInput, semanticOutput).ok, true);
var semanticAgain = apply(semanticOutput);
assert.strictEqual(context.verifyJavaScriptTransformation(semanticOutput, semanticAgain).ok, true);
pass('parse-before/after verification preserves structure and tokens');

var largeLines = ['function largeRoot() {'];
for (var largeIndex = 0; largeIndex < 500; largeIndex++) {
	largeLines.push(
		'\tif (flag' + largeIndex + ' && value' + largeIndex + ') {',
		'\t\tcall' + largeIndex + '({ value: ' + largeIndex + ' });',
		'\t}'
	);
}
largeLines.push('}');
var largeSource = largeLines.join('\n');
while (Buffer.byteLength(largeSource, 'utf8') < 27 * 1024) {
	largeSource += '\nfunction padding() { return 1; }';
}
var benchmarkSource = largeSource;
var samplePath = path.join(ROOT, 'sample', 'inc_his_rcovr_erpform.cfm');
if (fs.existsSync(samplePath)) {
	var sampleMatch = fs.readFileSync(samplePath, 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/i);
	if (sampleMatch && Buffer.byteLength(sampleMatch[1], 'utf8') >= 27000) benchmarkSource = sampleMatch[1];
}
var largeStartedAt = Date.now();
var largePlan = plan(benchmarkSource);
var largeElapsed = Date.now() - largeStartedAt;
assert.ok(largePlan && Buffer.byteLength(benchmarkSource, 'utf8') >= 27000);
assert.ok(largeElapsed < 3000, '27KB planner should finish without quadratic blow-up: ' + largeElapsed + 'ms');
pass('27KB structure plan stays within bounded runtime (' + largeElapsed + 'ms)');

console.log('All JavaScript structure planner tests passed.');
