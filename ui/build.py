"""Build ui/index.html: inline susp.js and the preset designs into app.html (one self-contained file)."""
import glob
import json
import os
import sys
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
sys.path.insert(0, root)

# Only the public example designs in designs/ are built into the page. Team designs stay in private/ (git-ignored)
# and are opened in the page with "Open JSON".
presets = []
for path in sorted(glob.glob(os.path.join(root, "designs", "*.json"))) + sorted(glob.glob(os.path.join(root, "designs", "case_study", "*.json"))):
    with open(path) as f:
        cfg = json.load(f)
    presets.append({"label": cfg.get("name") or os.path.basename(path), "cfg": cfg})
if not presets:
    sys.exit("no designs/*.json found")
html = open(os.path.join(here, "app.html")).read()
# The page is assembled from src/: style.css and the numbered JS modules, which run in order inside one closure
# (they share helpers such as $, fmt, cfg and ev). Edit the files in src/, then run this script.
src = os.path.join(here, "src")
css = open(os.path.join(src, "style.css")).read()
mods = sorted(f for f in os.listdir(src) if f.endswith(".js"))
app_js = "(function () {\n" + "".join(open(os.path.join(src, f)).read() for f in mods) + "})();"
html = html.replace("/*CSS*/", css.rstrip("\n"), 1).replace("/*APP_JS*/", app_js, 1)
js = open(os.path.join(here, "susp.js")).read()
glossary = open(os.path.join(here, "glossary.js")).read()
cad = open(os.path.join(here, "cad.js")).read()
html = html.replace("/*SUSP_JS*/", js).replace("/*CAD_JS*/", cad).replace("/*GLOSSARY_JS*/", glossary).replace("/*PRESETS*/", json.dumps(presets))
SITE = "https://sunfish-labs.github.io/fsae-suspension-solver/ui/"
local_html = html.replace("/*GUIDE_URL*/", "guide.html")
html = html.replace("/*GUIDE_URL*/", SITE + "guide.html")   # the hosted Claude page links to the public guide
# artifact version: page content only (the publisher adds the document skeleton)
with open(os.path.join(here, "artifact.html"), "w") as f:
    f.write(html)
# standalone version for double-clicking from the folder: full HTML document
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       '<style>body{margin:0}</style>\n</head>\n<body>\n' + local_html + '\n</body>\n</html>\n')
with open(os.path.join(here, "index.html"), "w") as f:
    f.write(doc)
print(f"wrote ui/index.html and ui/artifact.html ({len(html) // 1024} KB)")
