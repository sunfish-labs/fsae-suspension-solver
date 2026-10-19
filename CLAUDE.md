# Notes for Claude sessions working on this repo

Read this first; it replaces re-reading old conversations. Keep answers and edits short; the owner is a senior on
the Wake Forest FSAE team and the team designs in SolidWorks; this tool checks and documents the design.

## What this is
FSAE Vehicle Dynamics Workbench (repo name: fsae-suspension-solver). Two halves that must agree:
- **Python** (`susp_solver.py` CLI, `susp/` package): solver, loads, rules, layout, reports.
- **Browser app** (`ui/`): `ui/solver/*.js` mirrors the Python solver function for function; `ui/src/*.js` is the app
  (numbered modules concatenated in order into one closure), `ui/app.html` the page, `ui/src/style.css`.
  `python3 ui/build.py` builds `ui/index.html` (not committed). Shared data: `schema/*.json`.
- Published by `.github/workflows/pages.yml` on every push to main, **encrypted behind the team passphrase**
  (`tools/encrypt_page.js`, page `tools/gate.html`; repo secret `TEAM_PASSPHRASE`). The repo itself is public.

## Hard rules
- **Never commit team design data.** Team files live in `private/` (git-ignored, only on the owner's computer).
  Before every commit: `git add …` then `python3 tools/privacy_scan.py` (must say clean; needs `private/` present,
  e.g. a symlink to the owner's copy). Don't paste private numbers into public docs, tests or commit messages.
- Don't commit the FSAE rulebook (SAE copyright): rule numbers and paraphrases only.
- `team/settings.enc` is encrypted team settings (learning mode, released designs, banner, tracker). Nobody but the
  team can read it, including you; when the owner sends a new one, copy it to `team/settings.enc`, commit, push.
- Every change ships with tests passing (below). Bump `pyproject.toml` version and add a CHANGELOG entry per feature.
- Commit messages end with the attribution lines the session's system reminder gives.

## Tests (all must pass; CI runs the same, `.github/workflows/tests.yml`)
```
ruff check . && python3 susp_solver.py selftest && python3 tests/test_analytic.py && python3 tests/test_config.py
python3 ui/build.py && python3 ui/test_port.py && python3 tests/test_parity.py && python3 tests/test_reference.py && python3 tests/test_cad.py
python3 validation/tools/planar_fourbar.py | diff - validation/planar_fourbar.json
python3 validation/tools/handcalc_loads.py | diff - validation/loads_handcalc.json
python3 validation/tools/stiffness_model.py --check && python3 validation/tools/full_car_model.py --check
cd tests && npm ci && node lint_bundle.js && npx eslint . && npx prettier --config ../.prettierrc.json --check "../ui/src/*.js" "../ui/solver/*.js" ../ui/cad.js
node tests/browser_test.js      # from the repo root; PW_CHROMIUM=<chromium path> if Playwright's isn't installed
```
For a UI-only change: build, lint/prettier, browser_test. For solver changes: everything (parity with Python).
Prettier formats `ui/src`: run it with `--write` after editing JS.

## Conventions
- **Team frame** for files: ISO 8855 (X forward, Y left, Z up, mm), origin on the ground under the front axle;
  corners are the left-hand one. The solver keeps its own internal frame; conversion only at load/save
  (`susp/frame.py`, `ui/solver/05_frame.js`).
- Writing in the app and docs: plain, American English, short sentences, no jargon without a glossary entry.
- Effort estimates: give teammate-hours and Claude-time; Claude runs ~5-10x faster than a teammate.

## Where things are
- Car view panels: `50_car.js` (balance, rules), `68_layout.js` (layout, drivetrain, engines in `68_engines.js`),
  `68_brakes.js`, `69_bom.js` (bill of materials), `69_catalog.js` (parts catalog). Exports: `60_export.js`, `61_justify.js` (design justification,
  HTML + Typst), `65_cad.js`. Team settings `03_team.js`, tracker `04_tracker.js` (seed `schema/tracker_seed.json`).
- Plans and backlog: `TODO.md`, `BOM_PLAN.md`, `TEAM_SETTINGS_PLAN.md`, `ACTION_PLAN.md`. Start from `TODO.md`.

## Working with the owner's computer
The owner's clone is at `~/Desktop/fsae-suspension-solver` (macOS). When the session is linked to it, private files
can be written there (remote-devices tools); deleting there isn't allowed. The owner pulls with GitHub Desktop.
Private notes for Claude, if present: `private/NOTES_FOR_CLAUDE.md` (current car file, open decisions).
