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
