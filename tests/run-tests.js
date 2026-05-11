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
	'cfml routed without sql formatting when deep format off',
	runRouter('<cfif x><cfquery name="q">SELECT 1</cfquery></cfif>', 'auto', false),
	'<cfif x><cfquery name="q">SELECT 1</cfquery></cfif>'
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
	'deep script preserves regex literal with semicolon',
	runRouter('<script>\nvar r = /^a;b$/gi;\nif(x){}\n</script>', 'cfml', true),
	'<script>\n\tvar r = /^a;b$/gi;\n\tif(x){\n\t}\n</script>'
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

if (!process.exitCode) {
	console.log('All tests passed.');
}
