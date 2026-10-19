# Public demo with a waitlist: plan (built in 1.42.0)

Built as planned, with these choices: challenges are locked too; until a waitlist Google Form is set in
`schema/demo.json`, the waitlist opens the feedback form with the sign-up filled into its suggestions box. To
switch to the real waitlist form: make it (Email, Team or school, Role, Feature), take its entry ids from "Get
pre-filled link", and set `waitlist.form` (the `.../formResponse` address) and the four entry ids.

Goal: anyone can open the workbench from a public link, see every view (Car, Front, Rear, every tab, the 3D view,
Learn, the design check) on the example car, and feel how it works. Anything that saves, loads or exports real work
is grayed out with a lock. Clicking it opens "Join the waitlist" (email). The team's app stays as it is today,
behind the passphrase.

## How people get in

The site's front page (`index.html`, today a redirect to `ui/`) becomes a small landing page with two buttons:

- **Try the demo** → `demo/`: a public build. No passphrase, no team settings, example cars only.
- **Team sign-in** → `ui/`: today's encrypted app and passphrase page, unchanged.

A real login isn't needed. GitHub Pages can't run a server, and the passphrase already does the team's job. The
"login" is choosing between the two builds.

## What the demo allows and what it locks

Open in the demo (no lock):
- Every view, tab and panel, with the example cars (`designs/example_car*.json`) and the corner examples.
- Editing numbers and dragging hardpoints. Results update live. Nothing is kept: a reload starts fresh.
- Learn and the glossary.
- The design check on screen (not its printable report).

Grayed out with a lock (click → waitlist):
- Open a file, drag-and-drop a file, Points from CAD, Save / Save as / Download JSON.
- Every export: report, Excel, design justification, tech package, setup sheet, SolidWorks equations, CAD,
  part loads for FEA, BOM and catalog CSVs, cost report.
- One-click Apply / Use buttons (fix tables, spring fix, preview Apply, catalog Use), optimize.
- BOM and catalog imports; the Tracker; Settings → Team.
- Any keyboard shortcut for a locked action (Ctrl/Cmd+S).

Locked items stay visible on purpose. Seeing them is how a visitor learns what the full version does.

## How it's built

1. **One flag in the build:** `python3 ui/build.py --demo` writes `ui/demo.html` with `const DEMO = true`,
   `TEAM_ENC = null`, and only the presets from `designs/`. The normal build is unchanged (`DEMO = false`).
2. **One new module, `ui/src/02_demo.js`.** It holds the list of locked controls as CSS selectors (`#fileIn`,
   `#exMenu [role=menuitem]`, `[data-apply]`, `[data-catuse]`, `#bomImp`, …), so the other modules barely change.
   On start in demo mode it:
   - adds `body.demo` and a `data-locked` mark (plus a lock icon) to each matching control after every render;
   - catches clicks on `[data-locked]` before they reach the control (one listener on `document`, capture phase)
     and opens the waitlist dialog instead;
   - blocks the locked keyboard shortcuts and file drops;
   - turns `store.set` into a no-op, so nothing persists between visits.
3. **CSS** (end of `style.css`): `body.demo [data-locked]` at ~45 % opacity, `cursor: not-allowed`, a small 🔒,
   and a thin "Demo · example car only · Join the waitlist" bar under the header.
4. **Waitlist dialog:** one email field, two optional ones (school/team, role: student / faculty / industry), a
   consent line ("We'll email you when the full version is ready. Nothing else."), and Submit. It names the feature
   that was clicked, so you learn what people want most.
5. **Where the emails go (no server needed), pick one:**
   - **Google Form** posted from the page (free; responses land in a Google Sheet you already use). Least setup.
   - **Tally** or **Formspree** (free tiers; spam filtering, an export to CSV).
   - **Buttondown** (free up to a few hundred subscribers; it's a real mailing list, so you can email everyone).
   The submit is the demo's only web request; the "makes no web requests" test applies to the team build only.
6. **Publish:** `.github/workflows/pages.yml` builds both, encrypts `ui/` as today, copies `ui/demo.html` to
   `_site/demo/index.html` unencrypted, and writes the new landing page. Every push updates both.
7. **Tests** (`tests/browser_test.js`, a new "Demo" section on the demo build): every view opens; the example car
   solves; each locked control is grayed, does nothing on click and opens the waitlist naming it; Ctrl+S is blocked;
   nothing is written to localStorage; no team settings or non-example designs are in the page; a reload resets
   edits. The existing team-build tests stay as they are.

## Effort

About 1–1.5 days of teammate time, or 2–3 hours of Claude time:
- build flag + `02_demo.js` + CSS: half the work;
- waitlist dialog + form hookup: a quarter;
- landing page, workflow, tests, CHANGELOG: the rest.

## Be honest with yourself about what the lock is

- **It isn't security.** The repo is public, so anyone can build the full, unlocked tool from source, exactly as
  today. The grayed-out buttons are a preview and a reason to sign up, not protection. If the full version is ever
  meant to be paid or private, the repo needs to go private (or get a license that says so) first.
- **The waitlist needs a promise.** Decide what people are waiting for: a hosted version with saved projects, team
  accounts, the parts catalog with live prices, help setting up their car. "More features" doesn't get many emails.
- **Email addresses are personal data.** Ask only for what you'll use, say why on the form, keep the list private
  (not in the repo), and give an unsubscribe link in every email.

## Decisions for the owner

1. What the waitlist promises (see above).
2. Which form service (Google Form is the quickest).
3. The demo's open/locked list: is editing the example car allowed (recommended: yes, nothing saved)?
4. Whether the repo stays public.
