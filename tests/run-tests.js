var fs = require('fs');
var vm = require('vm');

var scripts = [
	'js/cf-tags.js',
	'js/sql-keywords.js',
	'js/sql-beautifier.js',
	'js/deep-format.js',
	'js/tag-utils.js',
	'js/toast.js',
	'js/clipboard.js',
	'js/beautifier.js'
];

var browserCode = scripts.map(function(file) {
	return fs.readFileSync(file, 'utf8');
}).join('\n');

function makeContext(input, language, splitHtmlTag, deepFormat, autoCopy, autoClearInput, autoClearOutput, copyResult) {
	var elements = {
		language: {
			value: language || 'auto'
		},
		split_html_tag: {
			checked: splitHtmlTag == true
		},
		auto_copy: {
			checked: autoCopy == true
		},
		auto_clear: {
			checked: autoClearInput == true
		},
		auto_clear_output: {
			checked: autoClearOutput == true
		},
		deep_sql: {
			checked: deepFormat == true
		},
		deep_css: {
			checked: deepFormat == true
		},
		deep_js: {
			checked: deepFormat == true
		},
		input: {
			value: input || ''
		},
		output: {
			value: '',
			select: function() {}
		}
	};

	var context = {
		console: {
			log: function() {}
		},
		document: {
			getElementById: function(id) {
				return elements[id];
			},
			execCommand: function() {
				return copyResult !== false;
			},
			querySelector: function() {
				return {
					prepend: function() {}
				};
			},
			createElement: function() {
				return {
					className: '',
					innerHTML: '',
					classList: {
						add: function() {},
						remove: function() {}
					},
					style: {
						setProperty: function() {}
					},
					addEventListener: function() {},
					remove: function() {}
				};
			}
		},
		setTimeout: setTimeout,
		clearTimeout: clearTimeout
	};

	vm.createContext(context);
	vm.runInContext(browserCode, context);

	return {
		context: context,
		elements: elements
	};
}

function runSQL(input) {
	var harness = makeContext('', 'sql');
	return harness.context.beautifySQL(input);
}

function runRouter(input, language, deepFormat) {
	var harness = makeContext(input, language || 'auto', false, deepFormat == true);
	harness.context.beautifyCodes();
	return harness.elements.output.value;
}

function runRouterWithAutoCopy(input, language, deepFormat) {
	var harness = makeContext(input, language || 'auto', false, deepFormat == true, true);
	harness.context.beautifyCodes();
	return harness.elements.output.value;
}

function runRouterWithAutoClears(input, language, deepFormat, copyResult) {
	var harness = makeContext(input, language || 'auto', false, deepFormat == true, true, true, true, copyResult);
	harness.context.beautifyCodes();
	return JSON.stringify({
		input: harness.elements.input.value,
		output: harness.elements.output.value
	});
}

function assertEqual(name, actual, expected) {
	if (actual !== expected) {
		console.log('\nFAIL: ' + name);
		console.log('Actual:\n' + actual.replace(/\t/g, '->'));
		console.log('Expected:\n' + expected.replace(/\t/g, '->'));
		process.exitCode = 1;
	}
}

assertEqual(
	'simple select',
	runSQL('select u.id, u.name from users u where u.active = 1 order by u.id desc limit 10'),
	'SELECT u.id,\n\tu.name\nFROM users u\nWHERE u.active = 1\nORDER BY u.id DESC\nLIMIT 10'
);

assertEqual(
	'join with subquery',
	runSQL('select * from orders o left join (select user_id, count(*) c from items group by user_id) i on o.user_id = i.user_id'),
	'SELECT *\nFROM orders o\nLEFT JOIN (\n\tSELECT user_id,\n\t\tCOUNT(*) c\n\tFROM items\n\tGROUP BY user_id\n) i\nON o.user_id = i.user_id'
);

assertEqual(
	'postgres insert returning',
	runSQL('insert into users (name, data) values (\'bob\', \'{"age":30}\'::jsonb) returning id'),
	'INSERT INTO users (name, data)\nVALUES (\'bob\', \'{"age":30}\'::jsonb)\nRETURNING id'
);

assertEqual(
	'update with subquery and returning',
	runSQL('update users set active = true where id in (select user_id from logins) returning id'),
	'UPDATE users\nSET active = TRUE\nWHERE id IN (\n\tSELECT user_id\n\tFROM logins\n)\nRETURNING id'
);

assertEqual(
	'delete returning',
	runSQL('delete from users where id = 1 returning id'),
	'DELETE FROM users\nWHERE id = 1\nRETURNING id'
);

assertEqual(
	'union all',
	runSQL('select id from a union all select id from b order by id'),
	'SELECT id\nFROM a\nUNION ALL\nSELECT id\nFROM b\nORDER BY id'
);

assertEqual(
	'join variants',
	runSQL('select * from a inner join b on a.id = b.id right join c on c.id = a.id full join d on d.id = a.id'),
	'SELECT *\nFROM a\nINNER JOIN b\nON a.id = b.id\nRIGHT JOIN c\nON c.id = a.id\nFULL JOIN d\nON d.id = a.id'
);

assertEqual(
	'mysql backticks and json operator',
	runSQL('select `user`, data->>\'$.name\' from `users` where name like \'a%\' limit 5, 10'),
	'SELECT `user`,\n\tdata->>\'$.name\'\nFROM `users`\nWHERE name LIKE \'a%\'\nLIMIT 5, 10'
);

assertEqual(
	'auto detects sql',
	runRouter('with q as (select 1) select * from q', 'auto'),
	'WITH q AS (\n\tSELECT 1\n)\nSELECT *\nFROM q'
);

assertEqual(
	'cfml routed without sql formatting when deep format off (CFML tags get auto-split onto own lines, SQL body verbatim)',
	runRouter('<cfif x><cfquery name="q">SELECT 1</cfquery></cfif>', 'auto', false),
	'<cfif x>\n\t<cfquery name="q">SELECT 1</cfquery>\n</cfif>'
);

assertEqual(
	'deep cfquery sql',
	runRouter('<cfquery name="q">\nselect u.id,u.name from users u where u.active=1 order by u.id\n</cfquery>', 'cfml', true),
	'<cfquery name="q">\n\tSELECT u.id,\n\t\tu.name\n\tFROM users u\n\tWHERE u.active = 1\n\tORDER BY u.id\n</cfquery>'
);

assertEqual(
	'deep cfquery preserves cfqueryparam',
	runRouter('<cfquery name="q">\nselect * from users where id = <cfqueryparam value="#userId#" cfsqltype="cf_sql_integer">\n</cfquery>', 'cfml', true),
	'<cfquery name="q">\n\tSELECT *\n\tFROM users\n\tWHERE id = <cfqueryparam value="#userId#" cfsqltype="cf_sql_integer">\n</cfquery>'
);

assertEqual(
	'deep cfquery preserves escaped and expression hashes',
	runRouter('<cfquery name="q">\nselect * from users where code = ## and id = #x#\n</cfquery>', 'cfml', true),
	'<cfquery name="q">\n\tSELECT *\n\tFROM users\n\tWHERE code = ##\n\tAND id = #x#\n</cfquery>'
);

assertEqual(
	'deep cfquery preserves cfquery close text inside sql string',
	runRouter('<cfquery name="q">\nselect \'</cfquery>\' as x from t\n</cfquery>', 'cfml', true),
	'<cfquery name="q">\n\tSELECT \'</cfquery>\' AS x\n\tFROM t\n</cfquery>'
);

assertEqual(
	'sql doubled-quote escape does NOT confuse parser state — subsequent cfquery still gets deep-formatted',
	runRouter(
		// Earlier cfquery has 'it''s' SQL escape; without the fix in
		// isInsideCommentOrString the second cfquery would be skipped
		// because the quote-state machine never balances.
		"<cfquery name=\"a\">\nselect 'it''s ok' as x from t\n</cfquery>\n<cfquery name=\"b\">\nselect id from u\n</cfquery>",
		'cfml',
		true
	),
	"<cfquery name=\"a\">\n\tSELECT 'it''s ok' AS x\n\tFROM t\n</cfquery>\n<cfquery name=\"b\">\n\tSELECT id\n\tFROM u\n</cfquery>"
);

/* splitAdjacentCFMLTags — auto-split feature regression suite.
 * Covers the real-world legacy patterns that motivated this feature:
 * multiple <cfset>/<cfparam>/<cfinclude> jammed onto one line, often
 * with CFML markup comments mixed in. Also pins the safe-skip semantics
 * for inline cfif and opaque blocks (script/style/cfquery).
 */
assertEqual(
	'auto-split: three adjacent cfset on one line',
	runRouter('<cfset a = 1><cfset b = 2><cfset c = 3>', 'cfml', false),
	'<cfset a = 1>\n<cfset b = 2>\n<cfset c = 3>'
);

assertEqual(
	'auto-split: cfset / cfml-comment / cfset on one line',
	runRouter('<cfset a = 1><!---<cfset old = 2>---><cfset c = 3>', 'cfml', false),
	'<cfset a = 1>\n<!---<cfset old = 2>--->\n<cfset c = 3>'
);

assertEqual(
	'auto-split: cfif open + cfinclude + cfif close on one line — split + close on own line',
	runRouter('<cfif x><cfinclude template="foo.cfm"></cfif>', 'cfml', false),
	'<cfif x>\n\t<cfinclude template="foo.cfm">\n</cfif>'
);

assertEqual(
	'auto-split does NOT touch inline <cfif x>1<cfelse>0</cfif> (no `>` `<` boundary)',
	runRouter('<cfif x>1<cfelse>0</cfif>', 'cfml', false),
	'<cfif x>1<cfelse>0</cfif>'
);

assertEqual(
	'auto-split skips contents of <script> block (JS strings can contain anything)',
	runRouter('<script>var x = "<cfset y=1>";</script>', 'cfml', false),
	'<script>var x = "<cfset y=1>";</script>'
);

assertEqual(
	'auto-split skips contents of <cfquery> block (cfqueryparam stays inline with SQL)',
	runRouter('<cfquery name="q">SELECT 1<cfqueryparam value="1" cfsqltype="cf_sql_integer"></cfquery>', 'cfml', false),
	'<cfquery name="q">SELECT 1<cfqueryparam value="1" cfsqltype="cf_sql_integer"></cfquery>'
);

assertEqual(
	'auto-split: cfparam + cfinclude on one line',
	runRouter('<cfparam name="x" default=""><cfinclude template="bar.cfm">', 'cfml', false),
	'<cfparam name="x" default="">\n<cfinclude template="bar.cfm">'
);

assertEqual(
	'auto-split: nested cfif with inner cfset gets fully split (each tag own line)',
	runRouter('<cfif a><cfif b><cfset x = 1></cfif></cfif>', 'cfml', false),
	'<cfif a>\n\t<cfif b>\n\t\t<cfset x = 1>\n\t</cfif>\n</cfif>'
);

assertEqual(
	'auto-split: <script> mid-line gets pulled onto own line + JS body re-indents to script depth +1; stray </td> peels (Rule D)',
	runRouter("<td>foo&nbsp;<script>doIt();</script>bar</td>", 'cfml', false),
	'<td>foo&nbsp;\n\t<script>doIt();</script>bar\n</td>'
);

assertEqual(
	'auto-split: <script> with multi-line JS body — block opens own depth, body indents +1, </script> aligns with open',
	runRouter("<td>...&nbsp;<script>\nvar a = 1;\n</script>\n<cfif x>Only</cfif>.</td>", 'cfml', false),
	'<td>...&nbsp;\n\t<script>\n\t\tvar a = 1;\n\t</script>\n\t<cfif x>Only</cfif>.\n</td>'
);

assertEqual(
	'auto-split: <tr><td>x</td><td>y</td></tr> — opens get split at `>` boundary, structural closes (</tr>) align with opens, <td>x</td> stays inline',
	runRouter('<tr><td>foo</td><td>bar</td></tr>', 'cfml', false),
	'<tr>\n\t<td>foo</td>\n\t<td>bar</td>\n</tr>'
);

assertEqual(
	'auto-split: empty <td></td> stays glued (no `>` between them at split-trigger position)',
	runRouter('<table><tr><td></td><td>x</td></tr></table>', 'cfml', false),
	'<table>\n\t<tr>\n\t\t<td></td>\n\t\t<td>x</td>\n\t</tr>\n</table>'
);

assertEqual(
	'auto-split: <td>x<cfif>z</cfif>.</td> — line has </cfif>, so split before </td>',
	runRouter('<td>x<cfif y>z</cfif>.</td>', 'cfml', false),
	'<td>x<cfif y>z</cfif>.\n</td>'
);

assertEqual(
	'auto-split: <cfscript> opaque — embedded <script> in JS comment NOT extracted',
	runRouter('<cfscript>\n// note: <script>foo()</script>\nvar y = 1;\n</cfscript>', 'cfml', false),
	'<cfscript>\n\t// note: <script>foo()</script>\n\tvar y = 1;\n</cfscript>'
);

assertEqual(
	'auto-split: real-world disp_pym1amt pattern — badly-indented multi-tag glued line gets fully aligned',
	runRouter(
		'<cfif use_split_payment_yn EQ "y" AND split_payment_used EQ "y">\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t<table width="100%" border="#bdtk#" class="#default_font#" cellspacing="0" cellpadding="0">\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t<tr height=10><td></td></tr>\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t<cfif disp_pym1amt GT 0><tr height="#ht_ft_total#"><td width="#wd_ft04to05_01#" #style_padding#>&nbsp;</td><td width="#wd_ft04to05_02#" align="right" #style_padding#>\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t\t<cfif set_language is \'english\'>Paid by</cfif> #vle_pym1_desc#\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t</td></tr></cfif>',
		'cfml', false
	),
	'<cfif use_split_payment_yn EQ "y" AND split_payment_used EQ "y">\n' +
	'\t<table width="100%" border="#bdtk#" class="#default_font#" cellspacing="0" cellpadding="0">\n' +
	'\t\t<tr height=10>\n' +
	'\t\t\t<td></td>\n' +
	'\t\t</tr>\n' +
	'\t\t<cfif disp_pym1amt GT 0>\n' +
	'\t\t\t<tr height="#ht_ft_total#">\n' +
	'\t\t\t\t<td width="#wd_ft04to05_01#" #style_padding#>&nbsp;</td>\n' +
	'\t\t\t\t<td width="#wd_ft04to05_02#" align="right" #style_padding#>\n' +
	'\t\t\t\t\t<cfif set_language is \'english\'>Paid by</cfif> #vle_pym1_desc#\n' +
	'\t\t\t\t</td>\n' +
	'\t\t\t</tr>\n' +
	'\t\t</cfif>'
);

assertEqual(
	'auto-split: stray </cfif> after text — closes outer cfif from prior line, must split off (Rule D)',
	runRouter('<cfif outer>\n\t<cfif inner>Foo</cfif> :&nbsp;</cfif>', 'cfml', false),
	'<cfif outer>\n\t<cfif inner>Foo</cfif> :&nbsp;\n</cfif>'
);

