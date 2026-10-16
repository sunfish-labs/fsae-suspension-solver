# Third-party files built into the page

`ui/build.py` inlines these into `ui/index.html` so the app works with no internet (for example from a USB stick).

| File | Version | License |
|---|---|---|
| `three.min.js` | three.js r128 (0.128.0) | MIT (header in the file) |
| `xlsx.full.min.js` | SheetJS Community Edition 0.18.5 | Apache 2.0 (`LICENSE-xlsx.txt`) |
| `fonts/barlow-condensed-latin-*.woff2` | Barlow Condensed 500/600/700, latin subset (via @fontsource 5.2.8) | SIL OFL 1.1 (`fonts/OFL-Barlow.txt`) |
| `fonts/ibm-plex-*-latin-*.woff2` | IBM Plex Sans 400/500/600 and Mono 400/500, latin subset (via @fontsource) | SIL OFL 1.1 (`fonts/OFL-IBM-Plex.txt`) |

To update one, replace the file, keep the name, and update this table. three.js stays at r128 for now: later
versions changed the API the viewer uses.
