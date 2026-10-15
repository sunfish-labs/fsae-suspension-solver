"""Build ui/theme_wfu_sample.html: the full app with a Wake Forest color palette, for review only.
Colors from brand.wfu.edu: Old Gold #9E7E38, Web Text Gold #8C6D2C, Web Text Black #222222, Gray #53565A,
Athletics Gold #CEB888, Yellow #FDC314. Gold is used sparingly as the guide asks; pass/fail keep green and red."""
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "index.html")).read()
css = """<style id="wfu">
:root, :root[data-theme="light"] {
  --bg: #ecebe8; --panel: #ffffff; --panel-2: #f5f4f1; --ink: #222222; --muted: #53565A; --line: #d6d3cc;
  --accent: #8C6D2C; --accent-ink: #ffffff; --s1: #222222; --s2: #9E7E38; --s3: #3E6A8A; --base: #9a9ca0;
  --ok: #276b43; --ok-bg: #e3f1e7; --bad: #b3261e; --bad-bg: #f9e3e1; --warn: #8a6300; --warn-bg: #fbf0d0; --viewer: #e4e2dd;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0d0d0d; --panel: #171717; --panel-2: #1f1f1f; --ink: #ece9e2; --muted: #a7a39a; --line: #2e2e2e;
  --accent: #CEB888; --accent-ink: #111111; --s1: #ece9e2; --s2: #CEB888; --s3: #7fa8c9; --base: #6b6b6b;
  --ok: #6fcf97; --ok-bg: #10261a; --bad: #ff8a7a; --bad-bg: #3a1714; --warn: #FDC314; --warn-bg: #2e2508; --viewer: #121212; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0d0d0d; --panel: #171717; --panel-2: #1f1f1f; --ink: #ece9e2; --muted: #a7a39a; --line: #2e2e2e;
  --accent: #CEB888; --accent-ink: #111111; --s1: #ece9e2; --s2: #CEB888; --s3: #7fa8c9; --base: #6b6b6b;
  --ok: #6fcf97; --ok-bg: #10261a; --bad: #ff8a7a; --bad-bg: #3a1714; --warn: #FDC314; --warn-bg: #2e2508; --viewer: #121212; color-scheme: dark; }
.brand h1 { color: var(--ink) !important; }
body { border-top: 4px solid #9E7E38; }
.tabs button[aria-selected="true"] { border-bottom-color: #9E7E38 !important; }
:root[data-theme="dark"] .tabs button[aria-selected="true"] { border-bottom-color: #CEB888 !important; }
.seg button[aria-pressed="true"] { background: var(--ink); color: var(--panel); }
.wfu-bar { position: fixed; right: 12px; bottom: 12px; z-index: 60; display: flex; gap: 6px; align-items: center; background: var(--panel); border: 1px solid var(--line);
  border-top: 3px solid #9E7E38; border-radius: 10px; padding: 6px 8px; font: 12px var(--f-body); box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.wfu-bar button { border: 1px solid var(--line); background: var(--panel-2); color: var(--ink); border-radius: 6px; padding: 3px 8px; cursor: pointer; }
.wfu-bar button[aria-pressed="true"] { background: #222222; color: #fff; }
</style>"""
bar = """<div class="wfu-bar" role="group" aria-label="Color sample"><b>Color sample · Wake Forest</b>
<button type="button" data-t="">Auto</button><button type="button" data-t="light">Light</button><button type="button" data-t="dark">Dark</button></div>
<script>(function(){var b=document.querySelectorAll('.wfu-bar button');function set(t){if(t)document.documentElement.setAttribute('data-theme',t);else document.documentElement.removeAttribute('data-theme');
b.forEach(function(x){x.setAttribute('aria-pressed',String(x.dataset.t===t));});}b.forEach(function(x){x.onclick=function(){set(x.dataset.t);};});set('');})();</script>"""
out = src.replace("</body>", css + "\n" + bar + "\n</body>", 1).replace("<title>FSAE Suspension Solver</title>", "<title>Suspension Solver · color sample</title>", 1)
open(os.path.join(here, "theme_wfu_sample.html"), "w").write(out)
print("wrote ui/theme_wfu_sample.html")