assertEqual(
	'auto-split: inline <cfif x>1<cfelse>0</cfif> stays intact even with Rule D active (opens == closes balanced inline)',
	runRouter('<cfif x>1<cfelse>0</cfif>', 'cfml', false),
	'<cfif x>1<cfelse>0</cfif>'
);

assertEqual(
	'auto-split: stray </b> after inline cfif — Rule D peels HTML close when no inline open on line',
	runRouter('<b>\n\t<cfif x>GST<cfelse>VAT</cfif></b>', 'cfml', false),
	'<b>\n\t<cfif x>GST<cfelse>VAT</cfif>\n</b>'
);

assertEqual(
	'auto-split: inline <p>Hello <b>world</b>.</p> stays intact — Rule D sees matching <b> on line',
	runRouter('<p>Hello <b>world</b>.</p>', 'cfml', false),
	'<p>Hello <b>world</b>.</p>'
);

assertEqual(
	'auto-split: real-world GST cfif pattern — <cfif>GST<cfelseif>VAT<cfelse>Sales Tax</cfif></b> peels </b>',
	runRouter('<b>\n\t<cfif comain_gst_name EQ "GST">GST<cfelseif comain_gst_name EQ "VAT">VAT<cfelse>Sales Tax</cfif></b>', 'cfml', false),
	'<b>\n\t<cfif comain_gst_name EQ "GST">GST<cfelseif comain_gst_name EQ "VAT">VAT<cfelse>Sales Tax</cfif>\n</b>'
);

assertEqual(
	'auto-split: real-world serialnum pattern — <cfif set_language is \'english\'>Serial Number</cfif> :&nbsp;</cfif> peels trailing close',
	runRouter('<cfif qs_sr_nums.recordcount GT 0>\n\t<br>\n\t<cfif set_language is \'english\'>Serial Number</cfif> :&nbsp;</cfif>\n\t<cfset qcnt=0>', 'cfml', false),
	'<cfif qs_sr_nums.recordcount GT 0>\n\t<br>\n\t<cfif set_language is \'english\'>Serial Number</cfif> :&nbsp;\n</cfif>\n<cfset qcnt=0>'
);

assertEqual(
	'auto-split: real-world memo_transdesc Remarks pattern — <font> wraps multi-line content, stray </font> after text+string-with-<br>-inside peels (Rule D ignores tags inside string literals)',
	runRouter(
		'<td valign="top">\n' +
		'\t<font>\n' +
		'\t\t<b>Remarks:</b>\n' +
		'\t\t<br>#trim(Replace(memo_transdesc, "#chr(13)##chr(10)#", "<br>", "ALL"))#</font>\n' +
		'</td>',
		'cfml', false
	),
	'<td valign="top">\n' +
	'\t<font>\n' +
	'\t\t<b>Remarks:</b>\n' +
	'\t\t<br>#trim(Replace(memo_transdesc, "#chr(13)##chr(10)#", "<br>", "ALL"))#\n' +
	'\t</font>\n' +
	'</td>'
);

assertEqual(
	'auto-split: real-world numberToEnglish pattern — <td>...&nbsp;<script>JS</script><cfif>x</cfif>.</td>',
	runRouter(
		'<cfif disp_numberToEnglishProper EQ "y">\n\t<td #style_padding#>desc: &nbsp;<script Language="JavaScript">\n\tdocument.write(numberToEnglish(\'#amount_forex#\'));\n</script>\n\t<cfif set_language is \'english\'>Only</cfif>.</td>\n</cfif>',
		'cfml',
		false
	),
	'<cfif disp_numberToEnglishProper EQ "y">\n\t<td #style_padding#>desc: &nbsp;\n\t\t<script Language="JavaScript">\n\t\t\tdocument.write(numberToEnglish(\'#amount_forex#\'));\n\t\t</script>\n\t\t<cfif set_language is \'english\'>Only</cfif>.\n\t</td>\n</cfif>'
);

/* Lite path keyword coverage: cfquery with structural cfif inside takes the
 * Tier 2 verbatim path. Even though full Pro SQL re-format is skipped, the
 * Lite uppercase pass MUST still uppercase common SQL keywords like `as`,
 * `using`, `cast`, `over` — otherwise output looks half-formatted. This
 * regression test pins the issue found in sample/test.cfm cfquery #11
 * (qs_result_main with cfif body and lowercase `as` aliases).
 */
(function runLiteUppercaseAsKeywords() {
	var fs2 = require('fs');
	var vendorPath2 = 'vendor/sql-formatter.min.js';
	if (!fs2.existsSync(vendorPath2)) {
		console.log('SKIP Lite-AS test (vendor bundle missing)');
		return;
	}
	var sqlFormatter2 = require('../' + vendorPath2);
	var proSrc2 = fs2.readFileSync('js/pro-sql.js', 'utf8');
	var browserCode2 = scripts.map(function(file) { return fs2.readFileSync(file, 'utf8'); }).join('\n');
	// cfquery body has cfif → goes through Tier 2 verbatim. The body has
	// lowercase `as` (column alias) and `as` (table alias) — both must be
	// uppercased by Lite uppercase, otherwise the output is inconsistent.
	var input = '<cfquery name="q">\n\tselect a.id as user_id, b.name as full_name\n\tfrom users a\n\tinner join profile b on a.id = b.uid\n\t<cfif x>\n\t\twhere a.active = 1\n\t<cfelse>\n\t\twhere a.active = 0\n\t</cfif>\n</cfquery>';
	var elements3 = {
		language: { value: 'cfml' }, split_html_tag: { checked: false },
		auto_copy: { checked: false }, auto_clear: { checked: false }, auto_clear_output: { checked: false },
		deep_sql: { checked: true }, deep_css: { checked: false }, deep_js: { checked: false },
		pro_sql: { checked: true }, pro_sql_dialect: { value: 'mysql' },
		input: { value: input }, output: { value: '', select: function() {} }
	};
	var ctx3 = {
		console: { log: function() {}, warn: function() {} },
		window: { sqlFormatter: sqlFormatter2 },
		document: {
			getElementById: function(id) { return elements3[id]; },
			execCommand: function() { return true; },
			querySelector: function() { return { prepend: function() {}, textContent: '' }; },
			createElement: function() { return { className: '', innerHTML: '', style:{setProperty:function(){}}, classList:{add:function(){},remove:function(){}}, addEventListener:function(){}, remove:function(){} }; },
			addEventListener: function() {}, readyState: 'complete'
		},
		setTimeout: setTimeout, clearTimeout: clearTimeout
	};
	vm.createContext(ctx3);
	vm.runInContext(proSrc2 + '\n' + browserCode2, ctx3);
	ctx3.beautifyCodes();
	var out = elements3.output.value;
	if (/\bas\s/i.test(out) && !/\bAS\s/.test(out)) {
		console.log('FAIL: Lite uppercase did not touch `as` keyword. Output:');
		console.log(out);
		process.exitCode = 1;
	} else if (/\b(as|inner join|where|from|select|and|or)\b/.test(out)) {
		console.log('FAIL: lowercase SQL keyword survived Lite uppercase pass. Output:');
		console.log(out);
		process.exitCode = 1;
	} else {
		console.log('PASS: Lite uppercase covers AS, INNER JOIN, WHERE, FROM, SELECT on Tier 2 verbatim path');
	}
})();

assertEqual(
	'CFML string with backslash before closing quote (Windows path) does NOT swallow the closer — subsequent cfquery still parses',
	// CFML strings do NOT use C/JS-style backslash escapes. A literal Windows
	// path like "..\..\..\#x#\" ends with `\"` — if the parser treats `\"`
	// as an escaped quote, the closing `"` is consumed, parser parity goes
	// off-by-one for the rest of the file, and every later <cfquery> is
	// silently skipped as "inside a string". This test covers the real-world
	// regression where a 4000-line .cfm file had its cfqueries un-formatted
	// because of one upstream cfset using replace() with backslash arguments.
	runRouter(
		"<cfset p = replace(\"..\\..\\..\\#x#\\\",\"\\\\\", \"\\\\\\\\\", \"ALL\")>\n<cfquery name=\"q\">\nselect id from t\n</cfquery>",
		'cfml',
		true
	),
	"<cfset p = replace(\"..\\..\\..\\#x#\\\",\"\\\\\", \"\\\\\\\\\", \"ALL\")>\n<cfquery name=\"q\">\n\tSELECT id\n\tFROM t\n</cfquery>"
);

assertEqual(
	'deep style css',
	runRouter('<style>\nbody{margin:0;color:red}.btn{padding:10px}\n</style>', 'cfml', true),
	'<style>\n\tbody{margin:0;color:red}\n\t.btn{padding:10px}\n</style>'
);

assertEqual(
	'deep script javascript',
	runRouter('<script>\nif(x){foo();}\n</script>', 'cfml', true),
	'<script>\n\tif(x){\n\t\tfoo();\n\t}\n</script>'
);

assertEqual(
	'deep script preserves closing brace inside string',
	runRouter('<script>\nvar token = "}";\nif(x){foo();}\n</script>', 'cfml', true),
	'<script>\n\tvar token = "}";\n\tif(x){\n\t\tfoo();\n\t}\n</script>'
);

assertEqual(
	'deep script preserves script close text inside string',
	runRouter('<script>\nvar token = "</script>";\nif(x){foo();}\n</script>', 'cfml', true),
	'<script>\n\tvar token = "</script>";\n\tif(x){\n\t\tfoo();\n\t}\n</script>'
);

assertEqual(
	'deep script preserves semicolon inside double quoted html string',
	runRouter('<script>\nh += "<td style=\'box-sizing:border-box;\' align=\'left\'>Supplier\'s Quote:&nbsp;&nbsp;x</td>";\n</script>', 'cfml', true),
	'<script>\n\th += "<td style=\'box-sizing:border-box;\' align=\'left\'>Supplier\'s Quote:&nbsp;&nbsp;x</td>";\n</script>'
);

assertEqual(
	'deep script keeps for loop semicolons inline',
	runRouter('<script>\nfor (var i = 0; i < n; i++) { foo(i); }\n</script>', 'cfml', true),
	'<script>\n\tfor (var i = 0; i < n; i++) {\n\t\tfoo(i);\n\t}\n</script>'
);

assertEqual(
	'deep script preserves template literal with expression',
	runRouter('<script>\nvar s = `<div>${name}; end</div>`;\n</script>', 'cfml', true),
	'<script>\n\tvar s = `<div>${name}; end</div>`;\n</script>'
);

assertEqual(
	'deep script preserves regex literal with semicolon — empty {} stays inline',
	// Expected updated 2026-05-14 commit-followup: empty `{}` no longer
	// splits to `{\n}`. The verbose split was visually noisy for
	// `var x = {};` and `if (x) {}` patterns common in real code.
	// See formatBraceCode's empty-{} sentinel handling.
	runRouter('<script>\nvar r = /^a;b$/gi;\nif(x){}\n</script>', 'cfml', true),
	'<script>\n\tvar r = /^a;b$/gi;\n\tif(x){}\n</script>'
);

assertEqual(
	'script src skipped',
	runRouter('<script src="app.js"></script>', 'cfml', true),
	'<script src="app.js"></script>'
);

assertEqual(
	'non javascript script skipped',
	runRouter('<script type="text/x-template"><div>{{ value }}</div></script>', 'cfml', true),
	'<script type="text/x-template"><div>{{ value }}</div></script>'
);

assertEqual(
	'deep cfquery preserves cfif tokens',
	runRouter('<cfquery name="q">\nselect * from t <cfif showAll>where active=1</cfif>\n</cfquery>', 'cfml', true),
	'<cfquery name="q">\n\tSELECT *\n\tFROM t <cfif showAll>where active = 1</cfif>\n</cfquery>'
);

assertEqual(
	'deep cfquery keeps space after dynamic and before paren',
	runRouter('<cfquery name="q">\nselect * from t where x=1 <cfif y>and (a=1 or b=2)</cfif>\n</cfquery>', 'cfml', true),
	'<cfquery name="q">\n\tSELECT *\n\tFROM t\n\tWHERE x = 1 <cfif y>AND (a = 1 OR b = 2)</cfif>\n</cfquery>'
);

assertEqual(
	'deep cfquery preserves parent indentation',
	runRouter('<cfif x>\n<cfquery name="q">\nselect 1\n</cfquery>\n</cfif>', 'cfml', true),
	'<cfif x>\n\t<cfquery name="q">\n\t\tSELECT 1\n\t</cfquery>\n</cfif>'
);

assertEqual(
	'deep cfquery preserves cfml comment inside sql body',
	runRouter('<cfquery name="q">\nselect a,\n<!--- inline note --->\nb\nfrom t\n</cfquery>', 'cfml', true),
	'<cfquery name="q">\n\tSELECT a,\n\t\t<!--- inline note ---> b\n\tFROM t\n</cfquery>'
);

assertEqual(
	'multiline cfml comment does not affect following live code indent',
	runRouter('<cfif x>\n<!---\n<cfif y>\ncomment only\n</cfif>\n--->\n<cfset z = 1>\n</cfif>', 'cfml', false),
	'<cfif x>\n\t<!---\n\t<cfif y>\n\tcomment only\n\t</cfif>\n\t--->\n\t<cfset z = 1>\n</cfif>'
);

assertEqual(
	'select breaks multiple columns',
	runSQL('select a, b, c, d from t'),
	'SELECT a,\n\tb,\n\tc,\n\td\nFROM t'
);

assertEqual(
	'sql server bracket identifiers preserved',
	runSQL('select [User Name], [Order] from [User Table] where [Order] = 1'),
	'SELECT [User Name],\n\t[Order]\nFROM [User Table]\nWHERE [Order] = 1'
);

assertEqual(
	'select keeps function args on one line',
	runSQL('select count(a, b), sum(c) from t'),
	'SELECT COUNT(a, b),\n\tSUM(c)\nFROM t'
);

assertEqual(
	'group by breaks columns',
	runSQL('select x from t group by a, b, c'),
	'SELECT x\nFROM t\nGROUP BY a,\n\tb,\n\tc'
);

assertEqual(
	'order by breaks columns',
	runSQL('select x from t order by a desc, b asc'),
	'SELECT x\nFROM t\nORDER BY a DESC,\n\tb ASC'
);

assertEqual(
	'insert column list stays in parens',
	runSQL('insert into t (a, b, c) values (1, 2, 3)'),
	'INSERT INTO t (a, b, c)\nVALUES (1, 2, 3)'
);

assertEqual(
	'deep cfquery real world multi column select',
	runRouter('<cfif x>\n<cfquery name="q">\nselect a, b as x, c as y, d as z from t where e = 1 and f = 2\n</cfquery>\n</cfif>', 'cfml', true),
	'<cfif x>\n\t<cfquery name="q">\n\t\tSELECT a,\n\t\t\tb AS x,\n\t\t\tc AS y,\n\t\t\td AS z\n\t\tFROM t\n\t\tWHERE e = 1\n\t\tAND f = 2\n\t</cfquery>\n</cfif>'
);

