# SPDX-License-Identifier: AGPL-3.0-only
# Assembly instructions: the parts, the steps that put them together, the
# words' style, and the manual as one HTML page. Plain data, kept with the
# project and exported and imported whole. Ported from ScanRuler by CNC
# Kitchen: plugins/assembly-manual/core/model.ts (the data), lint.ts (the
# linter: its rules are its own and the project's word list — no text from
# ASD-STE100 or any other standard is reproduced) and assembly.ts (the bill
# of materials). The line-art sheets and themes are left for the GUI.

import base64
import html
import re

SIGNALS = ["danger", "warning", "caution", "notice"]
STYLES = ["ste100", "plain", "custom"]
DEFAULT_WORDS = {
    "utilize": "use", "prior to": "before", "in order to": "to", "ensure": "make sure", "approximately": "about",
    "commence": "start", "terminate": "stop", "sufficient": "enough", "subsequently": "then", "in the event that": "if",
}
DEFAULT = {"settings": {"title": "Assembly instructions", "explode": 1.0, "view": "iso"},
           "style": {"name": "ste100", "words": dict(DEFAULT_WORDS), "custom": None},
           "parts": [], "steps": []}

PRESETS = {
    "ste100": {"maxWords": 20, "passive": "warn", "oneInstruction": True, "imperative": True},
    "plain": {"maxWords": 30, "passive": "note", "oneInstruction": False, "imperative": False},
}
ACTIONS = set(("adjust align apply attach bend check clean clip close connect cut disconnect do drill engage examine fasten fit fold glue hold insert "
               "install keep lay lift loosen lower make measure mount move open place position press pull push put release remove repeat replace "
               "rotate screw seat set slide snap tap tighten turn use wait wipe").split())


def parse_style_file(md):
    limits, words = {}, {}
    for raw in (md or "").split("\n"):
        line = raw.strip()
        m = re.match(r"^maxWords\s*:\s*(\d+)", line, re.I)
        if m:
            limits["maxWords"] = int(m.group(1))
        m = re.match(r"^passive\s*:\s*(warn|note|off)", line, re.I)
        if m:
            limits["passive"] = m.group(1).lower()
        m = re.match(r"^oneInstruction\s*:\s*(on|off)", line, re.I)
        if m:
            limits["oneInstruction"] = m.group(1).lower() == "on"
        m = re.match(r"^imperative\s*:\s*(on|off)", line, re.I)
        if m:
            limits["imperative"] = m.group(1).lower() == "on"
        m = re.match(r"^[-*]\s*(.+?)\s*->\s*(.+)$", line)
        if m:
            words[m.group(1).lower()] = m.group(2)
    return limits, words


def limits_of(style):
    if style["name"] != "custom":
        return PRESETS[style["name"]], style.get("words") or {}
    lim, words = parse_style_file(style.get("custom"))
    return {**PRESETS["plain"], **lim}, {**(style.get("words") or {}), **words}


def sentences(text):
    t = re.sub(r"\s+", " ", text or "")
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"(])", t) if s.strip()]


def _words(s):
    return re.findall(r"[A-Za-z0-9×°'’-]+", s)


def lint(text, style):
    limits, avoid = limits_of(style)
    out = []
    for i, s in enumerate(sentences(text)):
        n = i + 1
        w = _words(s)
        if len(w) > limits["maxWords"]:
            out.append({"rule": "length", "level": "warn", "sentence": n, "message": f"Sentence {n} has {len(w)} words; keep instructions to {limits['maxWords']} or fewer."})
        if limits["passive"] != "off":
            m = re.search(r"\b(is|are|was|were|be|been|being)\s+(\w+ed|\w+en|put|set|cut|held|made|done)\b", s, re.I)
            if m:
                out.append({"rule": "passive", "level": limits["passive"], "sentence": n,
                            "message": f"Sentence {n} reads passive (\"{m.group(1)} {m.group(2)}\"); say who does it, or start with the verb."})
        body = re.sub(r"^(if|when|before|after|while)\b[^,]*,\s*", "", s, flags=re.I)
        bw = _words(body)
        first = bw[0].lower() if bw else None
        if limits["imperative"] and first and first not in ACTIONS and not re.match(r"^(do not|don't|caution|warning|note)\b", body, re.I):
            out.append({"rule": "imperative", "level": "note", "sentence": n, "message": f"Sentence {n} starts with \"{bw[0]}\"; start an instruction with its verb."})
        if limits["oneInstruction"]:
            verbs = [x for j, x in enumerate(bw) if x.lower() in ACTIONS and (j == 0 or re.match(r"^(and|then)$", bw[j - 1], re.I))]
            if len(verbs) > 1:
                out.append({"rule": "one-instruction", "level": "warn", "sentence": n, "message": f"Sentence {n} gives {len(verbs)} instructions ({', '.join(verbs)}); give one per sentence."})
        lower = f" {s.lower()} "
        for bad, good in avoid.items():
            if f" {bad} " in lower or f" {bad}," in lower or f" {bad}." in lower:
                out.append({"rule": "word", "level": "warn", "sentence": n, "message": f"Sentence {n}: write \"{good}\", not \"{bad}\"."})
    return out


def check_plan(plan):
    """What is wrong with a plan as data: steps naming parts not listed, a
    part placed twice, a sub-assembly used before it is built."""
    names = {p["name"] for p in plan["parts"]}
    built, placed, problems = set(), {}, []
    for i, st in enumerate(plan["steps"]):
        for pl in st.get("place", []):
            nm = pl["part"]
            if nm not in names and nm not in built:
                problems.append(f"Step {i + 1} places {nm!r}, which is not a part or a sub-assembly built before it.")
            if nm in placed:
                problems.append(f"Step {i + 1} places {nm!r} again (step {placed[nm]} placed it).")
            placed[nm] = i + 1
        if st.get("sub"):
            built.add(st["sub"])
    unplaced = [p["name"] for p in plan["parts"] if p.get("body") and p["name"] not in placed]
    return problems, unplaced


