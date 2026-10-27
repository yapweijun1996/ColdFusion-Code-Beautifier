// Production formatter scripts shared by the CLI and Node VM harnesses.
// Browser-only loading and optional resources remain explicit in index.html.
module.exports = Object.freeze([
    'vendor/acorn.js',
    'js/cfml-comment-utils.js',
    'js/cf-tags.js',
    'js/sql-keywords.js',
    'js/sql-beautifier.js',
    'js/js-lexer-utils.js',
    'js/js-structure.js',
    'js/js-structure-planner.js',
    'js/deep-format.js',
    'js/tag-utils.js',
    'js/cfml-splitter.js',
    'js/toast.js',
    'js/clipboard.js',
    'js/beautifier.js'
]);