assertEqual(
	'between and not split',
	runSQL('select * from t where x between 1 and 10'),
	'SELECT *\nFROM t\nWHERE x BETWEEN 1 AND 10'
);

assertEqual(
	'between followed by boolean and',
	runSQL('select * from t where x between 1 and 10 and y = 2'),
	'SELECT *\nFROM t\nWHERE x BETWEEN 1 AND 10\nAND y = 2'
);

assertEqual(
	'case when basic',
	runSQL("select case when x = 1 then 'a' else 'b' end as label from t"),
	"SELECT CASE\n\tWHEN x = 1 THEN 'a'\n\tELSE 'b'\nEND AS label\nFROM t"
);

assertEqual(
	'case when multiple branches',
	runSQL("select id, case when s = 'P' then 'Pending' when s = 'A' then 'Approved' else 'Unknown' end as label from t"),
	"SELECT id,\n\tCASE\n\t\tWHEN s = 'P' THEN 'Pending'\n\t\tWHEN s = 'A' THEN 'Approved'\n\t\tELSE 'Unknown'\n\tEND AS label\nFROM t"
);

assertEqual(
	'case when boolean condition keeps and inline',
	runSQL("select case when status = 'PENDING' and datediff(day, created_date, getdate()) > 30 then 'overdue' when status = 'PENDING' then 'warning' else 'ok' end as badge_class, case when total_amt between 0 and 1000 then 'small' else 'large' end as amt_tier from t"),
	"SELECT CASE\n\tWHEN status = 'PENDING' AND datediff(day, created_date, getdate()) > 30 THEN 'overdue'\n\tWHEN status = 'PENDING' THEN 'warning'\n\tELSE 'ok'\nEND AS badge_class,\n\tCASE\n\t\tWHEN total_amt BETWEEN 0 AND 1000 THEN 'small'\n\t\tELSE 'large'\n\tEND AS amt_tier\nFROM t"
);

assertEqual(
	'default auto-copy keeps beautified output visible',
	runRouterWithAutoCopy('<cfif x>\n<cfset y = 1>\n</cfif>', 'cfml', true),
	'<cfif x>\n\t<cfset y = 1>\n</cfif>'
);

assertEqual(
	'default auto-copy and auto-clear clears both fields after copy',
	runRouterWithAutoClears('<cfif x>\n<cfset y = 1>\n</cfif>', 'cfml', true, true),
	'{"input":"","output":""}'
);

assertEqual(
	'auto-clear output keeps result visible when copy fails',
	runRouterWithAutoClears('<cfif x>\n<cfset y = 1>\n</cfif>', 'cfml', true, false),
	'{"input":"","output":"<cfif x>\\n\\t<cfset y = 1>\\n</cfif>"}'
);

assertEqual(
	'window function order by stays inline',
	runSQL('SELECT ROW_NUMBER() OVER (PARTITION BY x ORDER BY y DESC) AS rn FROM t'),
	'SELECT ROW_NUMBER() OVER (PARTITION BY x ORDER BY y DESC) AS rn\nFROM t'
);

assertEqual(
	'function call no space before paren',
	runSQL('select dateadd(day, -90, getdate()) from t'),
	'SELECT dateadd(day, -90, getdate())\nFROM t'
);

assertEqual(
	'unary minus on literal',
	runSQL('select * from t where x between -100 and -10'),
	'SELECT *\nFROM t\nWHERE x BETWEEN -100 AND -10'
);

assertEqual(
	'binary minus still has spaces',
	runSQL('select a - b from t'),
	'SELECT a - b\nFROM t'
);

assertEqual(
	'multi-line html tag indents continuation lines and aligns close tag',
	runRouter(
		'<cfif a>\n<cfif b>\n<div class="x"\ndata-uen="1"\ndata-padscale="0.02">\n</div>\n</cfif>\n</cfif>',
		'cfml',
		false
	),
	'<cfif a>\n\t<cfif b>\n\t\t<div class="x"\n\t\t\tdata-uen="1"\n\t\t\tdata-padscale="0.02">\n\t\t</div>\n\t</cfif>\n</cfif>'
);

assertEqual(
	'multi-line cfqueryparam (cf inline) pops back to parent level after close',
	runRouter(
		'<cfquery name="q">\nselect * from t where id =\n<cfqueryparam value="#x#"\ncfsqltype="cf_sql_integer">\n</cfquery>',
		'cfml',
		false
	),
	'<cfquery name="q">\n\tselect * from t where id =\n\t<cfqueryparam value="#x#"\n\t\tcfsqltype="cf_sql_integer">\n</cfquery>'
);

assertEqual(
	'html attribute with /* not treated as block comment',
	runRouter('<div>\n<input type="file" accept="image/*">\n<button onclick="foo()">\n<span>ok</span>\n</button>\n</div>', 'cfml', false),
	'<div>\n\t<input type="file" accept="image/*">\n\t<button onclick="foo()">\n\t\t<span>ok</span>\n\t</button>\n</div>'
);

assertEqual(
	'standalone block comment still treated as comment',
	runRouter('<cfif x>\n/* this spans\nmany lines */\n<cfset y = 1>\n</cfif>', 'cfml', false),
	'<cfif x>\n\t/* this spans\n\tmany lines */\n\t<cfset y = 1>\n</cfif>'
);

assertEqual(
	'deep format ignores script tag inside cfscript line comment',
	runRouter('<cfscript>\n// Safe: <script>window.X=1;</script>\nvar y = 2;\n</cfscript>', 'cfml', true),
	'<cfscript>\n\t// Safe: <script>window.X=1;</script>\n\tvar y = 2;\n</cfscript>'
);

assertEqual(
	'deep format ignores cfquery inside cfml markup comment',
	runRouter('<cfif x>\n<!--- example: <cfquery name="q">SELECT 1</cfquery> --->\n<cfset y = 2>\n</cfif>', 'cfml', true),
	'<cfif x>\n\t<!--- example: <cfquery name="q">SELECT 1</cfquery> --->\n\t<cfset y = 2>\n</cfif>'
);

/* JS mode — bare JS (no <script> wrapper) routed through formatBraceCode.
 * Wins over CFML mode: template literals, regex literals, and parenthesized
 * groups are token-protected before brace splitting.
 *
 * Auto-detect routes to JS only when input has zero CFML/HTML tags AND
 * begins with a JS construct. Files with leading <!---...---> banners
 * (very common in legacy CFML) stay in cfml mode — that path is exercised
 * by the existing CFML brace-counter tests above. */
assertEqual(
	'js mode — auto-detect picks tag-free JS file',
	(function() {
		var harness = makeContext('', 'auto');
		return harness.context.detectLanguage('function f() { return 1; }');
	})(),
	'js'
);

// Updated 2026-05-14: a leading CFML markup / HTML / JS block / JS line
// comment banner does NOT disqualify a JS body from 'js' routing. Comment
// regions are comments, not language semantics. Real CFML tags (<cfset>,
// <cfif>, <cfquery>) and real HTML tags OUTSIDE strings/comments are what
// route to 'cfml'. Matches splitLeadingCommentBlock + the
// formatJsWithLeadingComments path that preserves the banner verbatim.
assertEqual(
	'js mode — leading CFML markup comment banner does NOT block js routing',
	(function() {
		var harness = makeContext('', 'auto');
		return harness.context.detectLanguage('<!--- header --->\nfunction f() { return 1; }');
	})(),
	'js'
);

assertEqual(
	'js mode — real CFML tags after banner DO route to cfml',
	(function() {
		var harness = makeContext('', 'auto');
		return harness.context.detectLanguage('<!--- banner --->\n<cfset x = 1>\n<cfif x><cfquery>SELECT 1</cfquery></cfif>');
	})(),
	'cfml'
);

assertEqual(
	'js mode — real HTML tags route to cfml (mixed markup files)',
	(function() {
		var harness = makeContext('', 'auto');
		return harness.context.detectLanguage('<div>real markup</div>');
	})(),
	'cfml'
);

// Regression: hasTagsOutsideStrings must handle regex literals — a `'` or
// `"` inside `/.../` (regex) is part of the regex body, NOT a string
// delimiter. Without this, `src.domain.replace(/'/g, '')` poisons string
// parity and subsequent `<TAG>` chars (even those inside real JS strings)
// get flagged as "real tags" → file mis-routed to cfml → content corruption.
// Real-world repro: sample/ai_chatbox_js_runtime_send.cfm L177-180.
assertEqual(
	'js mode — regex literal /...\'.../ does not poison string parity in detection',
	(function() {
		var harness = makeContext('', 'auto');
		// Regex contains `'`; later JS string contains `<a ...>` HTML.
		// Without regex-aware lastSig tracking, the `'` inside the regex
		// gets mis-treated as a string start, the closing matched `'`
		// exits a phantom string, and the `<a` is then seen as "outside
		// strings" → flagged as a real tag → returns 'cfml'.
		return harness.context.detectLanguage(
			"function f(src) {\n" +
			"\tvar x = src.replace(/'/g, '');\n" +
			"\tvar html = '<a href=\"' + src.href + '\">link</a>';\n" +
			"}"
		);
	})(),
	'js'
);

// Regression: multi-line paren tokens (e.g. AgentLog.subscribe(function(evt) {
// body; })) must re-indent their body relative to the placeholder's host
// line, not keep the source's outer-wrap indent. Real-world repro from
// sample/ai_chatbox_js_runtime_send.cfm L208-211 — source had everything
// at +1 outer-indent; formatBraceCode stripped the outer wrap on its own
// split lines (object methods at level 0) but the paren-token body kept
// its +1 verbatim, producing wrapper at level 0 with body at level 2.
assertEqual(
	'js mode — multi-line paren body re-indents to match dedented wrapper',
	runRouter(
		// Source has outer-wrap (1 tab on every line). Top-level
		// declaration should dedent to 0; body of the inner callback
		// should be at 1 (not 2).
		'\tAgentLog.subscribe(function(evt) {\n\t\tactivityDrawer.render();\n\t\tif (x) y();\n\t});',
		'js', false
	),
	'AgentLog.subscribe(function(evt) {\n\tactivityDrawer.render();\n\tif (x) y();\n});'
);

// Regression: multi-line block comments must re-indent on restore to
// match the dedented surrounding code. Repro from
// sample/ai_chatbox_js_runtime_send.cfm L14-16 — source had file-header
// block comment at 1 tab (CFML include outer-wrap) AND following code
// at 1 tab. formatBraceCode dedented the code to indent 0 but the block
// comment kept its source `\t` prefix, producing comment at indent 1
// above code at indent 0. Fix: restoreBraceCodeText strips source's
// common-leading-tabs from continuation lines and prepends host-line
// baseIndent. Tabs only — spaces preserve visual alignment under `/* `.
assertEqual(
	'js mode — multi-line block comment re-indents to match dedented code',
	runRouter(
		'\t/* line one\n\t   line two\n\t   line three */\n\tvar x = 1;',
		'js', false
	),
	'/* line one\n   line two\n   line three */\nvar x = 1;'
);

// Regression: empty {} and [] literals stay on one line. Source like
// `var x = {};` was being split to `var x = {\n};` by formatBraceCode's
// naive `{` → `{\n` rewrite.
assertEqual(
	'js mode — empty object literal {} stays inline',
	runRouter('var x = {};', 'js', false),
	'var x = {};'
);

assertEqual(
	'js mode — empty array literal [] stays inline',
	runRouter('var x = [];', 'js', false),
	'var x = [];'
);

assertEqual(
	'js mode — empty if body if(x){} stays inline',
	runRouter('if (x) {}', 'js', false),
	'if (x) {}'
);

assertEqual(
	'js mode — nested multi-line parens stay aligned',
	runRouter(
		'document.addEventListener(\'evt\', function() {\n\ttry { render(); } catch (_) {}\n});',
		'js', false
	),
	'document.addEventListener(\'evt\', function() {\n\ttry { render(); } catch (_) {}\n});'
);

assertEqual(
	'js mode — regex with character class [/] does not poison parity',
	(function() {
		var harness = makeContext('', 'auto');
		// `[/]` is a character class containing `/` — the `/` inside is
		// NOT the regex closer. Walker must respect [...] state.
		return harness.context.detectLanguage(
			"var pat = /[/'\"]+/g;\n" +
			"var html = '<div>x</div>';"
		);
	})(),
	'js'
);

/* Regression: bare JS fragment that has HTML tags ONLY inside string
 * literals must be detected as 'js', not 'cfml'. Repro from
 * sample/ai_chatbox_js_runtime_send.cfm — a snippet like
 *   if (m.role === 'user') {
 *       var html = '<div class="x">' + name + '</div>';
 *   }
 * was routed to CFML mode because the regex `/<[a-zA-Z!\/]/` matched
 * `<div` inside the string. CFML mode's splitAdjacentCFMLTags then
 * injected newlines before `</div>` etc., corrupting the JS strings at
 * runtime (a literal newline ended up INSIDE `'</div>'`). Fix: detect
 * `<` outside strings/comments using JS lexer semantics. */
assertEqual(
	'js mode — auto-detect routes bare-JS-with-HTML-in-strings to js',
	(function() {
		var harness = makeContext('', 'auto');
		return harness.context.detectLanguage(
			"if (m.role === 'user') {\n\tvar html = '<div class=\"x\">' + name + '</div>';\n}"
		);
	})(),
	'js'
);

assertEqual(
	'js mode — HTML inside JS string literal preserved verbatim (no splitAdjacentCFMLTags corruption)',
	(function() {
		var harness = makeContext('', 'auto');
		// Verify hasTagsOutsideStrings correctly skips strings + comments.
		return [
			harness.context.hasTagsOutsideStrings("var s = '<div>x</div>';"),         // false — tag in string
			harness.context.hasTagsOutsideStrings("var s = \"<div>x</div>\";"),       // false — tag in string
			harness.context.hasTagsOutsideStrings("/* <div> */ var x = 1;"),          // false — tag in block comment
			harness.context.hasTagsOutsideStrings("// <div>\nvar x = 1;"),            // false — tag in line comment
			harness.context.hasTagsOutsideStrings("var s = '\\'<div>'; var t;"),      // false — escape + tag in string
			harness.context.hasTagsOutsideStrings("<cfif x>foo</cfif>"),              // true — real tag
			harness.context.hasTagsOutsideStrings("var x = 1;\n<div>real</div>")      // true — tag outside any string
		].join(',');
	})(),
	'false,false,false,false,false,true,true'
);

/* Idempotency on bare-JS-with-HTML-in-strings — second pass must equal
 * first pass. Confirms the 'js' mode routing actually produces a fixed
 * point (no further reformatting on re-run). */
