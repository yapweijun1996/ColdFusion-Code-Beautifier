'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
const scripts = require('../tools/formatter-script-manifest');
const context = { console: { log() {}, warn() {} } };
vm.createContext(context);
vm.runInContext(scripts.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'), context);

function cli(input, flags = []) {
	const result = spawnSync(process.execPath, [path.join(root, 'tools/beautify-file.js'), '-', '--stdout', '--language', 'cfml', '--no-deep-js', '--no-deep-css', '--no-deep-sql', ...flags], { input, encoding: 'utf8' });
	assert.strictEqual(result.status, 0, result.stderr);
	return result.stdout;
}
function scriptValue(source) {
	const body = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)[1];
	return vm.runInNewContext(body + '\nvalue');
}

const cfLiteral = '<cfset x = "a  \n  b  \n">';
for (const flags of [[], ['--split-html-tag'], ['--normalize-indent', '--indent-width', '4']]) {
	assert.ok(cli(cfLiteral, flags).includes('"a  \n  b  \n"'), 'CFML multiline literal ' + flags);
}
const quotedComparison = '<cfset q = dbgQuery(\n"SELECT * FROM t WHERE a >= 1\nORDER BY b", _dsn)>\n<cfset n = 1>';
const quotedOutput = cli(quotedComparison);
assert.ok(quotedOutput.includes('"SELECT * FROM t WHERE a >= 1\nORDER BY b"'), 'SQL string value remains intact across an embedded greater-than');
assert.ok(quotedOutput.endsWith('\n<cfset n = 1>'), 'a subsequent CFML sibling returns to the outer level');
assert.strictEqual(cli(quotedOutput), quotedOutput, 'multiline CFML string formatting is idempotent');
const cfscript = '<cfscript>\nmessage = "first  \n    significant indentation  \nlast";\n</cfscript>';
assert.ok(cli(cfscript).includes('"first  \n    significant indentation  \nlast"'));
for (const body of [
	'const value = `a\n    b  \n`;',
	'const value = "a\\\n    b";',
	'const value = `a ${`nested\n  b`}\n c`;',
	'const value = `\n<div>\n\t<cfif flag>\n\t\tvalue\n\t</cfif>\n</div>\n`;',
	'const value = `a<\\/script>b\n  c`;',
	'const r = /"/;\nconst value = `a\n b`;'
]) {
	const input = '<script>\n' + body + '\n</script>';
	for (const flags of [[], ['--split-html-tag']]) {
		const output = cli(input, flags);
		assert.strictEqual(scriptValue(output), scriptValue(input), 'JS runtime value ' + flags);
		if (body.indexOf('`') !== -1) {
			const literal = body.slice(body.indexOf('`'), body.lastIndexOf('`') + 1);
			assert.ok(output.includes(literal), 'multiline template source remains exact ' + flags);
		}
		assert.strictEqual(cli(output, flags), output, 'JS literal formatting is idempotent ' + flags);
	}
}
const embeddedTemplate = '<script>\nconst value = `\n<div>\n\t<cfif flag>\n\t\tvalue\n\t</cfif>\n</div>\n`;\n</script>';
for (const flags of [[], ['--split-html-tag']]) {
	function formatWithDeepJs(source) {
		const result = spawnSync(process.execPath, [path.join(root, 'tools/beautify-file.js'), '-', '--stdout', '--language', 'cfml', ...flags], { input: source, encoding: 'utf8' });
		assert.strictEqual(result.status, 0, result.stderr);
		return result.stdout;
	}
	for (const source of [embeddedTemplate, '<script>\nconst value = `a<\\/script>b\n  c`;\n</script>']) {
		const output = formatWithDeepJs(source);
		assert.strictEqual(scriptValue(output), scriptValue(source), 'deep JS preserves the template value');
		assert.ok(output.includes(source.slice(source.indexOf('`'), source.lastIndexOf('`') + 1)), 'deep JS preserves template source');
		assert.strictEqual(formatWithDeepJs(output), output, 'deep JS template formatting is idempotent');
	}
}
const splitter = context.splitRealTagBoundaries;
assert.strictEqual(splitter('<cfset x = "><"><cfset y = 1>'), '<cfset x = "><">\n<cfset y = 1>');
assert.strictEqual(splitter('<script>const x = "><";</script><cfset y=1>'), '<script>const x = "><";</script>\n<cfset y=1>');
assert.strictEqual(splitter('<!-- >< --><cfset x="><">'), '<!-- >< --><cfset x="><">');
assert.strictEqual(splitter('<textarea><a></a><b></b></textarea>'), '<textarea><a></a><b></b></textarea>');
const scriptCloseInString = '<script>const s = "</script><div>"; const y=1;</script><div>x</div>';
assert.strictEqual(splitter(scriptCloseInString), '<script>const s = "</script><div>"; const y=1;</script>\n<div>x</div>', 'script close-like text inside a string remains intact');
assert.ok(cli(scriptCloseInString, ['--split-html-tag']).includes('"</script><div>"'), 'tag splitting preserves script string bytes');
const escapedCss = '<div>\n<style>\n.a{background:url(foo\\\nbar.png);}\n</style>\n</div>';
for (const cssInput of [escapedCss, '<style>\n.a{background:url(foo\\\nbar.png);}\n</style>']) {
	for (const flags of [[], ['--no-deep-css'], ['--no-deep-css', '--no-deep-js', '--no-deep-sql']]) {
		const cssResult = spawnSync(process.execPath, [path.join(root, 'tools/beautify-file.js'), '-', '--stdout', '--language', 'cfml', ...flags], { input: cssInput, encoding: 'utf8' });
		assert.strictEqual(cssResult.status, 0, cssResult.stderr);
		assert.ok(cssResult.stdout.includes('url(foo\\\nbar.png)'), 'CSS escape continuation remains byte-for-byte intact ' + flags);
	}
}
const adjacent = '<cfset a=1><cfset b=2>';
assert.ok(!context.beautifyCFML(adjacent, false, true, false, 0, false, true).includes('\n'), 'split disabled');
assert.ok(context.beautifyCFML(adjacent, true, true, false, 0, false, true).includes('\n'), 'split enabled');
const normal = context.beautifyCFML('<cfif x>\n<cfset y=1>\n</cfif>', false, true, false, 0);
assert.ok(normal.includes('\n\t<cfset y=1>'), 'ordinary CFML indentation remains active');

