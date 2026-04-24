# ColdFusion Code Beautifier

A simple web-based tool to beautify and format ColdFusion, HTML, JavaScript, CSS, and standalone SQL code.

## Features

- Beautifies ColdFusion code along with HTML, JavaScript, and CSS.
- Supports standalone SQL formatting for common MySQL and PostgreSQL queries.
- Language selector supports Auto, CFML / HTML, and SQL modes.
- Option to forcefully split HTML tags for improved readability.
- Automatic indentation and formatting based on code structure.
- Copies the beautified code to your clipboard upon processing.
- Clear interface to quickly reset input and output data.

## Usage

1. Paste your code into the input textarea.
2. Choose Auto, CFML / HTML, or SQL from the language selector.
3. (Optional) Check the "Force split HTML tag" option to insert line breaks between HTML tags.
4. Click the **Beautify** button.
5. The beautified code appears in the output textarea and is automatically copied to your clipboard.
6. Use the **Clear** button to reset the input and output areas.

## How It Works

- The tool analyzes the code, detects ColdFusion, HTML, JavaScript, and CSS syntax, and adjusts the indentation accordingly.
- Auto mode routes standalone SQL that starts with SELECT, INSERT, UPDATE, DELETE, WITH, CREATE, ALTER, or DROP to the SQL formatter.
- It handles specific cases, such as self-closing tags and multi-line comments, to ensure that the final output is clean and readable.
- SQL formatting works best with standalone queries. Complex procedures, triggers, and multi-CTE chains may require manual adjustment.

## Tests

Run the regression suite with:

```bash
node tests/run-tests.js
```



## Demo
https://yapweijun1996.github.io/ColdFusion-Code-Beautifier/