def bom(plan):
    """The bill of materials, item numbers in the order the parts first come
    in; hardware counted by designation."""
    rows, by_key = [], {}
    order = [pl["part"] for st in plan["steps"] for pl in st.get("place", [])]
    parts = {p["name"]: p for p in plan["parts"]}
    for nm in order + [p["name"] for p in plan["parts"]]:
        p = parts.get(nm)
        if not p:
            continue
        key = p.get("designation") or p["name"]
        if key in by_key:
            if nm in order and p["name"] not in by_key[key]["names"]:
                by_key[key]["qty"] += p.get("qty", 1)
                by_key[key]["names"].append(p["name"])
            continue
        row = {"item": len(rows) + 1, "name": key if p.get("designation") else p["name"], "kind": p.get("kind", "part"), "qty": p.get("qty", 1),
               "source": p.get("source"), "names": [p["name"]]}
        rows.append(row)
        by_key[key] = row
    return rows


CSS = """
:root{--ink:#1d1d1f;--muted:#6e6e73;--rule:#d2d2d7;--accent:#0071e3;--wash:#f5f5f7}
body{font:15px/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:var(--ink);margin:0;background:#fff}
main{max-width:960px;margin:0 auto;padding:32px}
h1{font-size:32px;font-weight:600;letter-spacing:-.01em;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 24px}
table{border-collapse:collapse;width:100%;margin:8px 0 24px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule)}
th{font-weight:600;color:var(--muted);font-size:13px}
.step{display:grid;grid-template-columns:1fr 260px;gap:20px;padding:24px 0;border-top:1px solid var(--rule);break-inside:avoid}
.step img{width:100%;border-radius:10px;background:var(--wash)}
.n{display:inline-block;background:var(--accent);color:#fff;font-weight:600;border-radius:8px;padding:2px 10px;margin-bottom:8px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.warn{border-left:4px solid #ff9f0a;background:#fff8ec;padding:8px 10px;border-radius:6px;margin:8px 0}
.warn.danger{border-color:#ff3b30;background:#fff1f0}.warn.warning{border-color:#ff9f0a}.warn.caution{border-color:#ffd60a}.warn.notice{border-color:#0071e3;background:#f0f6ff}
.meta{color:var(--muted);font-size:13px}
@media print{main{padding:0}.step{break-inside:avoid}}
"""


def _hex(c):
    return "#%02x%02x%02x" % tuple(int(255 * x) for x in c)


def html_manual(plan, pictures, colours):
    """The manual as one HTML page: a cover with the bill of materials, then
    each step's picture, parts, tools, torque, safety messages and words.
    pictures: step index -> PNG bytes; colours: part name -> (r, g, b)."""
    s = {**DEFAULT["settings"], **plan["settings"]}
    e = html.escape
    rows = bom(plan)
    out = [f"<!DOCTYPE html><html lang=en><head><meta charset=utf-8><title>{e(s['title'])}</title><style>{CSS}</style></head><body><main>",
           f"<h1>{e(s['title'])}</h1>"]
    for k in ("product", "version", "publisher"):
        if s.get(k):
            out.append(f"<p class=sub>{e(str(s[k]))}</p>")
    if s.get("safety"):
        out.append(f"<div class='warn warning'>{e(s['safety'])}</div>")
    out.append("<h2>Parts</h2><table><tr><th>#</th><th>Item</th><th>Qty</th><th>Source</th></tr>")
    for r in rows:
        out.append(f"<tr><td>{r['item']}</td><td>{e(r['name'])}</td><td>{r['qty']}</td><td>{e(r.get('source') or '')}</td></tr>")
    out.append("</table>")
    item_of = {nm: r["item"] for r in rows for nm in r["names"]}
    for i, st in enumerate(plan["steps"]):
        out.append("<section class=step><div>")
        if i in pictures:
            out.append(f"<img alt='Step {i + 1}' src='data:image/png;base64,{base64.b64encode(pictures[i]).decode()}'>")
        out.append("</div><div>")
        label = f"{i + 1}" + (f" · {e(st['sub'])}" if st.get("sub") else "")
        out.append(f"<span class=n>{label}</span>")
        for w in st.get("warnings") or []:
            out.append(f"<div class='warn {e(w['level'])}'><b>{e(w['level'].upper())}</b> {e(w['text'])}</div>")
        out.append("<ul>")
        for pl in st.get("place", []):
            c = colours.get(pl["part"])
            dot = f"<span class=dot style='background:{_hex(c)}'></span>" if c else ""
            n = item_of.get(pl["part"])
            out.append(f"<li>{dot}{e(pl['part'])}{f' <span class=meta>(#{n})</span>' if n else ''}</li>")
        out.append("</ul>")
        if st.get("tools"):
            out.append(f"<p class=meta>Tools: {e(', '.join(st['tools']))}</p>")
        if st.get("torque"):
            out.append(f"<p class=meta>Torque: {e(st['torque'])}</p>")
        for snt in sentences(st.get("text") or ""):
            out.append(f"<p>{e(snt)}</p>")
        if st.get("notes"):
            out.append(f"<p class=meta>{e(st['notes'])}</p>")
        out.append("</div></section>")
    for k, label in (("intendedUse", "Intended use"), ("disposal", "Disposal")):
        if s.get(k):
            out.append(f"<h2>{label}</h2><p>{e(s[k])}</p>")
    out.append("</main></body></html>")
    return "".join(out)
