# Vendored tree-sitter runtime + CFML grammar

These files are committed (not pulled from `node_modules`) so the browser
build and the spike (`tools/spike-tree-sitter.mjs`) load an identical, pinned
set of binaries without requiring a native toolchain. The npm package
`@cfmleditor/tree-sitter-cfml` ships a **native** binding that needs node-gyp
+ a C/C++ compiler; we deliberately avoid it and use the prebuilt WASM grammar
instead.

| File | Size | Source | Purpose |
|------|------|--------|---------|
| `web-tree-sitter.js`     | ~150 KB | npm `web-tree-sitter@0.26.9` (ESM glue) | JS API: `Parser`, `Language` |
| `web-tree-sitter.wasm`   | ~196 KB | npm `web-tree-sitter@0.26.9` (core runtime) | tree-sitter engine compiled to WASM |
| `tree-sitter-cfml.wasm`  | ~2.6 MB | https://cfmleditor.github.io/tree-sitter-cfml/ (playground build, grammar v0.26.20) | CFML grammar |

## Why these are in git

- **No build step** — a fresh clone runs the spike and (eventually) the
  browser feature with zero `npm install` and no C++ compiler.
- **Pinned behavior** — the grammar parses against Lucee semantics; pinning
  the exact WASM avoids silent grammar drift breaking indentation output.

## How to refresh

```sh
# glue + runtime (versions must match each other)
npm install --save-dev web-tree-sitter@<version>
cp node_modules/web-tree-sitter/web-tree-sitter.js   vendor/tree-sitter/
cp node_modules/web-tree-sitter/web-tree-sitter.wasm vendor/tree-sitter/

# grammar (download the prebuilt playground WASM)
curl -L -o vendor/tree-sitter/tree-sitter-cfml.wasm \
  https://cfmleditor.github.io/tree-sitter-cfml/tree-sitter-cfml.wasm
```

Then re-run `node tools/spike-tree-sitter.mjs` — all four validation cases
must still PASS.

## License

- `web-tree-sitter` — MIT (tree-sitter project)
- `tree-sitter-cfml` — MIT (cfmleditor)
