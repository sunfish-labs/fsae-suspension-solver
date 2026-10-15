// Writes the app modules as the one closure build.py makes (tests/.lint/app.js), plus copies of the solver,
// CAD and glossary scripts (ESLint only lints files under tests/), for ESLint.
const fs = require("fs"), path = require("path");
const src = path.join(__dirname, "..", "ui", "src");
const mods = fs.readdirSync(src).filter(f => f.endsWith(".js")).sort();
fs.mkdirSync(path.join(__dirname, ".lint"), { recursive: true });
fs.writeFileSync(path.join(__dirname, ".lint", "app.js"), "(function () {\n" + mods.map(f => `// ---- ${f}\n` + fs.readFileSync(path.join(src, f), "utf8")).join("") + "})();\n");
for (const f of ["susp.js", "cad.js", "glossary.js"]) fs.copyFileSync(path.join(__dirname, "..", "ui", f), path.join(__dirname, ".lint", f));
