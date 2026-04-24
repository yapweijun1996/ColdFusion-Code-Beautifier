var fs = require('fs');
var vm = require('vm');

var scripts = [
	'js/cf-tags.js',
	'js/sql-keywords.js',
	'js/sql-beautifier.js',
	'js/tag-utils.js',
	'js/toast.js',
	'js/clipboard.js',
	'js/beautifier.js'
];

var browserCode = scripts.map(function(file) {
	return fs.readFileSync(file, 'utf8');
}).join('\n');

function makeContext(input, language, splitHtmlTag) {
	var elements = {
		language: {
			value: language || 'auto'
		},
		split_html_tag: {
			checked: splitHtmlTag == true
		},
		auto_copy_n_clear_bcontent: {
			checked: false
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
		console: console,
		document: {
			getElementById: function(id) {
				return elements[id];
			},
			execCommand: function() {},
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

function runRouter(input, language) {
	var harness = makeContext(input, language || 'auto');
	harness.context.beautifyCodes();
	return harness.elements.output.value;
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
	'SELECT u.id, u.name\nFROM users u\nWHERE u.active = 1\nORDER BY u.id DESC\nLIMIT 10'
);

assertEqual(
	'join with subquery',
	runSQL('select * from orders o left join (select user_id, count(*) c from items group by user_id) i on o.user_id = i.user_id'),
	'SELECT *\nFROM orders o\nLEFT JOIN (\n\tSELECT user_id, COUNT(*) c\n\tFROM items\n\tGROUP BY user_id\n) i\nON o.user_id = i.user_id'
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
	'SELECT `user`, data->>\'$.name\'\nFROM `users`\nWHERE name LIKE \'a%\'\nLIMIT 5, 10'
);

assertEqual(
	'auto detects sql',
	runRouter('with q as (select 1) select * from q', 'auto'),
	'WITH q AS (\n\tSELECT 1\n)\nSELECT *\nFROM q'
);

assertEqual(
	'cfml routed without sql formatting',
	runRouter('<cfif x><cfquery name="q">SELECT 1</cfquery></cfif>', 'auto'),
	'<cfif x><cfquery name="q">SELECT 1</cfquery></cfif>'
);

if (!process.exitCode) {
	console.log('All tests passed.');
}