assertEqual(
	'js mode — bare JS with HTML in strings is idempotent under auto',
	(function() {
		var input = "if (m.role === 'user') {\n\tvar html = '<div class=\"x\">' + name + '</div>';\n}";
		var pass1 = runRouter(input, 'auto', false);
		var pass2 = runRouter(pass1, 'auto', false);
		return pass1 === pass2 ? 'idempotent' : 'NOT idempotent (pass1 != pass2)';
	})(),
	'idempotent'
);

/* Content preservation: bare JS with HTML in strings must NOT have its
 * strings corrupted. The most damaging case is `' </div>'` getting split
 * to `'\n</div>'` — a literal newline inside the JS string that breaks
 * the code at runtime. Compare normalized content to ensure no chars
 * leaked or were dropped. */
assertEqual(
	'js mode — JS string literals containing HTML are NOT corrupted',
	(function() {
		var input = "if (x) {\n\tvar html = ' </div>';\n\tvar h2 = '<span>x</span>';\n}";
		var output = runRouter(input, 'auto', false);
		// Normalize: collapse whitespace, lowercase. Output must contain
		// the same characters as input (modulo whitespace).
		function norm(s) { return s.replace(/\s+/g, '').toLowerCase(); }
		return norm(input) === norm(output) ? 'preserved' : 'CORRUPTED (input: ' + JSON.stringify(input) + ', output: ' + JSON.stringify(output) + ')';
	})(),
	'preserved'
);

assertEqual(
	'js mode — formatBraceCode protects template literal ${...}',
	runRouter('var s = `hello ${user.name}; end`;\nif(x){foo();}', 'js', false),
	// Template literal stays on one line (its body is token-protected so
	// the `;` inside doesn't trigger a line break, and `${...}` braces
	// don't drive indentation). `if(x){...}` splits as formatBraceCode
	// always does: `{` keeps its line, body indents +1, `}` outdents.
	'var s = `hello ${user.name}; end`;\nif(x){\n\tfoo();\n}'
);

assertEqual(
	'js mode — formatBraceCode protects regex literal',
	runRouter('var r = /\\d+;\\s+/g;\nif(x){y();}', 'js', false),
	// Regex literal not split on `;` inside the pattern.
	'var r = /\\d+;\\s+/g;\nif(x){\n\ty();\n}'
);

assertEqual(
	'js mode — leading CFML comment header preserved verbatim',
	runRouter('<!--- file header --->\nfunction f(){return 1;}', 'js', false),
	'<!--- file header --->\nfunction f(){\n\treturn 1;\n}'
);

assertEqual(
	'js mode — js mode is idempotent (output of formatBraceCode is a fixed point)',
	(function() {
		var pass1 = runRouter('function f(){var r = /a;b/g;\nreturn `${1};${2}`;}', 'js', false);
		return runRouter(pass1, 'js', false) === pass1 ? 'idempotent' : 'NOT idempotent';
	})(),
	'idempotent'
);

/* Regression: multi-line JS object literals between CFML tags must not
 * drift indent. Previous heuristic `includes("{") && !includes("}")` only
 * decremented ONCE for a line containing two trailing `}`, leaking +1
 * indent per array entry. Reproduced from sample/ai_chatbox_js_runtime_*.cfm. */
assertEqual(
	'js array of object literals between cfml tags closes back to base indent',
	runRouter(
		'function f() {\nreturn [\n{ a: 1, args: {} },\n{ a: 2, b: 3,\n  args: { x: 1, y: 2 } },\n{ a: 4, args: { nested: { z: 9 } } }\n];\n}',
		'cfml', false
	),
	'function f() {\n\treturn [\n\t\t{ a: 1, args: {} },\n\t\t{ a: 2, b: 3,\n\t\t\targs: { x: 1, y: 2 } },\n\t\t{ a: 4, args: { nested: { z: 9 } } }\n\t];\n}'
);

assertEqual(
	'trailing multi-close `} },` decrements two levels at once',
	runRouter(
		'function f() {\nreturn {\nouter: {\ninner: 1\n} };\n}',
		'cfml', false
	),
	'function f() {\n\treturn {\n\t\touter: {\n\t\t\tinner: 1\n\t\t} };\n}'
);

/* Regression: regex literals containing `[` `]` must not count as
 * brackets. Repro: sample/ai_chatbox_js_runtime_send.cfm had a
 *   var markers = [
 *       /\n\s*\[OBSERVER CRITIC\b[\s\S]*$/i,
 *       ...
 *   ];
 * block where each regex contributed 2 opens (`\[` + `[\s\S]`) but only
 * 1 close (`]`), leaking +3 indent across 3 lines so the final closing
 * `}` of the outer async function landed at depth 3 instead of 0.
 *
 * Fix: countBracesOutsideStrings tracks lastSig and treats `/` in
 * operator position as a regex literal opener, scanning to the matching
 * `/` (respecting `\` escapes and `[...]` character classes). */
assertEqual(
	'regex literal `[\\s\\S]` does not leak indent',
	runRouter(
		'function f() {\nvar arr = [\n/\\[a\\][\\s\\S]*$/i,\n/\\[b\\][\\s\\S]*$/i\n];\n}',
		'cfml', false
	),
	'function f() {\n\tvar arr = [\n\t\t/\\[a\\][\\s\\S]*$/i,\n\t\t/\\[b\\][\\s\\S]*$/i\n\t];\n}'
);

assertEqual(
	'division operator vs regex literal disambiguation',
	runRouter(
		// `x / y` — division (lastSig=value after `x`). `var r = /a[b]/g`
		// — regex (lastSig=operator after `=`). Both balance properly.
		'function f() {\nvar z = x / y;\nvar r = /a[b]/g;\nif(z){}\n}',
		'cfml', false
	),
	'function f() {\n\tvar z = x / y;\n\tvar r = /a[b]/g;\n\tif(z){}\n}'
);

assertEqual(
	'braces inside string literals do not affect indent',
	runRouter(
		'function f() {\nvar s = "if (x) { y(); } else { z(); }";\nvar t = 1;\n}',
		'cfml', false
	),
	'function f() {\n\tvar s = "if (x) { y(); } else { z(); }";\n\tvar t = 1;\n}'
);

/* Phase 3 — WHERE hoisting + split-format-recombine unit tests.
 *   - splitCfqueryBodyAtCfifTree: slice {pre, treeLines, post}
 *   - detectAllLeavesStartWithWhere: precondition for hoisting
 *   - stripWhereFromLeaves: strip `where ` from leaf code lines
 *   - formatStrippedTree: cfif depth tracking + body keyword uppercase
 *   - normalizeSQLEqualsSpacing: ` = ` around standalone `=`, skip <=>=!=
 */
(function runPhase3UnitTests() {
	var ctx = makeContext('', 'sql').context;
	var split = ctx.splitCfqueryBodyAtCfifTree;
	var detect = ctx.detectAllLeavesStartWithWhere;
	var strip = ctx.stripWhereFromLeaves;
	var fmtTree = ctx.formatStrippedTree;
	var normEq = ctx.normalizeSQLEqualsSpacing;

	assertEqual('splitCfqueryBodyAtCfifTree exists', typeof split, 'function');
	assertEqual('detectAllLeavesStartWithWhere exists', typeof detect, 'function');
	assertEqual('stripWhereFromLeaves exists', typeof strip, 'function');
	assertEqual('formatStrippedTree exists', typeof fmtTree, 'function');
	assertEqual('normalizeSQLEqualsSpacing exists', typeof normEq, 'function');

	// splitCfqueryBodyAtCfifTree
	var splitResult = split('select a\nfrom t\n<cfif x>\nwhere a = 1\n<cfelse>\nwhere a = 2\n</cfif>\nand b = 3');
	assertEqual('split: pre captured', splitResult.pre, 'select a\nfrom t');
	assertEqual('split: post captured', splitResult.post, 'and b = 3');
	assertEqual('split: tree line count', String(splitResult.treeLines.length), '5');

	// no cfif → null
	assertEqual('split: no cfif returns null', split('select 1'), null);

	// detectAllLeavesStartWithWhere — true case
	assertEqual(
		'detect: all leaves start with where → true',
		detect(['<cfif x>', 'where a = 1', '<cfelse>', 'where b = 2', '</cfif>']),
		true
	);
	// false case — one leaf without `where`
	assertEqual(
		'detect: one leaf without where → false',
		detect(['<cfif x>', 'where a = 1', '<cfelse>', 'and b = 2', '</cfif>']),
		false
	);
	// empty leaves → false
	assertEqual(
		'detect: no leaves at all → false',
		detect(['<cfif x>', '<cfelse>', '</cfif>']),
		false
	);

	// stripWhereFromLeaves
	var stripped = strip(['<cfif x>', '\twhere a = 1', '<cfelse>', '\twhere b = 2', '</cfif>']);
	assertEqual('strip: leaf 1 where removed', stripped[1], '\ta = 1');
	assertEqual('strip: leaf 2 where removed', stripped[3], '\tb = 2');
	assertEqual('strip: cfif tag unchanged', stripped[0], '<cfif x>');

	// formatStrippedTree
	var treeOut = fmtTree(['<cfif x>', 'a = 1', '<cfelseif y>', 'b = 2', '<cfelse>', 'c = 3', '</cfif>']);
	assertEqual(
		'formatStrippedTree: cfif/cfelseif/cfelse at depth 1, body at depth 2, body keywords uppercased',
		treeOut,
		'\t<cfif x>\n\t\ta = 1\n\t<cfelseif y>\n\t\tb = 2\n\t<cfelse>\n\t\tc = 3\n\t</cfif>'
	);

	// formatStrippedTree with nested cfif
	var nestedOut = fmtTree(['<cfif a>', '<cfif b>', 'x = 1', '</cfif>', '</cfif>']);
	assertEqual(
		'formatStrippedTree: nested cfif gets depth 1/2/3 indent',
		nestedOut,
		'\t<cfif a>\n\t\t<cfif b>\n\t\t\tx = 1\n\t\t</cfif>\n\t</cfif>'
	);

	// normalizeSQLEqualsSpacing
	assertEqual('normEq: a=b → a = b', normEq('a=b'), 'a = b');
	assertEqual('normEq: a = b unchanged', normEq('a = b'), 'a = b');
	assertEqual('normEq: a<=b unchanged', normEq('a<=b'), 'a<=b');
	assertEqual('normEq: a>=b unchanged', normEq('a>=b'), 'a>=b');
	assertEqual('normEq: a!=b unchanged', normEq('a!=b'), 'a!=b');
	assertEqual('normEq: a==b unchanged', normEq('a==b'), 'a==b');
	assertEqual(
		'normEq: WHERE x=1 AND y=2 → spaces around both',
		normEq('WHERE x=1 AND y=2'),
		'WHERE x = 1 AND y = 2'
	);
})();

/* Phase 2 — CFML normalization layer unit tests.
 * normalizeCFMLTagInternals: lowercase tag/attr names, lowercase cfsqltype
 * values, normalize attribute spacing, uppercase CFML operators in
 * expression tags, camelCase CFML built-in functions.
 */
(function runCFMLNormalizationTests() {
	var ctx = makeContext('', 'sql').context;
	var norm = ctx.normalizeCFMLTagInternals;
	var normText = ctx.normalizeCFMLTagsInSafeText;
	assertEqual('normalizeCFMLTagInternals exists', typeof norm, 'function');
	assertEqual('normalizeCFMLTagsInSafeText exists', typeof normText, 'function');

	// Tag name lowercase
	assertEqual(
		'lowercase tag name + attr names',
		norm('<CFQUERYPARAM VALUE="#x#" CFSQLTYPE="CF_SQL_VARCHAR">'),
		'<cfqueryparam value="#x#" cfsqltype="cf_sql_varchar">'
	);

	// Multi-space normalization
	assertEqual(
		'multi-space between attrs collapses to single space',
		norm('<cfqueryparam  value="a"  cfsqltype="b">'),
		'<cfqueryparam value="a" cfsqltype="b">'
	);

	// cfsqltype CF_SQL_* value lowercase
	assertEqual(
		'cfsqltype CF_SQL_INTEGER value lowercased',
		norm('<cfqueryparam value="1" cfsqltype="CF_SQL_INTEGER">'),
		'<cfqueryparam value="1" cfsqltype="cf_sql_integer">'
	);

	// cfif expression — operator uppercase
	assertEqual(
		'cfif uppercases is/or/and operators',
		norm('<cfif x is "y" and z or w eq 1>'),
		'<cfif x IS "y" AND z OR w EQ 1>'
	);

	// cfif expression — preserve strings (operator-name inside string not touched)
	assertEqual(
		'cfif preserves operator-name substring inside string',
		norm('<cfif x is "is_active">'),
		'<cfif x IS "is_active">'
	);

	// cfif expression — built-in function camelCase
	assertEqual(
		'cfif camelCases isdefined/structkeyexists',
		norm('<cfif isdefined("foo") and structkeyexists(session, "x")>'),
		'<cfif isDefined("foo") AND structKeyExists(session, "x")>'
	);

	// cfelseif also gets expression treatment
	assertEqual(
		'cfelseif uppercases operators + camelCases functions',
		norm('<cfelseif arraylen(x) gte 1 and isnumeric(y)>'),
		'<cfelseif arrayLen(x) GTE 1 AND isNumeric(y)>'
	);

	// Closing tags
	assertEqual(
		'lowercase closing tag name',
		norm('</CFIF>'),
		'</cfif>'
	);

	// CFML markup comments untouched
	assertEqual(
		'cfml markup comment preserved verbatim',
		norm('<!--- CFQUERYPARAM untouched --->'),
		'<!--- CFQUERYPARAM untouched --->'
	);

	// String-aware walker: cfif inside SQL string is NOT normalized
	assertEqual(
		'cfif text inside SQL string is not normalized',
		normText("select '<cfif y>' from t"),
		"select '<cfif y>' from t"
	);

	// String-aware walker: real cfif outside string IS normalized
	assertEqual(
		'real cfif outside string is normalized',
		normText('select x from t <cfif Y IS "z">where id=1</cfif>'),
		'select x from t <cfif Y IS "z">where id=1</cfif>'
	);

	// String-aware walker: mixed — string with cfif text + real cfif
	assertEqual(
		'mixed string-cfif + real-cfif: only real one normalized',
		normText("select '<CFIF>' from t <cfif x IS \"y\">where id=1</cfif>"),
		"select '<CFIF>' from t <cfif x IS \"y\">where id=1</cfif>"
	);
})();

/* protectStructuralCFMLAsColumnMarkers + restoreStructuralCFMLMarkers
 * Unit tests for the marker-injection round-trip. Verify each own-line
 * CFML control-flow tag becomes a column-friendly marker and is restored
 * with correct body indentation.
 */
