/* Pro SQL — multi-dialect formatter via vendored sql-formatter (MIT)
 *
 * The vendor bundle (~312KB) is loaded lazily on first use so users who
 * never enable "Pro SQL" pay zero bytes. Once loaded it stays in memory
 * and is precached by sw.js so offline use works on subsequent loads.
 *
 * Public API:
 *   PRO_SQL_DIALECTS                     array of {id,label} for the UI <select>
 *   ensureProSQL()                       Promise<sqlFormatter> — idempotent
 *   formatProSQLSync(sql, dialect)       formatter wrapper; throws if not yet loaded
 *   isProSQLLoaded()                     boolean — synchronous check
 */
var PRO_SQL_DIALECTS = [
	{ id: 'sql',           label: 'Standard SQL' },
	{ id: 'mysql',         label: 'MySQL' },
	{ id: 'mariadb',       label: 'MariaDB' },
	{ id: 'postgresql',    label: 'PostgreSQL' },
	{ id: 'sqlite',        label: 'SQLite' },
	{ id: 'tsql',          label: 'SQL Server (T-SQL)' },
	{ id: 'plsql',         label: 'Oracle (PL/SQL)' },
	{ id: 'db2',           label: 'IBM DB2' },
	{ id: 'redshift',      label: 'Amazon Redshift' },
	{ id: 'snowflake',     label: 'Snowflake' },
	{ id: 'bigquery',      label: 'Google BigQuery' },
	{ id: 'hive',          label: 'Apache Hive' },
	{ id: 'spark',         label: 'Apache Spark' },
	{ id: 'trino',         label: 'Trino / Presto' },
	{ id: 'n1ql',          label: 'Couchbase N1QL' },
	{ id: 'singlestoredb', label: 'SingleStoreDB' }
];

var PRO_SQL_VENDOR_URL = './vendor/sql-formatter.min.js';

var _proSqlPromise = null;

function isProSQLLoaded() {
	return typeof window !== 'undefined'
		&& window.sqlFormatter
		&& typeof window.sqlFormatter.format === 'function';
}

function ensureProSQL() {
	if (typeof window === 'undefined') {
		return Promise.reject(new Error('Pro SQL requires a browser environment.'));
	}
	if (isProSQLLoaded()) {
		return Promise.resolve(window.sqlFormatter);
	}
	if (_proSqlPromise) {
		return _proSqlPromise;
	}
	_proSqlPromise = new Promise(function(resolve, reject) {
		var script = document.createElement('script');
		script.src = PRO_SQL_VENDOR_URL;
		script.async = true;
		script.crossOrigin = 'anonymous';
		script.onload = function() {
			if (isProSQLLoaded()) {
				resolve(window.sqlFormatter);
			} else {
				_proSqlPromise = null;
				reject(new Error('Pro SQL bundle loaded but window.sqlFormatter is missing.'));
			}
		};
		script.onerror = function() {
			_proSqlPromise = null;
			reject(new Error('Failed to load Pro SQL bundle from ' + PRO_SQL_VENDOR_URL));
		};
		document.head.appendChild(script);
	});
	return _proSqlPromise;
}

function formatProSQLSync(sql, dialect) {
	if (!isProSQLLoaded()) {
		throw new Error('Pro SQL not loaded yet. Call ensureProSQL() first.');
	}
	var lang = dialect && PRO_SQL_DIALECTS.some(function(d) { return d.id === dialect; })
		? dialect
		: 'sql';
	return window.sqlFormatter.format(sql, {
		language: lang,
		keywordCase: 'upper',
		dataTypeCase: 'upper',
		functionCase: 'upper',
		identifierCase: 'preserve',
		linesBetweenQueries: 2,
		tabWidth: 4,
		useTabs: true
	});
}
