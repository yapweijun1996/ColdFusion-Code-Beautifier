#!/usr/bin/env node
/*
 * Format one CFML/HTML/SQL/JavaScript file without opening the browser UI.
 *
 * The CLI loads the same browser formatter scripts in a small VM-backed DOM
 * harness, so the command shares the production pipeline instead of carrying
 * a second formatter implementation.
 *
 * Usage:
 *   node tools/beautify-file.js input.cfm
 *   node tools/beautify-file.js input.cfm --output result_beutifier.cfm
 *   node tools/beautify-file.js - --stdout < input.cfm
 *
 * A file input defaults to a sibling *_beutifier.cfm output. Input is never
 * overwritten unless an explicit output path is supplied.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var VENDOR_PATH = path.join(ROOT, 'vendor', 'sql-formatter.min.js');

var opts = {
    input: null,
    output: null,
    stdout: false,
    language: 'auto',
    dialect: 'sql',
    splitHtmlTag: false,
    deepSql: true,
    deepCss: true,
    deepJs: true,
    preserveContinuationAlignment: true,
    normalizeIndent: false,
    normalizeTabWidth: 0,
    proSql: false
};

function fail(message, code) {
    console.error('Error: ' + message);
    process.exit(code || 1);
}

function printHelp() {
    console.log([
        'Usage: node tools/beautify-file.js INPUT [options]',
        '',
        'INPUT:',
        '  FILE              Read a file and write FILE with _beutifier.cfm suffix.',
        '  -                 Read from stdin; use --stdout to print formatted code.',
        '',
        'Output:',
        '  --output FILE     Write to an explicit output path.',
        '  --stdout          Write formatted code to stdout (never writes a file).',
        '',
        'Formatting:',
        '  --language NAME   auto, cfml, sql, or js (default: auto).',
        '  --dialect NAME    Pro SQL dialect (default: sql).',
        '  --split-html-tag  Split adjacent HTML/CFML tags.',
        '  --no-deep-sql     Do not format SQL inside <cfquery>.',
        '  --no-deep-css     Do not format CSS inside <style>.',
        '  --no-deep-js      Do not format JS inside <script>.',
        '  --no-preserve-continuation-alignment',
        '                    Do not preserve JS continuation column alignment.',
        '  --normalize-indent [--indent-width 2|4|8]',
        '                    Convert leading source spaces to tabs before formatting.',
        '  --pro-sql         Use the vendored multi-dialect SQL formatter.',
        '  -h, --help        Show this help.'
    ].join('\n'));
}

function nextArg(argv, index, flag) {
    if (index + 1 >= argv.length || argv[index + 1].charAt(0) === '-') {
        fail(flag + ' requires a value', 2);
    }
    return argv[index + 1];
}

function parseArgs(argv) {
    for (var i = 0; i < argv.length; i++) {
        var arg = argv[i];
        if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        } else if (arg === '--output') {
            opts.output = nextArg(argv, i, arg);
            i++;
        } else if (arg === '--stdout') {
            opts.stdout = true;
        } else if (arg === '--language') {
            opts.language = nextArg(argv, i, arg).toLowerCase();
            i++;
        } else if (arg === '--dialect') {
            opts.dialect = nextArg(argv, i, arg).toLowerCase();
            i++;
        } else if (arg === '--split-html-tag') {
            opts.splitHtmlTag = true;
        } else if (arg === '--no-deep-sql') {
            opts.deepSql = false;
        } else if (arg === '--no-deep-css') {
            opts.deepCss = false;
        } else if (arg === '--no-deep-js') {
            opts.deepJs = false;
        } else if (arg === '--no-preserve-continuation-alignment') {
            opts.preserveContinuationAlignment = false;
        } else if (arg === '--normalize-indent') {
            opts.normalizeIndent = true;
        } else if (arg === '--indent-width') {
            opts.normalizeTabWidth = parseInt(nextArg(argv, i, arg), 10);
            opts.normalizeIndent = true;
            i++;
        } else if (arg === '--pro-sql') {
            opts.proSql = true;
        } else if (arg === '-' && opts.input === null) {
            opts.input = arg;
        } else if (arg.charAt(0) === '-') {
            fail('Unknown option: ' + arg + '\nRun with --help for usage.', 2);
        } else if (opts.input === null) {
            opts.input = arg;
        } else {
            fail('Only one input file may be supplied.', 2);
        }
    }

    if (opts.input === null) fail('An input file or - is required.\nRun with --help for usage.', 2);
    if (['auto', 'cfml', 'sql', 'js'].indexOf(opts.language) === -1) {
        fail('Unsupported --language: ' + opts.language, 2);
    }
    if (![0, 2, 4, 8].includes(opts.normalizeTabWidth)) {
        fail('--indent-width must be 2, 4, or 8.', 2);
    }
    if (opts.stdout && opts.output) fail('--stdout and --output cannot be used together.', 2);
    if (opts.input === '-' && opts.output) {
        fail('Standard input cannot be combined with --output; use --stdout.', 2);
    }
}

function readInput(inputPath) {
    if (inputPath === '-') return fs.readFileSync(0, 'utf8');
    try {
        return fs.readFileSync(inputPath, 'utf8');
    } catch (err) {
        fail('Cannot read input file ' + inputPath + ': ' + err.message);
    }
}

function defaultOutputPath(inputPath) {
    var ext = path.extname(inputPath);
    var stem = ext ? inputPath.slice(0, -ext.length) : inputPath;
    return stem + '_beutifier.cfm';
}

function element(value, checked) {
    return {
        value: value,
        checked: !!checked,
        select: function() {}
    };
}

function loadFormatter() {
    var scripts = [
        'js/cf-tags.js',
        'js/sql-keywords.js',
        'js/sql-beautifier.js',
        'js/js-lexer-utils.js',
        'js/deep-format.js',
        'js/tag-utils.js',
        'js/cfml-splitter.js',
        'js/toast.js',
        'js/clipboard.js',
        'js/beautifier.js'
    ];
    var browserCode = scripts.map(function(file) {
        return fs.readFileSync(path.join(ROOT, file), 'utf8');
    }).join('\n');
    var hasVendor = fs.existsSync(VENDOR_PATH);
    var vendor = hasVendor ? require(VENDOR_PATH) : null;
    if (opts.proSql && !vendor) {
        console.error('Warning: vendor/sql-formatter.min.js is missing; falling back to built-in SQL.');
    }

    var elements = {
        language: element(opts.language),
        split_html_tag: element('', opts.splitHtmlTag),
        auto_copy: element('', false),
        auto_clear: element('', false),
        auto_clear_output: element('', false),
        deep_sql: element('', opts.deepSql),
        deep_css: element('', opts.deepCss),
        deep_js: element('', opts.deepJs),
        preserve_continuation_alignment: element('', opts.preserveContinuationAlignment),
        normalize_indent: element('', opts.normalizeIndent),
        normalize_tab_width: element(String(opts.normalizeTabWidth)),
        semantic_indent: element('', false),
        pro_sql: element('', opts.proSql && !!vendor),
        pro_sql_dialect: element(opts.dialect),
        input: element(''),
        output: element('')
    };

    var context = {
        console: {
            log: function() {},
            warn: function() {
                console.error('[beautifier] ' + Array.prototype.slice.call(arguments).map(String).join(' '));
            },
            error: function() {
                console.error('[beautifier] ' + Array.prototype.slice.call(arguments).map(String).join(' '));
            }
        },
        window: vendor ? { sqlFormatter: vendor } : {},
        document: {
            getElementById: function(id) { return elements[id] || null; },
            execCommand: function() { return true; },
            querySelector: function() { return { prepend: function() {}, textContent: '' }; },
            createElement: function() {
                return {
                    className: '',
                    innerHTML: '',
                    style: { setProperty: function() {} },
                    classList: { add: function() {}, remove: function() {} },
                    addEventListener: function() {},
                    removeEventListener: function() {}
                };
            },
            addEventListener: function() {},
            readyState: 'complete'
        },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout
    };
    vm.createContext(context);
    var proSource = (opts.proSql && vendor)
        ? fs.readFileSync(path.join(ROOT, 'js/pro-sql.js'), 'utf8') + '\n'
        : '';
    vm.runInContext(proSource + browserCode, context, { filename: 'coldfusion-code-beautifier.js' });
    return { context: context, elements: elements };
}

function formatCode(input) {
    var loaded = loadFormatter();
    loaded.elements.input.value = input;
    var result;
    try {
        result = loaded.context.beautifyCodes();
    } catch (err) {
        return Promise.reject(err);
    }
    return Promise.resolve(result).then(function() {
        return loaded.elements.output.value;
    });
}

function writeOutput(inputPath, output) {
    if (opts.stdout || inputPath === '-') {
        process.stdout.write(output);
        return;
    }
    var outputPath = opts.output || defaultOutputPath(inputPath);
    if (!/_beutifier\.cfm$/i.test(outputPath)) {
        fail('Output path must end with _beutifier.cfm: ' + outputPath, 2);
    }
    try {
        fs.writeFileSync(outputPath, output, 'utf8');
    } catch (err) {
        fail('Cannot write output file ' + outputPath + ': ' + err.message);
    }
    console.error('Wrote ' + outputPath);
}

parseArgs(process.argv.slice(2));
var source = readInput(opts.input);
formatCode(source).then(function(output) {
    writeOutput(opts.input, output);
}).catch(function(err) {
    fail('Formatting failed: ' + (err && err.stack ? err.stack : err));
});
