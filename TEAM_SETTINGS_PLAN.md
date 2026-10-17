# Team settings and feature switches (on hold)

A plan for letting the team lead switch big features on and off for the team, and lock team values, without a
server. Proposed 2026-10-17 and on hold. Open questions are at the end.

## Goal

- The team lead changes settings for everyone else quickly, without changing their own view.
- The settings are hidden from other teams, because the site is public.
- No login server (OAuth would need a backend to run and secure all season).

## Approach: an encrypted team file

- `team/settings.enc` is committed to the public repo, encrypted in the browser with WebCrypto (PBKDF2 key from a
  team passphrase, AES-GCM). Anyone can download it, but it's unreadable without the passphrase.
- Teammates enter the team passphrase once; their browser remembers it and the site unlocks the team settings on
  load.
- An **admin page**, opened with a separate admin passphrase:
  - shows every switch and team value;
  - writes a new `team/settings.enc` to commit from GitHub Desktop (live for everyone in about 2 min, after the
    Pages rebuild and a reload);
  - turns on **admin mode** in that browser only (everything visible and editable, team switches ignored);
  - changes either passphrase (re-encrypts the file). Change the team passphrase when someone leaves.
- No passphrase (for example, another team): everything is On, exactly as the public tool is today.
- Precedence: team switches > each person's own ⚙ Settings > defaults. When a team value disagrees with a loaded
  file, the team value wins and the page says so.
- **Limit:** this hides and greys out features but can't enforce anything, because the code is public. It stops
  casual changes; someone using the browser's developer tools or their own copy can get around it. Switch 4 (the
  JSON editor) closes the easy workaround.

## Switches

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