(async function () {
	const vendor = path.join(root, 'vendor', 'tree-sitter');
	const TS = await import(pathToFileURL(path.join(vendor, 'web-tree-sitter.js')).href);
	await TS.Parser.init({ wasmBinary: fs.readFileSync(path.join(vendor, 'web-tree-sitter.wasm')) });
	const cf = new TS.Parser();
	cf.setLanguage(await TS.Language.load(fs.readFileSync(path.join(vendor, 'tree-sitter-cfml.wasm'))));
	const cs = new TS.Parser();
	cs.setLanguage(await TS.Language.load(fs.readFileSync(path.join(vendor, 'tree-sitter-cfscript.wasm'))));
	const semantic = require('../js/tree-sitter-cfml.js');
	const template = '<script>\nconst value = `\n<cfset x = outer(\ninner()\n)>\n`;\n</script>';
	assert.strictEqual(semantic.applySemanticIndentPostPass(template, cf, cs), template, 'JS template is opaque');
	const comment = '<!---\n<cfset x = outer(\ninner()\n)>\n--->';
	assert.strictEqual(semantic.applySemanticIndentPostPass(comment, cf, cs), comment, 'CFML comment is opaque');
	const mixed = '<cfscript>\nresult = outer(inner(\ninner()\n));\nmessage = "first\n    significant indentation\nlast";\n</cfscript>';
	const after = semantic.applySemanticIndentPostPass(mixed, cf, cs);
	assert.ok(after.includes('"first\n    significant indentation\nlast"'), 'CFScript literal is opaque');
	assert.notStrictEqual(after, mixed, 'safe CFScript call still receives semantic indentation');
	const flat = '<cfset x = outer(inner(\ninner()\n))>';
	assert.notStrictEqual(semantic.applySemanticIndentPostPass(flat, cf, cs), flat, 'real CFML still receives semantic indentation');
	assert.strictEqual(semantic.applySemanticIndentPostPass(flat, null, null), flat, 'disabled semantic pass is inert');
	const semanticInput = [
		"<cfset x = fAy(Tlt('Module'),'0',fAy(",
		"fAy(Tlt('Fraud'),'0',fAy(",
		"fAy(Tlt('Analysis'),'1','A','url','Id','')",
		"),'S','y','ns.cfm','Pc','')",
		"),'S','y','','Ai','')>"
	].join('\n');
	const ids = {
		split_html_tag: { checked: false }, auto_copy: { checked: false },
		auto_clear: { checked: false }, auto_clear_output: { checked: false },
		deep_sql: { checked: false }, deep_css: { checked: false }, deep_js: { checked: false },
		preserve_continuation_alignment: { checked: true }, normalize_indent: { checked: false },
		normalize_tab_width: { value: '0' }, semantic_indent: { checked: true },
		safe_mode: { checked: true }, pro_sql: { checked: false },
		pro_sql_dialect: { value: 'sql' }, language: { value: 'cfml' },
		input: { value: semanticInput }, output: { value: '' }
	};
	context.document = { getElementById(id) { return ids[id] || null; } };
	context.applySemanticIndentPostPass = semantic.applySemanticIndentPostPass;
	context.isTreeSitterCFMLLoaded = () => true;
	context.getCfmlParser = () => cf;
	await context.beautifyCodes();
	const safeOutput = ids.output.value;
	ids.safe_mode.checked = false;
	await context.beautifyCodes();
	assert.notStrictEqual(ids.output.value, safeOutput, 'real Semantic Indent resumes after Safe Mode is disabled');
	assert.ok(ids.output.value.includes("\n\t\tfAy(Tlt('Analysis')"), 'real Semantic Indent indents the nested call');
	let cfLoaded = false;
	let csLoaded = false;
	context.hasSemanticCFMLCandidate = semantic.hasSemanticCFMLCandidate;
	context.hasSemanticCFScriptCandidate = semantic.hasSemanticCFScriptCandidate;
	context.isTreeSitterCFMLLoaded = () => cfLoaded;
	context.getCfmlParser = () => cf;
	context.ensureTreeSitterCFML = () => { cfLoaded = true; return Promise.resolve(); };
	context.isTreeSitterCFScriptLoaded = () => csLoaded;
	context.getCfsParser = () => cs;
	context.ensureTreeSitterCFScript = () => { csLoaded = true; return Promise.resolve(); };
	for (const source of [
		'<cfscript>\nresult = outer(inner(1,\ninner(2,\ninner(3))));\n</cfscript>',
		'<cfscript>\nresult = outer(inner(\n    inner(2,\n      inner(3))));\n</cfscript>',
		semanticInput,
		semanticInput.replace(/\nfAy\(/g, '\n    fAy(')
	]) {
		cfLoaded = false;
		csLoaded = false;
		ids.input.value = source;
		await context.beautifyCodes();
		const cold = ids.output.value;
		await context.beautifyCodes();
		assert.strictEqual(ids.output.value, cold, 'cold and warm semantic output must match');
		if (source.startsWith('<cfset')) {
			assert.ok(cold.includes("\n\t\tfAy(Tlt('Analysis')"), 'cold CFML semantic pass applies');
		} else {
			assert.match(cold, /\n\t{2,}inner\(2,/, 'cold CFScript semantic pass applies');
		}
	}
	console.log('PASS mixed literal safety');
})().catch(error => { console.error(error); process.exitCode = 1; });
