"""Check the staged commit for numbers from the team's private files before it goes to the public repo.

    python3 tools/privacy_scan.py            (run after `git add`, before `git commit`)

Collects every decimal number (e.g. 123.4) from private/**/*.json and *.txt, drops the ones that also appear in the
public files (designs/, schema/, validation/), and looks for the rest in the lines the staged diff adds. Prints any
hit and exits 1. Without a private/ folder (a fresh clone) it says so and exits 0: then the private files aren't on
this machine and can't leak from it."""
import glob
import os
import re
import subprocess
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NUM = re.compile(r"(?<![\w.])-?\d+\.\d+(?![\w.])")


def numbers(paths):
    out = set()
    for p in paths:
        try:
            out |= {m.lstrip("-") for m in NUM.findall(open(p, encoding="utf-8", errors="ignore").read())}
        except OSError:
            pass
    return out


priv = glob.glob(os.path.join(root, "private", "**", "*.json"), recursive=True) + \
    glob.glob(os.path.join(root, "private", "**", "*.txt"), recursive=True)
if not priv:
    print("privacy scan: no private/ files here, nothing to compare against")
    sys.exit(0)
public = set()
for d in ("designs", "schema", "validation"):
    public |= numbers(glob.glob(os.path.join(root, d, "**", "*.json"), recursive=True))
secret = {n for n in numbers(priv) - public if len(n.replace(".", "")) >= 3}   # skip short ones like 0.5
diff = subprocess.run(["git", "diff", "--cached", "-U0"], cwd=root, capture_output=True, text=True).stdout
hits = []
for line in diff.splitlines():
    if line.startswith("+") and not line.startswith("+++"):
        for n in NUM.findall(line):
            if n.lstrip("-") in secret:
                hits.append((n, line[:140]))
if hits:
    print(f"privacy scan: {len(hits)} number(s) from private/ in the staged changes:")
    for n, ln in hits[:30]:
        print(f"  {n}: {ln}")
    sys.exit(1)
print(f"privacy scan: clean ({len(secret)} private numbers checked)")
