# Team settings (built in 1.28.0)

What shipped, after narrowing the original plan with the team lead on 2026-10-17. The goal: students get help from
the app without one-click buttons that change the design for them, and the official design can't be changed by
accident. The full switchboard below was the first proposal; only the parts marked **built** were made.

## What it does

- **Learning mode** (on by default): for the team, the one-click **Apply** buttons are hidden (the fix tables under
  "What moves this?", the spring-rate fix, the Apply in the preview bar). Hints, the "What moves this?" tables, the
  influence drawer and **Preview** stay; to keep a change, the student types it into the table. Challenges are
  unchanged. The admin keeps everything.
- **Released designs:** the admin opens the official design and clicks *Release the design on screen*. The release
  records the design's content (a hash of everything in the file except its name), not the file. Anyone who opens
  that exact design sees it read-only, with **Make a copy to experiment**. Anything else is an *experiment*: a strip
  under the header says so, and every export from it is stamped "EXPERIMENT — not released" (in the page, in the
  SolidWorks equations as a comment line, and `_EXPERIMENT` in the file name).
- **Banner:** an optional one-line message at the top for the team.
- Team values (targets, FOS, ratings) stay editable, as before.

## How it works

- `team/settings.enc` in the public repo, encrypted in the browser with WebCrypto: a key from the **team
  passphrase** by PBKDF2-SHA256 (200,000 rounds), then AES-GCM. `ui/build.py` builds it into the page. Anyone can
  download it; without the passphrase it's noise.
- Each teammate enters the team passphrase once (⚙ Settings → Team); the browser remembers it.
- The **admin passphrase** is a separate one; its salted PBKDF2 hash is inside the encrypted settings. Signing in
  as admin is remembered on that browser only.
- The admin changes settings in ⚙ Settings → Team, clicks **Download settings.enc**, puts it in the repo at
  `team/settings.enc`, commits and pushes. Until then only the admin's browser sees the change (a local copy that
  wins while it is newer).
- No passphrase (another team, or no settings file): everything is on, exactly as before.
- Change the team passphrase when someone leaves (Team → Change the passphrases), then commit the new file.
- Code: `ui/src/03_team.js` (and the CSS at the end of `ui/src/style.css`). Tests: "Team settings" in
  `tests/browser_test.js`.

**Limit:** this is a guardrail, not security. The code is public: someone can skip the passphrase, clear their
browser or use the developer tools. It keeps the team's own copy calm and the official design safe from slips.

## The original proposal (not built)

### Switches

Each switch has three positions:
- **On:** works as normal.
- **Read-only:** shown, inputs greyed out with a "set by team admin" note.
- **Hidden:** gone from the page.

| # | Feature | What locking it does | Suggested default |
|---|---|---|---|
| **Editing** | | | |
| 1 | Hardpoints (table and 3D drag) | Freezes the geometry | Read-only once geometry is agreed |
| 2 | Pushrod, rocker and damper inputs | Freezes the motion ratio and the spring | Read-only |
| 3 | Loads and materials (load-case g's, required FOS, part ratings) | Everyone checks against the team's numbers | Read-only |
| 4 | Config JSON editor | Closes the back door around every other lock | Hidden whenever anything is locked |
| 5 | Opening files and Points from CAD | Stops people loading their own versions | On (the team loads `private/` files) |
| 6 | Car view inputs (layout, cockpit, ground points, frame stiffness, bars) | Freezes the whole-car model | On while the frame changes |
| **Results and tools** | | | |
| 7 | Result tabs: Motion, Spring & damper, Loads, Packaging, Compare | Hides tabs that would overwhelm new members | All On |
| 8 | Advanced inputs mode | Keeps new members on the simple view | Hidden for new members |
| 9 | Design check and sign-off report | Only the lead signs off | Check On, sign-off report admin-only |
| 10 | Exports (report, FEA loads CSV, 3D for CAD) | Controls what leaves the tool | On |
| 11 | Learn and challenges | Training mode | On |
| **Team values** | | | |
| 12 | Targets, required FOS, ruleset, part ratings | Override any loaded file, shown with a lock icon | Locked |
| 13 | Banner message at the top of the page | For example "Geometry frozen 10/17: ask before changing pickups" | Off until needed |

## Build phases (each shipped with tests)

| Phase | Work | Effort |
|---|---|---|
| 1 | Encryption, passphrase prompt, team-file loading, admin page and admin mode, banner | M (half a day) |
| 2 | Switches 1-11 with On / Read-only / Hidden | S-M (2-4 h) |
| 3 | Team values (12): override, lock icons, a note when a loaded file disagrees | S-M (2-4 h) |
| - | Browser tests for each position, a wrong passphrase, no team file and admin mode; docs | included above |

About a day in total. Phase 1 alone already gives the banner and private team values.

## Implementation notes

- Read the team file in the page's start-up, before the first `run()`, and keep it in one object (for example
  `TEAM`) that `applySettings` consults next to `SET`.
- Read-only: disable the inputs in `fillForm` and the 3D drag handler. Hidden: the same `hidden` / tab-bar filter
  the per-user Result tabs setting already uses (`SET.tabs`, `TAB_BAR` in `18_results.js`).
- Team values: apply them after `loadCfg` merges a file, and list what was overridden in the status bar.
- Store the remembered passphrase in `localStorage`, wrapped in try/catch: a private window simply asks again.
- Put the admin page inside the app (opened with `?admin`), not as a separate page, so it shares the build.

## Open questions (answer before building)

1. Do the suggested defaults look right, especially read-only hardpoints and hidden advanced mode?
2. With read-only hardpoints, can a teammate still try changes in a throwaway copy that can't be saved or
   exported, or not at all?
3. One team passphrase for everyone, or a second "senior" passphrase that unlocks switches 1-2 for a couple of
   trusted members?
