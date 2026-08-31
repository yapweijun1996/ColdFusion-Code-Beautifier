# AI Agent Usage

This repository can be shared as a GitHub-only code beautifier. The browser
page is intended for people; the Node CLI is intended for coding agents and
local automation.

## Links

- Web UI: <https://yapweijun1996.github.io/ColdFusion-Code-Beautifier/>
- Repository: <https://github.com/yapweijun1996/ColdFusion-Code-Beautifier>

## Run from GitHub

```bash
git clone https://github.com/yapweijun1996/ColdFusion-Code-Beautifier.git
cd ColdFusion-Code-Beautifier
node tools/beautify-file.js path/to/source.cfm
```

The command keeps the source unchanged and writes:

```text
path/to/source_beutifier.cfm
```

For an agent working with a buffer instead of a file:

```bash
node tools/beautify-file.js - --stdout < path/to/source.cfm
```

## Useful options

```bash
# Force a language
node tools/beautify-file.js source.cfm --language cfml
node tools/beautify-file.js source.sql --language sql
node tools/beautify-file.js source.js --language js

# Use the committed multi-dialect SQL formatter
node tools/beautify-file.js source.cfm --pro-sql --dialect postgresql

# Normalize leading spaces before formatting
node tools/beautify-file.js source.cfm --normalize-indent --indent-width 4
```

The default pipeline uses Auto language detection, Deep SQL/CSS/JS, and
continuation-alignment preservation. Disable stages with `--no-deep-sql`,
`--no-deep-css`, `--no-deep-js`, or
`--no-preserve-continuation-alignment`.

## Privacy and limitations

- Formatting runs locally; source code is not uploaded.
- The CLI uses the same production formatter scripts as the web UI through a
  small Node VM-backed DOM harness.
- UTF-8 (with/without BOM) and BOM-marked UTF-16LE/UTF-16BE inputs are decoded and written back using the same encoding/BOM; LF/CRLF style is also preserved.
- Semantic Indent is currently browser-only and remains opt-in.
- The `_beutifier.cfm` spelling is intentional for compatibility with the
  existing project output convention.

## Agent instruction example

> Clone the repository, run `node tools/beautify-file.js` on the CFML source,
> inspect the generated `_beutifier.cfm`, and do not commit proprietary source
> fixtures from `sample/` (including `sample/sample_cfm/`).