(function runMarkerRoundTripTests() {
	var ctx = makeContext('', 'sql').context;

	var protect = ctx.protectStructuralCFMLAsColumnMarkers;
	var restore = ctx.restoreStructuralCFMLMarkers;
	assertEqual('protect helper exists', typeof protect, 'function');
	assertEqual('restore helper exists', typeof restore, 'function');

	var simpleBody = 'select a,\n<cfif x>\nb,\n</cfif>\nc';
	var marked = protect(simpleBody);
	assertEqual('protect produces 2 markers (open + close)', marked.markers.length, 2);
	assertEqual('protect open kind', marked.markers[0].kind, 'OPEN');
	assertEqual('protect close kind', marked.markers[1].kind, 'CLOSE');
	assertEqual(
		'protect replaces own-line tags with __cfm_N__,',
		marked.code,
		'select a,\n__cfm_0__,\nb,\n__cfm_1__,\nc'
	);

	// Simulate sql-formatter output (each line at 1-tab indent under SELECT)
	var fakeFormatted = '\t__cfm_0__,\n\tb,\n\t__cfm_1__,\n\tc';
	var restored = restore(fakeFormatted, marked.markers);
	assertEqual(
		'restore replaces markers and indents body +1 tab',
		restored,
		'\t<cfif x>\n\t\tb,\n\t</cfif>\n\tc'
	);

	// Chain test: cfif/cfelseif/cfelse/</cfif>
	var chainBody = '<cfif a>\nx,\n<cfelseif b>\ny,\n<cfelse>\nz,\n</cfif>';
	var chainMarked = protect(chainBody);
	assertEqual('chain produces 4 markers', chainMarked.markers.length, 4);
	assertEqual('chain open', chainMarked.markers[0].kind, 'OPEN');
	assertEqual('chain elseif', chainMarked.markers[1].kind, 'SIBLING');
	assertEqual('chain else', chainMarked.markers[2].kind, 'SIBLING');
	assertEqual('chain close', chainMarked.markers[3].kind, 'CLOSE');

	var chainFake = '\t__cfm_0__,\n\tx,\n\t__cfm_1__,\n\ty,\n\t__cfm_2__,\n\tz,\n\t__cfm_3__,';
	var chainRestored = restore(chainFake, chainMarked.markers);
	assertEqual(
		'chain restore: cfelseif/cfelse stay at parent depth, body lines +1',
		chainRestored,
		'\t<cfif a>\n\t\tx,\n\t<cfelseif b>\n\t\ty,\n\t<cfelse>\n\t\tz,\n\t</cfif>'
	);

	// Failure case: orphan marker
	var orphanFake = '\tselect a,\n\t__cfm_99__,\n\tb';
	var orphanResult = restore(orphanFake, marked.markers);
	assertEqual('orphan marker returns null', orphanResult, null);

	// Failure case: unbalanced (missing close)
	var unbalanced = protect('<cfif x>\na,\nb');
	var unbalancedFake = '\t__cfm_0__,\n\ta,\n\tb';
	var unbalancedResult = restore(unbalancedFake, unbalanced.markers);
	assertEqual('unbalanced (no close) returns null', unbalancedResult, null);
})();

/* bodyHasStructuralCFMLControlFlow — gates whether deep-format runs on a
 * cfquery body. "Structural" = a CFML control-flow tag occupying its own
 * line in the input, which the SQL formatters cannot preserve.
 *
 * Inline conditionals (e.g.,  WHERE x = 1 <cfif y>AND z = 2</cfif> )
 * are NOT considered structural and continue through deep-format.
 */
(function runStructuralControlFlowDetectorTests() {
	var ctx = makeContext('', 'sql');
	var fn = ctx.context.bodyHasStructuralCFMLControlFlow;
	assertEqual('structural detector exists', typeof fn, 'function');

	// Structural cases — own-line CFML control-flow tags
	assertEqual('detects <cfif> on own line',
		fn('select 1\n<cfif x>\nwhere a=1\n</cfif>'), true);
	assertEqual('detects nested <cfelseif> chain on own lines',
		fn('select 1\n<cfif a>\nwhere x=1\n<cfelseif b>\nwhere x=2\n<cfelse>\nwhere x=3\n</cfif>'), true);
	assertEqual('detects </cfif> on own line',
		fn('select 1\nwhere a=1\n</cfif>'), true);
	assertEqual('detects <cfloop> on own line',
		fn('select 1\n<cfloop list="x" index="i">\nor x=#i#\n</cfloop>'), true);
	assertEqual('detects <cfswitch> + <cfcase> on own lines',
		fn('select 1\n<cfswitch expression="#x#">\n<cfcase value="a">\nwhere y=1\n</cfcase>\n</cfswitch>'), true);
	assertEqual('detects with surrounding whitespace',
		fn('select 1\n    <cfif x>\nwhere a=1\n    </cfif>'), true);

	// Inline cases — must NOT trigger
	assertEqual('inline <cfif> in same line as SQL is not structural',
		fn('select * from t <cfif x>where a=1</cfif>'), false);
	assertEqual('inline <cfif> with content trailing is not structural',
		fn('where x = 1 <cfif y>and z = 2</cfif>'), false);
	assertEqual('plain SQL is clean',
		fn('select * from t where x = 1'), false);
	assertEqual('cfqueryparam is not control flow',
		fn('where id = <cfqueryparam value="#id#" cfsqltype="cf_sql_integer">'), false);
	assertEqual('non-string input handled',
		fn(undefined), false);
})();

assertEqual(
	'cfquery with structural cfif chain is left to beautifyCFML (no SQL re-format)',
	runRouter(
		'<cfquery name="q">\nselect *\nfrom t\n<cfif a>\nwhere x = 1\n<cfelseif b>\nwhere x = 2\n<cfelse>\nwhere x = 3\n</cfif>\n</cfquery>',
		'cfml',
		true
	),
	'<cfquery name="q">\n\tselect *\n\tfrom t\n\t<cfif a>\n\t\twhere x = 1\n\t<cfelseif b>\n\t\twhere x = 2\n\t<cfelse>\n\t\twhere x = 3\n\t</cfif>\n</cfquery>'
);

assertEqual(
	'cfquery with nested cfif preserves three-level indentation',
	runRouter(
		'<cfquery name="q">\nselect *\nfrom t\n<cfif a>\n<cfif b>\nwhere x = 1\n</cfif>\n</cfif>\n</cfquery>',
		'cfml',
		true
	),
	'<cfquery name="q">\n\tselect *\n\tfrom t\n\t<cfif a>\n\t\t<cfif b>\n\t\t\twhere x = 1\n\t\t</cfif>\n\t</cfif>\n</cfquery>'
);

assertEqual(
	'cfquery with hand-crafted subquery indent preserves the user verbatim layout',
	runRouter(
		'<cfquery name="q">\n\t\tselect *\n\t\tfrom t\n\t\t<cfif a>\n\t\t\twhere x = (\tselect id\n\t\t\t\t\t\tfrom u\n\t\t\t\t\t\t\twhere u.id = t.uid\n\t\t\t\t\t\t\tand u.active = 1)\n\t\t<cfelse>\n\t\t\twhere x = 0\n\t\t</cfif>\n\t</cfquery>',
		'cfml',
		true
	),
	'<cfquery name="q">\n\tselect *\n\tfrom t\n\t<cfif a>\n\t\twhere x = (\tselect id\n\t\t\t\t\tfrom u\n\t\t\t\t\t\twhere u.id = t.uid\n\t\t\t\t\t\tand u.active = 1)\n\t<cfelse>\n\t\twhere x = 0\n\t</cfif>\n</cfquery>'
);

assertEqual(
	'cfquery with cfml comment between cfif siblings stays aligned',
	runRouter(
		'<cfquery name="q">\n\tselect *\n\tfrom t\n\t<cfif a>\n\t\twhere x = 1\n\t<!--- pin --->\n\t<cfelseif b>\n\t\twhere x = 2\n\t</cfif>\n</cfquery>',
		'cfml',
		true
	),
	'<cfquery name="q">\n\tselect *\n\tfrom t\n\t<cfif a>\n\t\twhere x = 1\n\t<!--- pin --->\n\t<cfelseif b>\n\t\twhere x = 2\n\t</cfif>\n</cfquery>'
);

/* End-to-end: marker approach with sql-formatter loaded — covers the
 * "SELECT-list cfif" success case where Pro SQL achieves full re-format
 * (uppercase keywords + each column on own line) WITH cfif structure
 * preserved + body indented +1.
 */
(function runMarkerEndToEndTests() {
	var vendorPath = 'vendor/sql-formatter.min.js';
	if (!fs.existsSync(vendorPath)) {
		console.log('SKIP marker e2e tests (vendor bundle missing): ' + vendorPath);
		return;
	}
	var sqlFormatter = require('../' + vendorPath);
	var proSrc = fs.readFileSync('js/pro-sql.js', 'utf8');
	var browserCodeMarker = scripts.map(function(file) {
		return fs.readFileSync(file, 'utf8');
	}).join('\n');

	var input = '<cfquery name="q">\n\t\tselect a,\n\t\t<cfif x>\n\t\tb,\n\t\t</cfif>\n\t\tc\n\t\tfrom t\n\t</cfquery>';
	var elements = {
		language: { value: 'cfml' },
		split_html_tag: { checked: false },
		auto_copy: { checked: false },
		auto_clear: { checked: false },
		auto_clear_output: { checked: false },
		deep_sql: { checked: true },
		deep_css: { checked: false },
		deep_js: { checked: false },
		pro_sql: { checked: true },
		pro_sql_dialect: { value: 'mysql' },
		input: { value: input },
		output: { value: '', select: function() {} }
	};
	var ctx = {
		console: { log: function() {} },
		window: { sqlFormatter: sqlFormatter },
		document: {
			getElementById: function(id) { return elements[id]; },
			execCommand: function() { return true; },
			querySelector: function() { return { prepend: function() {}, textContent: '' }; },
			createElement: function() { return { className: '', innerHTML: '', style: {setProperty: function(){}}, classList: {add:function(){},remove:function(){}}, addEventListener: function(){}, remove: function(){} }; },
			addEventListener: function() {},
			readyState: 'complete'
		},
		setTimeout: setTimeout,
		clearTimeout: clearTimeout
	};
	vm.createContext(ctx);
	vm.runInContext(proSrc + '\n' + browserCodeMarker, ctx);
	ctx.beautifyCodes();

	assertEqual(
		'marker e2e: SELECT-list cfif gets full Pro SQL + body +1 indent',
		elements.output.value,
		'<cfquery name="q">\n\tSELECT\n\t\ta,\n\t\t<cfif x>\n\t\t\tb,\n\t\t</cfif>\n\t\tc\n\tFROM\n\t\tt\n</cfquery>'
	);

	/* Phase 1 — Lite Pro SQL on verbatim path: WHERE-cfif fallback path
	 * (where marker injection can't form valid SQL) still gets SQL keyword
	 * uppercased while layout is preserved verbatim.
	 */
	var inputWhereCfif = '<cfquery name="q">\n\t\tselect a, b\n\t\tfrom t\n\t\t\t<cfif x>\n\t\t\t\twhere a = 1\n\t\t\t<cfelse>\n\t\t\t\twhere a = 2\n\t\t\t</cfif>\n\t\t\tand b = 3\n\t</cfquery>';
	var elements2 = {
		language: { value: 'cfml' },
		split_html_tag: { checked: false },
		auto_copy: { checked: false },
		auto_clear: { checked: false },
		auto_clear_output: { checked: false },
		deep_sql: { checked: true },
		deep_css: { checked: false },
		deep_js: { checked: false },
		pro_sql: { checked: true },
		pro_sql_dialect: { value: 'mysql' },
		input: { value: inputWhereCfif },
		output: { value: '', select: function() {} }
	};
	var ctx2 = {
		console: { log: function() {} },
		window: { sqlFormatter: sqlFormatter },
		document: {
			getElementById: function(id) { return elements2[id]; },
			execCommand: function() { return true; },
			querySelector: function() { return { prepend: function() {}, textContent: '' }; },
			createElement: function() { return { className: '', innerHTML: '', style: {setProperty: function(){}}, classList: {add:function(){},remove:function(){}}, addEventListener: function(){}, remove: function(){} }; },
			addEventListener: function() {},
			readyState: 'complete'
		},
		setTimeout: setTimeout,
		clearTimeout: clearTimeout
	};
	vm.createContext(ctx2);
	vm.runInContext(proSrc + '\n' + browserCodeMarker, ctx2);
	ctx2.beautifyCodes();
	// Phase 3 now activates on this input (all leaves start with `where`):
	// WHERE is hoisted out of cfif branches, SELECT/FROM/WHERE on own lines,
	// cfif preserved under WHERE with body indented +1.
	assertEqual(
		'Phase 3 e2e: WHERE-cfif with all-where leaves gets hoisted + full Pro SQL backbone',
		elements2.output.value,
		'<cfquery name="q">\n\tSELECT\n\t\ta,\n\t\tb\n\tFROM\n\t\tt\n\tWHERE\n\t\t<cfif x>\n\t\t\ta = 1\n\t\t<cfelse>\n\t\t\ta = 2\n\t\t</cfif>\n\t\tAND b = 3\n</cfquery>'
	);
})();

/* Pro SQL — vendor bundle integration smoke tests.
 * Loaded into its own VM context so it does not pollute the existing
 * sync harness with a real (CommonJS-resolved) sql-formatter.
 */
(function runProSQLTests() {
	var vendorPath = 'vendor/sql-formatter.min.js';
	if (!fs.existsSync(vendorPath)) {
		console.log('SKIP Pro SQL tests (vendor bundle missing): ' + vendorPath);
		return;
	}
	var sqlFormatter = require('../' + vendorPath);
	var proSrc = fs.readFileSync('js/pro-sql.js', 'utf8');
	var proCtx = {
		window: { sqlFormatter: sqlFormatter },
		console: { log: function() {} }
	};
	vm.createContext(proCtx);
	vm.runInContext(proSrc, proCtx);

	assertEqual('pro sql exposes 16 dialects', proCtx.PRO_SQL_DIALECTS.length, 16);
	assertEqual('pro sql isLoaded true with stub', proCtx.isProSQLLoaded(), true);
	assertEqual(
		'pro sql mysql basic select',
		proCtx.formatProSQLSync('select id, name from users where status=1', 'mysql'),
		'SELECT\n\tid,\n\tname\nFROM\n\tusers\nWHERE\n\tstatus = 1'
	);
	assertEqual(
		'pro sql postgresql order by 1',
		proCtx.formatProSQLSync('select id from t order by 1', 'postgresql'),
		'SELECT\n\tid\nFROM\n\tt\nORDER BY\n\t1'
	);
	assertEqual(
		'pro sql falls back to standard for unknown dialect',
		proCtx.formatProSQLSync('select 1', 'made-up-dialect'),
		'SELECT\n\t1'
	);
	try {
		var allDialectsOk = proCtx.PRO_SQL_DIALECTS.every(function(d) {
			proCtx.formatProSQLSync('select 1 from t', d.id);
			return true;
		});
		assertEqual('pro sql every shipped dialect accepts simple SELECT', allDialectsOk, true);
	} catch (err) {
		console.log('FAIL: pro sql dialect throws — ' + err.message);
		process.exitCode = 1;
	}
})();

