# SPDX-License-Identifier: AGPL-3.0-only
# The GUI pass's findings, summed up as Markdown: per theme and add-on, the
# counts by check, then every "fail" in full. python gui-summary.py <out>
import collections
import glob
import json
import os
import sys

out = sys.argv[1]
reports = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(out, "*", "gui-report.json")))]
print("# GUI pass\n")
for r in reports:
    surf = len(r["surfaces"])
    by = collections.Counter((f["addon"], f["check"], f["severity"]) for f in r["findings"])
    states = collections.Counter(v.get("state", "?").split(":")[0] for v in r["commands"].values())
    print(f"## {r['theme']} — {surf} surfaces, {len(r['commands'])} commands {dict(states)}, finished: {r['done']}\n")
    print("| add-on | check | severity | n |\n|---|---|---|---|")
    for (a, c, s), n in sorted(by.items()):
        print(f"| {a} | {c} | {s} | {n} |")
    print()
    for f in r["findings"]:
        if f["severity"] == "fail":
            print(f"- FAIL {f['addon']} `{f['surface']}` {f['check']}: {f['widget']} — {f['detail']}")
    errs = {k: v["state"] for k, v in r["commands"].items() if v.get("state", "").startswith("error")}
    for k, v in errs.items():
        print(f"- ERROR running {k}: {v}")
    print()
