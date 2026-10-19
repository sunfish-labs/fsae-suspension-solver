// ESLint for the web app. The app modules in ui/src/ share one closure (build.py concatenates them), so they are
// linted as that one bundle (tests/lint_bundle.js writes it to tests/.lint/app.js), which makes no-undef meaningful
// without listing every shared helper as a global. Run from tests/:  node lint_bundle.js && npx eslint .
const globals = require("globals");
const rules = { "no-undef": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }] };
module.exports = [
  { files: [".lint/susp.js", ".lint/cad.js", ".lint/glossary.js"], languageOptions: { ecmaVersion: 2022, sourceType: "script",
      globals: { ...globals.browser, ...globals.node } }, rules },
  { files: [".lint/app.js"], languageOptions: { ecmaVersion: 2022, sourceType: "script",
      globals: { ...globals.browser, THREE: "readonly", XLSX: "readonly", PRESETS: "readonly", SW_MACRO: "readonly", APP_VERSION: "readonly", TEAM_ENC: "readonly", DEMO: "readonly" } }, rules },
  { files: ["*.js"], ignores: [".lint/**"], languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node, ...globals.browser } }, rules },
];