/* ===========================================================================
 * Phase 4 — AND-leaves hoisting test corpus (T1–T10)
 *
 * These tests pin the EXPECTED behavior after Phase 4 lands. Before Phase 4
 * is implemented they will all FAIL — that is intentional. The failing
 * outputs prove they actually exercise the code path Phase 4 will fix.
 *
 * Pattern A target: cfquery body has SELECT/FROM/WHERE backbone OUTSIDE the
 * cfif tree, and every cfif leaf merely appends `and xxx` (or `or xxx`)
 * clauses. Phase 4 formats the backbone via sql-formatter, leaves the cfif
 * tree structurally intact, and uppercases keywords inside leaves.
 *
 * Each test loads vendor sql-formatter into its own vm context (same
 * pattern as runProSQLTests / runMarkerEndToEndTests above).
 * =========================================================================== */
(function runPhase4AndLeavesTests() {
	var fs2 = require('fs');
	var vendorPath = 'vendor/sql-formatter.min.js';
	if (!fs2.existsSync(vendorPath)) {
		console.log('SKIP Phase 4 tests (vendor bundle missing): ' + vendorPath);
		return;
	}
	var sqlFormatter2 = require('../' + vendorPath);
	var proSrc2 = fs2.readFileSync('js/pro-sql.js', 'utf8');
	var browserCode2 = scripts.map(function(file) { return fs2.readFileSync(file, 'utf8'); }).join('\n');

	function runProSQL(input, dialect) {
		var elements = {
			language: { value: 'cfml' },
			split_html_tag: { checked: false },
			auto_copy: { checked: false }, auto_clear: { checked: false }, auto_clear_output: { checked: false },
			deep_sql: { checked: true }, deep_css: { checked: false }, deep_js: { checked: false },
			pro_sql: { checked: true }, pro_sql_dialect: { value: dialect || 'mysql' },
			input: { value: input }, output: { value: '', select: function() {} }
		};
		var ctx = {
			console: { log: function() {}, warn: function() {} },
			window: { sqlFormatter: sqlFormatter2 },
			document: {
				getElementById: function(id) { return elements[id]; },
				execCommand: function() { return true; },
				querySelector: function() { return { prepend: function() {}, textContent: '' }; },
				createElement: function() { return { className: '', innerHTML: '', style:{setProperty:function(){}}, classList:{add:function(){},remove:function(){}}, addEventListener:function(){}, remove:function(){} }; },
				addEventListener: function() {}, readyState: 'complete'
			},
			setTimeout: setTimeout, clearTimeout: clearTimeout
		};
		vm.createContext(ctx);
		vm.runInContext(proSrc2 + '\n' + browserCode2, ctx);
		ctx.beautifyCodes();
		return elements.output.value;
	}

	// T1 — Single cfif, single `and` leaf — the simplest Pattern A.
	assertEqual(
		'Phase4 T1: single cfif with single AND leaf',
		runProSQL('<cfquery name="q">\nSELECT a FROM t WHERE x = 1\n<cfif y>\nand z = 2\n</cfif>\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\tx = 1\n\t\t<cfif y>\n\t\t\tAND z = 2\n\t\t</cfif>\n</cfquery>'
	);

	// T2 — cfif/cfelse, both leaves AND.
	assertEqual(
		'Phase4 T2: cfif/cfelse with both AND leaves',
		runProSQL('<cfquery name="q">\nSELECT a FROM t WHERE x = 1\n<cfif y>\nand z = 2\n<cfelse>\nand z = 3\n</cfif>\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\tx = 1\n\t\t<cfif y>\n\t\t\tAND z = 2\n\t\t<cfelse>\n\t\t\tAND z = 3\n\t\t</cfif>\n</cfquery>'
	);

	// T3 — cfif/cfelseif/cfelse with all AND.
	assertEqual(
		'Phase4 T3: cfif/cfelseif/cfelse with three AND leaves',
		runProSQL('<cfquery name="q">\nSELECT a FROM t WHERE x = 1\n<cfif y EQ 1>\nand z = 2\n<cfelseif y EQ 2>\nand z = 3\n<cfelse>\nand z = 4\n</cfif>\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\tx = 1\n\t\t<cfif y EQ 1>\n\t\t\tAND z = 2\n\t\t<cfelseif y EQ 2>\n\t\t\tAND z = 3\n\t\t<cfelse>\n\t\t\tAND z = 4\n\t\t</cfif>\n</cfquery>'
	);

	// T4 — Multiple sibling cfif blocks at the same depth.
	assertEqual(
		'Phase4 T4: three sibling cfif blocks each appending one AND',
		runProSQL('<cfquery name="q">\nSELECT a FROM t WHERE x = 1\n<cfif y1>\nand a = 1\n</cfif>\n<cfif y2>\nand b = 2\n</cfif>\n<cfif y3>\nand c = 3\n</cfif>\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\tx = 1\n\t\t<cfif y1>\n\t\t\tAND a = 1\n\t\t</cfif>\n\t\t<cfif y2>\n\t\t\tAND b = 2\n\t\t</cfif>\n\t\t<cfif y3>\n\t\t\tAND c = 3\n\t\t</cfif>\n</cfquery>'
	);

	// T5 — Multi-line `and (...)` continuation. The leaf body has 2 lines:
	// first starts with `and`, second with `or`. Both pass precondition.
	// Note: function names (`lower`) inside cfif leaves stay lowercase —
	// formatStrippedTree uppercases keywords (AND, OR, LIKE) but not
	// function calls. Pre-tree and post-tree go through formatProSQLSync
	// which DOES uppercase functions; this asymmetry is documented and
	// matches Phase 3 behavior.
	assertEqual(
		'Phase4 T5: leaf body with multi-line AND/OR continuation',
		runProSQL("<cfquery name=\"q\">\nSELECT a FROM t WHERE x = 1\n<cfif y>\nand (lower(a) LIKE '%x%'\nor lower(b) LIKE '%y%')\n</cfif>\n</cfquery>"),
		"<cfquery name=\"q\">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\tx = 1\n\t\t<cfif y>\n\t\t\tAND (lower(a) LIKE '%x%'\n\t\t\tOR lower(b) LIKE '%y%')\n\t\t</cfif>\n</cfquery>"
	);

	// T6 — Tree contains <!--- comment --->. Comment passes through verbatim.
	assertEqual(
		'Phase4 T6: tree with CFML markup comment between cfif and AND leaf',
		runProSQL('<cfquery name="q">\nSELECT a FROM t WHERE x = 1\n<cfif y>\n<!--- a note --->\nand z = 2\n</cfif>\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\tx = 1\n\t\t<cfif y>\n\t\t\t<!--- a note --->\n\t\t\tAND z = 2\n\t\t</cfif>\n</cfquery>'
	);

	// T7 — post-tree segment with GROUP BY + ORDER BY. Both must be re-formatted.
	assertEqual(
		'Phase4 T7: post-tree GROUP BY + ORDER BY both formatted',
		runProSQL('<cfquery name="q">\nSELECT a, count(*) FROM t WHERE x = 1\n<cfif y>\nand z = 2\n</cfif>\nGROUP BY a\nORDER BY a desc\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT\n\t\ta,\n\t\tCOUNT(*)\n\tFROM\n\t\tt\n\tWHERE\n\t\tx = 1\n\t\t<cfif y>\n\t\t\tAND z = 2\n\t\t</cfif>\n\tGROUP BY\n\t\ta\n\tORDER BY\n\t\ta DESC\n</cfquery>'
	);

	// T8 — Real-world fr_fg_vari_qty #1 shape (simplified): pre-tree has
	// base WHERE conditions, multiple cfif blocks (one with cfelseif), then
	// GROUP BY + ORDER BY post-tree.
	assertEqual(
		'Phase4 T8: real-world shape — base WHERE + 2 cfif blocks + GROUP/ORDER',
		runProSQL("<cfquery name=\"q\">\nSELECT a, sum(b) AS total FROM t WHERE companyfn = 'x'\nand date_trans between '2020-01-01' and '2020-12-31'\n<cfif rec_code is \"final\">\nand tag_app = 'y'\n<cfelseif rec_code is \"draft\">\nand tag_app = 'n'\n</cfif>\n<cfif filter_unique neq \"\">\nand (filter = 'foo')\n</cfif>\nGROUP BY a\nORDER BY lower(a)\n</cfquery>"),
		"<cfquery name=\"q\">\n\tSELECT\n\t\ta,\n\t\tSUM(b) AS total\n\tFROM\n\t\tt\n\tWHERE\n\t\tcompanyfn = 'x'\n\t\tAND date_trans BETWEEN '2020-01-01' AND '2020-12-31'\n\t\t<cfif rec_code IS \"final\">\n\t\t\tAND tag_app = 'y'\n\t\t<cfelseif rec_code IS \"draft\">\n\t\t\tAND tag_app = 'n'\n\t\t</cfif>\n\t\t<cfif filter_unique NEQ \"\">\n\t\t\tAND (filter = 'foo')\n\t\t</cfif>\n\tGROUP BY\n\t\ta\n\tORDER BY\n\t\tLOWER(a)\n</cfquery>"
	);

	// T9 — Indented input with all-WHERE leaves (Phase 3 territory).
	// Phase 3 should fire BEFORE Phase 4 evaluates. Verifies Phase 4
	// doesn't interfere with the existing Phase 3 hoist behavior.
	assertEqual(
		'Phase4 T9: all-WHERE leaves still go through Phase 3, not Phase 4',
		runProSQL('<cfquery name="q">\n\tSELECT a\n\tFROM t\n\t<cfif y>\n\t\twhere x = 1\n\t<cfelse>\n\t\twhere x = 2\n\t</cfif>\n\tand b = 3\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\t<cfif y>\n\t\t\tx = 1\n\t\t<cfelse>\n\t\t\tx = 2\n\t\t</cfif>\n\t\tAND b = 3\n</cfquery>'
	);

	// T8b — Regression: unquoted attribute value with #hash-expression# that
	// has internal whitespace (e.g., `value=#fn('#x#/#y# ')#`) must NOT
	// truncate at the inner space. This bug was found while validating Phase
	// 4 on fr_fg_vari_qty.cfm where BETWEEN clauses use TNOdateformat.
	assertEqual(
		'Phase4 T8b: cfqueryparam with #expr(...)# containing internal whitespace does NOT truncate',
		runProSQL("<cfquery name=\"q\">\nSELECT a FROM t WHERE x BETWEEN <CFQUERYPARAM VALUE=#fn('#a# ')# CFSQLTYPE=\"CF_SQL_DATE\"> AND <CFQUERYPARAM VALUE=#fn('#b# ')# CFSQLTYPE=\"CF_SQL_DATE\">\n<cfif y>\nand z = 1\n</cfif>\n</cfquery>"),
		"<cfquery name=\"q\">\n\tSELECT\n\t\ta\n\tFROM\n\t\tt\n\tWHERE\n\t\tx BETWEEN <cfqueryparam value=#fn('#a# ')# cfsqltype=\"cf_sql_date\"> AND <cfqueryparam value=#fn('#b# ')# cfsqltype=\"cf_sql_date\">\n\t\t<cfif y>\n\t\t\tAND z = 1\n\t\t</cfif>\n</cfquery>"
	);

	// T10 — Safety: leaf contains `union select` (Pattern D — cfif appends
	// a whole UNION arm). Phase 4 precondition fails (leaves don't all
	// start with and/or). MUST fall back to Tier 2 verbatim with Lite
	// uppercase. Indented input so Tier 2 fires (not Tier 3 flat).
	// This is the zero-regression guarantee.
	assertEqual(
		'Phase4 T10: union-cfif leaf falls back to Tier 2 verbatim (no Phase 4 dispatch)',
		runProSQL('<cfquery name="q">\n\tSELECT a FROM t WHERE x = 1\n\t<cfif y>\n\t\tunion\n\t\tSELECT b FROM u WHERE z = 2\n\t</cfif>\n</cfquery>'),
		'<cfquery name="q">\n\tSELECT a FROM t WHERE x = 1\n\t<cfif y>\n\t\tUNION\n\t\tSELECT b FROM u WHERE z = 2\n\t</cfif>\n</cfquery>'
	);
})();

/* ===========================================================================
 * SQL token-equivalence invariants — Pro SQL path corruption check.
 *
 * Tokenizes input + output cfquery bodies and asserts semantic preservation:
 *
 *   • Non-keyword identifiers (column/table names)       — same order
 *   • String literals + numeric literals                 — byte-equal, same order
 *   • CFML tags (cfif/cfelse/cfqueryparam/cfloop/etc.)   — same order
 *     (case-normalized, internal-whitespace-collapsed)
 *   • CFML expressions #...#                             — byte-equal, same order
 *   • Punctuation (parens, commas, operators)            — same order
 *   • SQL comments (/* *​/ and -- and <!--- ---​>)        — same MULTISET
 *     (Phase 3/4 may legitimately move comments between cfif branches,
 *      but never drop, duplicate, or invent comments)
 *
 * EXEMPT from sequence check (allowed to merge/hoist/disappear):
 *   • SQL keywords (SELECT, WHERE, AND, OR, FROM, JOIN, etc.)
 *     because Phase 3 hoist legitimately MERGES duplicated WHERE prefixes
 *     from multiple cfif branches into a single backbone WHERE keyword.
 *
 * This block downgrades SAFETY.md's "Pro SQL Phase 4 comment placement
 * may drift" entry from "corpus-tested only" to "CI-gated invariant".
 * If a regression ever drops a column name, swaps two column literals,
 * loses a cfif branch, or vanishes a SQL comment, these assertions catch
 * it — independent of the assertEqual expected-string match.
 * =========================================================================== */
(function runProSQLTokenEquivalenceTests() {
	var vendorPath = 'vendor/sql-formatter.min.js';
	if (!fs.existsSync(vendorPath)) {
		console.log('SKIP Pro SQL token-equivalence tests (vendor bundle missing): ' + vendorPath);
		return;
	}
	var sqlFormatter = require('../' + vendorPath);
	var proSrc = fs.readFileSync('js/pro-sql.js', 'utf8');
	var browserCodeLocal = scripts.map(function(file) { return fs.readFileSync(file, 'utf8'); }).join('\n');

	function runProSQL(input, dialect) {
		var elements = {
			language: { value: 'cfml' },
			split_html_tag: { checked: false },
			auto_copy: { checked: false }, auto_clear: { checked: false }, auto_clear_output: { checked: false },
			deep_sql: { checked: true }, deep_css: { checked: false }, deep_js: { checked: false },
			pro_sql: { checked: true }, pro_sql_dialect: { value: dialect || 'mysql' },
			input: { value: input }, output: { value: '', select: function() {} }
		};
		var ctx = {
			console: { log: function() {}, warn: function() {} },
			window: { sqlFormatter: sqlFormatter },
			document: {
				getElementById: function(id) { return elements[id]; },
				execCommand: function() { return true; },
				querySelector: function() { return { prepend: function() {}, textContent: '' }; },
				createElement: function() { return { className: '', innerHTML: '', style:{setProperty:function(){}}, classList:{add:function(){},remove:function(){}}, addEventListener:function(){}, remove:function(){} }; },
				addEventListener: function() {}, readyState: 'complete'
			},
			setTimeout: setTimeout, clearTimeout: clearTimeout
		};
		vm.createContext(ctx);
		vm.runInContext(proSrc + '\n' + browserCodeLocal, ctx);
		ctx.beautifyCodes();
		return elements.output.value;
	}

	// Conservative SQL keyword set — anything in this dictionary is allowed
	// to be hoisted/merged/dropped during Pro SQL reformatting. Everything
	// else must appear in input and output in the exact same sequence.
	var SQL_KEYWORDS = {};
	[
		'select','distinct','from','where','and','or','not','in','between','like','ilike','is','null','as',
		'on','using','join','inner','left','right','full','outer','cross','natural',
		'group','by','having','order','asc','desc',
		'limit','offset','fetch','next','rows','only','first',
		'union','intersect','except','all',
		'case','when','then','else','end',
		'insert','into','values','returning',
		'update','set','delete',
		'with','merge','truncate',
		'true','false',
		'cast','over','partition','within','filter'
	].forEach(function(k) { SQL_KEYWORDS[k] = 1; });

	function tokenize(text) {
		var toks = [];
		var i = 0;
		var n = text.length;
		while (i < n) {
			var c = text[i];
			// Whitespace — dropped from output
			if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
			// CFML markup comment <!--- ... --->
			if (text.substr(i, 5) === '<!---') {
				var ce = text.indexOf('--->', i + 5);
				if (ce === -1) { toks.push({kind:'COMMENT_CFM', text: text.slice(i).replace(/\s+/g,' ').trim()}); i = n; break; }
				toks.push({kind:'COMMENT_CFM', text: text.slice(i, ce + 4).replace(/\s+/g,' ').trim()});
				i = ce + 4; continue;
			}
			// SQL line comment -- ...
			if (c === '-' && text[i+1] === '-') {
				var j = i;
				while (j < n && text[j] !== '\n') j++;
				toks.push({kind:'COMMENT_SQL', text: text.slice(i, j).replace(/\s+/g,' ').trim()});
				i = j; continue;
			}
			// SQL block comment /* ... */
			if (c === '/' && text[i+1] === '*') {
				var be = text.indexOf('*/', i + 2);
				if (be === -1) { toks.push({kind:'COMMENT_SQL', text: text.slice(i).replace(/\s+/g,' ').trim()}); i = n; break; }
				toks.push({kind:'COMMENT_SQL', text: text.slice(i, be + 2).replace(/\s+/g,' ').trim()});
				i = be + 2; continue;
			}
			// CFML tag <cfXXX...> or </cfXXX...>
			if (c === '<' && /^<\/?cf[a-z]/i.test(text.substr(i, 12))) {
				var te = text.indexOf('>', i);
				if (te === -1) { toks.push({kind:'CFML_TAG', text: text.slice(i).toLowerCase().replace(/\s+/g,' ').trim()}); i = n; break; }
				toks.push({kind:'CFML_TAG', text: text.slice(i, te + 1).toLowerCase().replace(/\s+/g,' ')});
				i = te + 1; continue;
			}
			// CFML expression #...#  (## is escaped literal #)
			if (c === '#') {
				var j = i + 1;
				while (j < n) {
					if (text[j] === '#') {
						if (text[j+1] === '#') { j += 2; continue; }
						break;
					}
					j++;
				}
				toks.push({kind:'CFML_EXPR', text: text.slice(i, j + 1)});
				i = j + 1; continue;
			}
			// String single-quoted (SQL doubled-quote escape)
			if (c === "'") {
				var j = i + 1;
				while (j < n) {
					if (text[j] === "'") {
						if (text[j+1] === "'") { j += 2; continue; }
						break;
					}
					j++;
				}
				toks.push({kind:'STRING', text: text.slice(i, j + 1)});
				i = j + 1; continue;
			}
			// String double-quoted
			if (c === '"') {
				var j = i + 1;
				while (j < n) {
					if (text[j] === '"') {
						if (text[j+1] === '"') { j += 2; continue; }
						break;
					}
					j++;
				}
				toks.push({kind:'STRING', text: text.slice(i, j + 1)});
				i = j + 1; continue;
			}
			// Number
			if (c >= '0' && c <= '9') {
				var j = i;
				while (j < n && ((text[j] >= '0' && text[j] <= '9') || text[j] === '.')) j++;
				if (j < n && (text[j] === 'e' || text[j] === 'E')) {
					j++;
					if (j < n && (text[j] === '+' || text[j] === '-')) j++;
					while (j < n && text[j] >= '0' && text[j] <= '9') j++;
				}
				toks.push({kind:'NUMBER', text: text.slice(i, j)});
				i = j; continue;
			}
			// Identifier (letter / underscore start)
			if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
				var j = i;
				while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
				var word = text.slice(i, j).toLowerCase();
				toks.push({kind: SQL_KEYWORDS[word] ? 'KEYWORD' : 'IDENT', text: word});
				i = j; continue;
			}
			// Multi-char punctuation
			if (i + 1 < n) {
				var two = text.substr(i, 2);
				if (two === '<=' || two === '>=' || two === '!=' || two === '<>' || two === '||' || two === '::') {
					toks.push({kind:'PUNCT', text: two});
					i += 2; continue;
				}
			}
			// Single-char punctuation
			toks.push({kind:'PUNCT', text: c});
			i++;
		}
		return toks;
	}

	function compareEquivalent(inTokens, outTokens) {
		function isSeqRelevant(t) {
			return t.kind !== 'COMMENT_SQL' && t.kind !== 'COMMENT_CFM' && t.kind !== 'KEYWORD';
		}
		var inSeq  = inTokens.filter(isSeqRelevant);
		var outSeq = outTokens.filter(isSeqRelevant);

		if (inSeq.length !== outSeq.length) {
			return 'sequence length mismatch — input ' + inSeq.length + ' content tokens, output ' + outSeq.length;
		}
		for (var i = 0; i < inSeq.length; i++) {
			if (inSeq[i].kind !== outSeq[i].kind || inSeq[i].text !== outSeq[i].text) {
				var ctx = inSeq.slice(Math.max(0, i-2), i+3).map(function(t) { return t.kind + ':' + t.text; }).join(' ');
				return 'token mismatch at index ' + i + '\n    input  : {' + inSeq[i].kind + ':' + JSON.stringify(inSeq[i].text) + '}\n    output : {' + outSeq[i].kind + ':' + JSON.stringify(outSeq[i].text) + '}\n    context: ' + ctx;
			}
		}

		// Comment multiset comparison — Phase 4 may shift comment position
		// across cfif branches, but multiset (count + content) is invariant.
		function commentMultiset(toks) {
			var ms = {};
			for (var k = 0; k < toks.length; k++) {
				if (toks[k].kind === 'COMMENT_SQL' || toks[k].kind === 'COMMENT_CFM') {
					var key = toks[k].kind + ':' + toks[k].text;
					ms[key] = (ms[key] || 0) + 1;
				}
			}
			return ms;
		}
		var inCM = commentMultiset(inTokens);
		var outCM = commentMultiset(outTokens);
		var allKeys = {};
		Object.keys(inCM).forEach(function(k) { allKeys[k] = 1; });
		Object.keys(outCM).forEach(function(k) { allKeys[k] = 1; });
		var keys = Object.keys(allKeys);
		for (var k = 0; k < keys.length; k++) {
			var key = keys[k];
			if ((inCM[key] || 0) !== (outCM[key] || 0)) {
				return 'comment multiset mismatch — "' + key.slice(0, 80) + '" — input count ' + (inCM[key]||0) + ', output count ' + (outCM[key]||0);
			}
		}
		return null;
	}

	function assertSQLTokenEquivalent(name, input, dialect) {
		var output = runProSQL(input, dialect);
		var err = compareEquivalent(tokenize(input), tokenize(output));
		if (err) {
			console.log('\nFAIL TOKEN-EQUIVALENT: ' + name);
			console.log('  ' + err);
			console.log('  Input:\n' + input.split('\n').map(function(l) { return '    | ' + l; }).join('\n'));
			console.log('  Output:\n' + output.split('\n').map(function(l) { return '    | ' + l; }).join('\n'));
			process.exitCode = 1;
		}
	}

	// Corpus of cfquery shapes spanning every Pro SQL dispatch path.
	var cases = [
		['full reformat: simple SELECT no cfif',
			'<cfquery name="q">select id, name, status from users where active = 1 order by id limit 10</cfquery>'],
		['full reformat: JOIN + subquery',
			'<cfquery name="q">select o.id, u.name from orders o left join users u on o.user_id = u.id where o.total > 100</cfquery>'],
		['phase 3 hoist: WHERE in cfif branches — keyword merged, identifiers preserved',
			'<cfquery name="q">\n\tSELECT a\n\tFROM t\n\t<cfif y>\n\t\twhere x = 1\n\t<cfelse>\n\t\twhere x = 2\n\t</cfif>\n\tand b = 3\n</cfquery>'],
		['phase 4: AND-leaves preserved',
			'<cfquery name="q">\n\tSELECT a, b FROM t WHERE x = 1\n\t<cfif y>\n\t\tand c = 2\n\t</cfif>\n</cfquery>'],
		['phase 4: cfif/cfelse/cfelseif three-way',
			'<cfquery name="q">\n\tSELECT a FROM t WHERE x = 1\n\t<cfif y EQ 1>\n\t\tand z = 2\n\t<cfelseif y EQ 2>\n\t\tand z = 3\n\t<cfelse>\n\t\tand z = 4\n\t</cfif>\n</cfquery>'],
		['phase 4: three sibling cfif blocks',
			'<cfquery name="q">\n\tSELECT a FROM t WHERE x = 1\n\t<cfif y1>and a1 = 1</cfif>\n\t<cfif y2>and a2 = 2</cfif>\n\t<cfif y3>and a3 = 3</cfif>\n</cfquery>'],
		['cfqueryparam tokens preserved across format',
			'<cfquery name="q">\n\tSELECT id FROM users WHERE id = <cfqueryparam value="#x#" cfsqltype="cf_sql_integer"> AND status = <cfqueryparam value="#s#" cfsqltype="cf_sql_varchar">\n</cfquery>'],
		['SQL block comment /* */ survives via multiset',
			'<cfquery name="q">\n\tSELECT a /* main column */, b FROM t WHERE x = 1\n</cfquery>'],
		['SQL line comment -- survives via multiset',
			'<cfquery name="q">\n\tSELECT a -- pick first\n\tFROM t WHERE x = 1\n</cfquery>'],
		['string literal with doubled-quote escape preserved byte-equal',
			"<cfquery name=\"q\">\n\tSELECT id FROM users WHERE name = 'O''Brien' AND status = 'active'\n</cfquery>"],
		['numeric literals: int, decimal, exponent — all preserved',
			'<cfquery name="q">\n\tSELECT a FROM t WHERE x = 1 AND y = 1.5 AND z = 1e3\n</cfquery>'],
		['IN with multiple string literals — order preserved',
			"<cfquery name=\"q\">\n\tSELECT id FROM t WHERE status IN ('active', 'pending', 'closed')\n</cfquery>"],
		['CASE WHEN expression — identifiers and literals preserved',
			"<cfquery name=\"q\">\n\tSELECT id, CASE WHEN status = 'A' THEN 1 WHEN status = 'B' THEN 2 ELSE 0 END as tier FROM t\n</cfquery>"],
		// -----------------------------------------------------------------
		// Corpus-derived sanitized cases (real-world SQL shape, generic names)
		// -----------------------------------------------------------------
		// Source: fr_mthly_sales_cust.cfm — UNION between two SELECTs each
		// with GROUP BY. Tests Pro SQL handling of UNION across cfif.
		['corpus #1 UNION between two SELECTs with GROUP BY',
			"<cfquery name=\"q\">\n\tselect t1.a, t1.b, sum(t2.c) as total\n\tfrom t1 inner join t2 on t1.id = t2.parent_id\n\twhere t1.flag = 'y'\n\tgroup by t1.a, t1.b\n\tunion\n\tselect t1.a, t1.b, '0' as total\n\tfrom t1\n\twhere t1.flag = 'n'\n\tgroup by t1.a, t1.b\n</cfquery>"],
		// Source: inc_fin_mod_view283_01.cfm — sum(CASE WHEN ... ELSE ... END)
		// aggregate with conditional branches, GROUP BY + ORDER BY.
		['corpus #2 sum(CASE WHEN) aggregate with GROUP BY + ORDER BY',
			"<cfquery name=\"q\">\n\tSELECT g.code, g.unique_id, sc.desc as label,\n\t\tsum(CASE WHEN g.amt >= 0 THEN g.amt ELSE 0 END) as debit,\n\t\tsum(CASE WHEN g.amt < 0 THEN -1 * g.amt ELSE 0 END) as credit\n\tFROM t1 g\n\tinner join t2 sc on g.fn = sc.fn\n\tWHERE g.tag = 'a' AND g.amt <> '0' AND g.cls like 'p%'\n\tGROUP BY g.code, g.unique_id, sc.desc\n\tORDER BY sc.desc\n</cfquery>"],
		// Source: fr_mthly_sales_cust.cfm lines 123-131 — nested CASE inside
		// sum() with multiple OR conditions. Stress-tests Pro SQL with
		// deeply nested function calls.
		['corpus #3 nested CASE WHEN inside sum() with OR predicates',
			"<cfquery name=\"q\">\n\tSELECT t1.id,\n\t\tsum(CASE WHEN t1.period = 1 THEN\n\t\t\t(CASE WHEN t1.flag = 'a' or t1.flag = 'b' THEN -1 * t1.qty ELSE t1.qty END)\n\t\t\tELSE 0 END) as qty_period_1\n\tFROM t1\n\tGROUP BY t1.id\n</cfquery>"],
		// Source: fr_mthly_sales_cust.cfm — 4-table JOIN with multi-column
		// ON conditions and inner + left outer mix.
		['corpus #4 four-table JOIN (inner + left outer) with multi-column ON',
			"<cfquery name=\"q\">\n\tselect t1.a, t2.b, t3.c, t4.d\n\tfrom t1\n\tinner join t2 on t2.fn = t1.fn and t1.id = t2.parent_id\n\tleft outer join t3 on t1.fn = t3.fn and t1.code_unique = t3.code_unique\n\tinner join t4 on t1.fn = t4.fn and t1.party_id = t4.party_id\n\twhere t1.fn = <cfqueryparam value=\"#cookie.fn#\" cfsqltype=\"cf_sql_varchar\">\n</cfquery>"],
		// Source: fr_mthly_sales_cust.cfm lines 144-146 — cfqueryparam
		// with date type and BETWEEN, with CFML # expression containing
		// internal whitespace (already pinned in T8b but with simpler shape).
		['corpus #5 BETWEEN with two cfqueryparam date values containing # expressions',
			"<cfquery name=\"q\">\n\tSELECT a FROM t WHERE date_col BETWEEN <CFQUERYPARAM VALUE=#TNOdateformat('#fromday#/#frommth#/#fromyear# ')# CFSQLTYPE=\"CF_SQL_DATE\"> AND <CFQUERYPARAM VALUE=#TNOdateformat('#today#/#tomth#/#toyear# ')# CFSQLTYPE=\"CF_SQL_DATE\">\n</cfquery>"],
		// Source: fr_mthly_sales_cust.cfm — LIKE with lcase() function +
		// CFML expression interpolated into the pattern string.
		['corpus #6 LIKE pattern with lcase() and CFML # expression in pattern',
			"<cfquery name=\"q\">\n\tselect a from t1 where (lower(t1.code) LIKE '%#lcase(search_query_desc)#%' or lower(t1.desc) LIKE '%#lcase(search_query_desc)#%')\n</cfquery>"],
		// Source: pattern from inc_fin_mod_view283_01.cfm style — HAVING
		// clause with aggregate condition.
		['corpus #7 HAVING clause with aggregate filter',
			"<cfquery name=\"q\">\n\tSELECT t1.cat, count(*) as cnt, sum(t1.amt) as total\n\tFROM t1\n\tGROUP BY t1.cat\n\tHAVING count(*) > 1 AND sum(t1.amt) > 100\n\tORDER BY total DESC\n</cfquery>"],
		// Source: pur_po_view272-style pattern — IN clause with PreserveSingleQuotes
		// and multiple cfif filters appending AND clauses (Phase 4 territory).
		['corpus #8 IN with PreserveSingleQuotes + cfif AND-leaves (Phase 4)',
			"<cfquery name=\"q\">\n\tSELECT a, b FROM t1\n\tWHERE t1.fn = <cfqueryparam value=\"#cookie.fn#\" cfsqltype=\"cf_sql_varchar\">\n\tand t1.tag in (#PreserveSingleQuotes(list)#)\n\t<cfif a>\n\t\tand t1.party = '#party_val#'\n\t</cfif>\n\t<cfif b>\n\t\tand t1.staff in (#PreserveSingleQuotes(staff_list)#)\n\t</cfif>\n</cfquery>"],
		// Multi-line SQL comment spanning logical sections — Phase 4
		// may shift this comment position; multiset check must still pass.
		['corpus #9 multi-line SQL block comment + cfif AND-leaves (Phase 4 comment shift OK)',
			"<cfquery name=\"q\">\n\tSELECT a, b /* this is a\n\t  multi-line comment\n\t  about column b */, c\n\tFROM t1\n\tWHERE x = 1\n\t<cfif y>\n\t\tand z = 2\n\t</cfif>\n</cfquery>"],
		// Cases #10-#14 surfaced by `node tools/diagnose-corpus.js --sanitize`
		// as real corpus coverage gaps:
		//   UPDATE_SET           — inc_sendemail.cfm (1 occurrence)
		//   SELECT_DISTINCT      — 18 corpus occurrences across multiple files
		//   IS_NULL              — 3 corpus occurrences
		//   CFLOOP_IN_BODY       — fr_mthly_sales_cust.cfm (3 occurrences)
		//   CFM_MARKUP_COMMENT   — 7 corpus occurrences (CFML comments inside SQL)
		['corpus #10 UPDATE ... SET with cfqueryparam (DML other than SELECT)',
			"<cfquery name=\"q\">\n\tupdate t1\n\tset a = 'y'\n\twhere b = 'val'\n\tand c = <cfqueryparam value=\"#x#\" cfsqltype=\"cf_sql_varchar\">\n</cfquery>"],
		['corpus #11 SELECT DISTINCT — single column projection',
			"<cfquery name=\"q\">\n\tSELECT distinct a\n\tFROM t1\n\tWHERE id = '#x#'\n</cfquery>"],
		['corpus #12 IS NULL / IS NOT NULL predicates',
			"<cfquery name=\"q\">\n\tSELECT a, b FROM t1 WHERE c IS NULL AND d IS NOT NULL ORDER BY a\n</cfquery>"],
		['corpus #13 <cfloop> inside SELECT clause — Tier 2 verbatim path',
			"<cfquery name=\"q\">\n\tselect\n\t\t<cfloop query=\"qs_period\">\n\t\t\tsum(P#fyearperiodmth_cfn#_amt) as P#fyearperiodmth_cfn#_amt,\n\t\t</cfloop>\n\t\tsum(total) as total\n\tfrom t1\n\tgroup by id\n</cfquery>"],
		['corpus #14 CFML markup comment <!--- ---> inside cfquery body — comment multiset preserved',
			"<cfquery name=\"q\">\n\tselect a, b,\n\t\t<!--- legacy columns removed 2024-01:\n\t\t\td, e, f --->\n\t\tc\n\tfrom t1\n\twhere x = 1\n</cfquery>"]
	];

	var failed = 0;
	cases.forEach(function(c) {
		var before = process.exitCode;
		assertSQLTokenEquivalent(c[0], c[1]);
		if (process.exitCode && !before) failed++;
	});

	if (!failed) {
		console.log('PASS: Pro SQL token-equivalence (' + cases.length + ' cases — no token corruption, comments preserved as multiset)');
	}
})();

/* ===================================================================
 * Content-preservation invariants — round-trip equivalence checks.
 *
 * The CFML auto-split path (Rules A/B/C/D in splitAdjacentCFMLTags) and
 * the indent tracker make WHITESPACE-ONLY changes. They never add, drop,
 * or reorder content. This block proves it for every user-reported case
 * by asserting:
 *
 *     normalize(input) === normalize(beautify(input))
 *
 * where normalize collapses ALL whitespace and lowercases. This catches
 * any future regression that would corrupt content (drop a tag, swap
 * order, inject characters, etc.) — even if the expected-string match
 * in the assertEqual above still happens to pass.
 *
 * Caveats:
 *   - Pro SQL paths NOT checked here (they intentionally reformat SQL).
 *   - Pure-text inputs where the beautifier wraps in <pre> tags would
 *     fail; we restrict to CFML inputs that take the auto-split path.
 *   - Lite uppercase changes keyword case — normalize lowercases both
 *     sides so this is benign.
 * =================================================================== */
function assertContentPreserved(name, input, language, deepFormat) {
	var output = runRouter(input, language || 'cfml', deepFormat == true);
	function norm(s) { return s.replace(/\s+/g, '').toLowerCase(); }
	var ni = norm(input);
	var no = norm(output);
	if (ni !== no) {
		console.log('\nFAIL CONTENT-PRESERVED: ' + name);
		var i = 0;
		while (i < ni.length && i < no.length && ni[i] === no[i]) i++;
		var ctxA = Math.max(0, i - 30);
		console.log('  First diff at char ' + i + ' of ' + Math.max(ni.length, no.length));
		console.log('  Input  : ...' + ni.substr(ctxA, 60).replace(/\n/g, '\\n') + '...');
		console.log('  Output : ...' + no.substr(ctxA, 60).replace(/\n/g, '\\n') + '...');
		console.log('  Lengths: input=' + ni.length + ', output=' + no.length);
		process.exitCode = 1;
	}
}

// Every user-reported case input below comes from the inventory in
// docs/CI-TEST-POLICY.md (cases #1–#25). Verifies content preservation.
var USER_CASE_INPUTS = [
	// Cases 1–8: auto-split fundamentals
	['#1 three adjacent cfset',           '<cfset a = 1><cfset b = 2><cfset c = 3>'],
	['#2 cfset / cfml-comment / cfset',   '<cfset a = 1><!---<cfset old = 2>---><cfset c = 3>'],
	['#3 cfif open + cfinclude + close',  '<cfif x><cfinclude template="foo.cfm"></cfif>'],
	['#4 inline cfif x>1<cfelse>0',       '<cfif x>1<cfelse>0</cfif>'],
	['#5 script with cfml string inside', '<script>var x = "<cfset y=1>";</script>'],
	['#6 cfquery with cfqueryparam',      '<cfquery name="q">SELECT 1<cfqueryparam value="1" cfsqltype="cf_sql_integer"></cfquery>'],
	['#7 cfparam + cfinclude',            '<cfparam name="x" default=""><cfinclude template="bar.cfm">'],
	['#8 nested cfif with cfset',         '<cfif a><cfif b><cfset x = 1></cfif></cfif>'],
	// Cases 9–15: script/style/table/comment patterns
	['#9 script mid-line in td',          '<td>foo&nbsp;<script>doIt();</script>bar</td>'],
	['#10 script multi-line in td',       '<td>...&nbsp;<script>\nvar a = 1;\n</script>\n<cfif x>Only</cfif>.</td>'],
	['#11 tr td td tr',                   '<tr><td>foo</td><td>bar</td></tr>'],
	['#12 table empty td',                '<table><tr><td></td><td>x</td></tr></table>'],
	['#13 td x cfif y z cfif . td',       '<td>x<cfif y>z</cfif>.</td>'],
	['#14 cfscript opaque embedded script', '<cfscript>\n// note: <script>foo()</script>\nvar y = 1;\n</cfscript>'],
	['#15 numberToEnglish pattern',       '<cfif disp_numberToEnglishProper EQ "y">\n\t<td #style_padding#>desc: &nbsp;<script Language="JavaScript">\n\tdocument.write(numberToEnglish(\'#amount_forex#\'));\n</script>\n\t<cfif set_language is \'english\'>Only</cfif>.</td>\n</cfif>'],
	// Cases 16–20: real-world Rule D patterns
	['#16 disp_pym1amt table glued',
		'<cfif use_split_payment_yn EQ "y" AND split_payment_used EQ "y">\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t<table width="100%" border="#bdtk#" class="#default_font#" cellspacing="0" cellpadding="0">\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t<tr height=10><td></td></tr>\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t<cfif disp_pym1amt GT 0><tr height="#ht_ft_total#"><td width="#wd_ft04to05_01#" #style_padding#>&nbsp;</td><td width="#wd_ft04to05_02#" align="right" #style_padding#>\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t\t<cfif set_language is \'english\'>Paid by</cfif> #vle_pym1_desc#\n' +
		'\t\t\t\t\t\t\t\t\t\t\t\t\t</td></tr></cfif>'],
	['#17 serialnum stray cfif',          '<cfif qs_sr_nums.recordcount GT 0>\n\t<br>\n\t<cfif set_language is \'english\'>Serial Number</cfif> :&nbsp;</cfif>\n\t<cfset qcnt=0>'],
	['#18 GST stray HTML close',          '<b>\n\t<cfif comain_gst_name EQ "GST">GST<cfelseif comain_gst_name EQ "VAT">VAT<cfelse>Sales Tax</cfif></b>'],
	['#19 inline p Hello b world',        '<p>Hello <b>world</b>.</p>'],
	['#20 Rule D inline cfif edge',       '<cfif x>1<cfelse>0</cfif>'],
	// Case 21: backslash
	['#21 backslash in CFML string',      '<cfset path = "C:\\foo\\"><cfquery name="q">SELECT 1</cfquery>'],
	// Case 25: memo_transdesc with <br> inside string literal
	['#25 memo_transdesc Remarks font',
		'<td valign="top">\n' +
		'\t<font>\n' +
		'\t\t<b>Remarks:</b>\n' +
		'\t\t<br>#trim(Replace(memo_transdesc, "#chr(13)##chr(10)#", "<br>", "ALL"))#</font>\n' +
		'</td>']
];

USER_CASE_INPUTS.forEach(function(pair) {
	assertContentPreserved(pair[0], pair[1], 'cfml', false);
});

/* ===================================================================
 * Sample-folder idempotency suite.
 *
 * Walks `sample/*.cfm`, beautifies each file, then beautifies the
 * output and asserts byte-equality. Idempotency is the strongest
 * possible regression catch for indent drift / spurious whitespace
 * edits / CFML auto-split rules — if the formatter is honest, a
 * second pass over its own output must be a no-op.
 *
 * The sample/ folder is committed (via .gitkeep + README.md) but its
 * *.cfm contents are gitignored so each developer can drop their
 * private real-world inputs without leaking proprietary code. When
 * the folder is empty, this suite logs SKIP and stays green — no CI
 * dependency on fixtures that don't ship.
 *
 * Two variants per file: deep-format-OFF and deep-format-ON. The
 * OFF variant exercises the pure CFML-tag pass + bare-JS brace
 * counter; the ON variant additionally routes <cfquery> through
 * SQL formatter, <script> through formatBraceCode, <style> through
 * formatCSSCode. Both must idempotent.
 * =================================================================== */
(function runSampleIdempotencySuite() {
	var sampleDir = 'sample';
	var entries;
	try {
		entries = fs.readdirSync(sampleDir).filter(function(f) {
			return /\.cfm$/i.test(f);
		});
	} catch (err) {
		console.log('SKIP idempotency (sample/ unreadable: ' + (err && err.message) + ')');
		return;
	}
	if (entries.length === 0) {
		console.log('SKIP idempotency (no *.cfm in sample/) — drop a fixture to enable');
		return;
	}
	var pass = 0;
	var fail = 0;
	function diffLine(a, b) {
		var aLines = a.split('\n');
		var bLines = b.split('\n');
		var n = Math.min(aLines.length, bLines.length);
		for (var i = 0; i < n; i++) {
			if (aLines[i] !== bLines[i]) {
				return 'line ' + (i + 1) + ' diverges:\n  pass1: ' + JSON.stringify(aLines[i]) + '\n  pass2: ' + JSON.stringify(bLines[i]);
			}
		}
		if (aLines.length !== bLines.length) {
			return 'line counts differ (pass1=' + aLines.length + ', pass2=' + bLines.length + ')';
		}
		return 'unknown';
	}
	entries.forEach(function(name) {
		var src = fs.readFileSync(sampleDir + '/' + name, 'utf8');
		[false, true].forEach(function(deep) {
			var label = name + ' (deep=' + (deep ? 'on' : 'off') + ')';
			var pass1 = runRouter(src, 'auto', deep);
			var pass2 = runRouter(pass1, 'auto', deep);
			if (pass1 === pass2) {
				pass++;
			} else {
				fail++;
				console.log('\nFAIL idempotency: ' + label);
				console.log('  ' + diffLine(pass1, pass2));
				process.exitCode = 1;
			}
		});
	});
	console.log('PASS sample idempotency: ' + pass + ' file/mode pairs across ' + entries.length + ' fixture(s)' + (fail ? ' (' + fail + ' failed)' : ''));
})();

if (!process.exitCode) {
	console.log('All tests passed (including ' + USER_CASE_INPUTS.length + ' content-preservation invariants).');
}
