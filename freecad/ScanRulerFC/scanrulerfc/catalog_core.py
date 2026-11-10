# SPDX-License-Identifier: AGPL-3.0-only
# Common standard parts by their nominal dimensions, offline, and where to
# look for a part's CAD. Ported from ScanRuler by CNC Kitchen:
# plugins/catalog/core/standards.ts and links.ts. Dimensions only, in mm,
# the nominal values — the standards' tolerances and text are not here and
# are not needed to tell one size from another.

from urllib.parse import quote

KINDS = [
    {"kind": "socket-head-screw", "label": "Socket head cap screw", "standard": "ISO 4762 (DIN 912)", "dims": {"d": "thread diameter", "dk": "head diameter", "k": "head height", "s": "hex key size across flats"}},
    {"kind": "button-head-screw", "label": "Button head screw", "standard": "ISO 7380-1", "dims": {"d": "thread diameter", "dk": "head diameter", "k": "head height", "s": "hex key size across flats"}},
    {"kind": "hex-nut", "label": "Hex nut", "standard": "ISO 4032", "dims": {"d": "thread diameter", "s": "width across flats", "m": "height"}},
    {"kind": "washer", "label": "Plain washer", "standard": "ISO 7089", "dims": {"d1": "hole diameter", "d2": "outside diameter", "h": "thickness"}},
    {"kind": "bearing", "label": "Deep-groove ball bearing", "standard": "ISO 15 boundary dimensions", "dims": {"d": "bore", "D": "outside diameter", "B": "width"}},
]
KIND_IDS = [k["kind"] for k in KINDS]

SHCS = [(2, 3.8, 2, 1.5), (2.5, 4.5, 2.5, 2), (3, 5.5, 3, 2.5), (4, 7, 4, 3), (5, 8.5, 5, 4), (6, 10, 6, 5), (8, 13, 8, 6), (10, 16, 10, 8), (12, 18, 12, 10), (16, 24, 16, 14), (20, 30, 20, 17), (24, 36, 24, 19)]
BHCS = [(3, 5.7, 1.65, 2), (4, 7.6, 2.2, 2.5), (5, 9.5, 2.75, 3), (6, 10.5, 3.3, 4), (8, 14, 4.4, 5), (10, 17.5, 5.5, 6), (12, 21, 6.6, 8)]
NUT = [(2, 4, 1.6), (2.5, 5, 2), (3, 5.5, 2.4), (4, 7, 3.2), (5, 8, 4.7), (6, 10, 5.2), (8, 13, 6.8), (10, 16, 8.4), (12, 18, 10.8), (16, 24, 14.8), (20, 30, 18), (24, 36, 21.5)]
WASHER = [(2, 2.2, 5, 0.3), (2.5, 2.7, 6, 0.5), (3, 3.2, 7, 0.5), (4, 4.3, 9, 0.8), (5, 5.3, 10, 1), (6, 6.4, 12, 1.6), (8, 8.4, 16, 1.6), (10, 10.5, 20, 2), (12, 13, 24, 2.5), (16, 17, 30, 3), (20, 21, 37, 3), (24, 25, 44, 4)]
BEARING = [
    ("623", 3, 10, 4), ("624", 4, 13, 5), ("625", 5, 16, 5), ("626", 6, 19, 6), ("627", 7, 22, 7), ("608", 8, 22, 7), ("609", 9, 24, 7),
    ("6000", 10, 26, 8), ("6001", 12, 28, 8), ("6002", 15, 32, 9), ("6003", 17, 35, 10), ("6004", 20, 42, 12), ("6005", 25, 47, 12),
    ("6200", 10, 30, 9), ("6201", 12, 32, 10), ("6202", 15, 35, 11), ("6203", 17, 40, 12), ("6204", 20, 47, 14), ("6205", 25, 52, 15),
    ("683", 3, 7, 3), ("684", 4, 9, 4), ("685", 5, 11, 5), ("686", 6, 13, 5), ("688", 8, 16, 5), ("693", 3, 8, 4), ("694", 4, 11, 4), ("695", 5, 13, 4), ("696", 6, 15, 5), ("698", 8, 19, 6),
    ("6800", 10, 19, 5), ("6801", 12, 21, 5), ("6802", 15, 24, 5), ("6900", 10, 22, 6), ("6901", 12, 24, 6), ("6902", 15, 28, 7),
    ("MR63", 3, 6, 2.5), ("MR74", 4, 7, 2.5), ("MR85", 5, 8, 2.5), ("MR105", 5, 10, 4), ("MR115", 5, 11, 4), ("MR128", 8, 12, 3.5),
]


def _g(x):
    return f"{x:g}"


PARTS = (
    [{"kind": "socket-head-screw", "designation": f"M{_g(d)} socket head cap screw", "standard": "ISO 4762", "dims": {"d": d, "dk": dk, "k": k, "s": s}} for d, dk, k, s in SHCS]
    + [{"kind": "button-head-screw", "designation": f"M{_g(d)} button head screw", "standard": "ISO 7380-1", "dims": {"d": d, "dk": dk, "k": k, "s": s}} for d, dk, k, s in BHCS]
    + [{"kind": "hex-nut", "designation": f"M{_g(d)} hex nut", "standard": "ISO 4032", "dims": {"d": d, "s": s, "m": m}} for d, s, m in NUT]
    + [{"kind": "washer", "designation": f"M{_g(d)} washer", "standard": "ISO 7089", "dims": {"d1": d1, "d2": d2, "h": h}} for d, d1, d2, h in WASHER]
    + [{"kind": "bearing", "designation": f"{n} bearing", "standard": "ISO 15", "dims": {"d": d, "D": D, "B": B}} for n, d, D, B in BEARING]
)


def match(measured, kind=None, limit=5):
    """The parts whose dimensions fit the ones measured, best first: only
    the dimensions given, each as a share of its nominal so a 0.3 mm washer
    and a 36 mm head weigh alike; kinds lacking a dimension given are out."""
    names = list(measured)
    if not names:
        return []
    out = []
    for p in PARTS:
        if kind and p["kind"] != kind:
            continue
        if not all(n in p["dims"] for n in names):
            continue
        agree = [{"dim": n, "nominal": p["dims"][n], "measured": measured[n], "off": round(measured[n] - p["dims"][n], 3)} for n in names]
        shares = [abs(x["off"]) / max(p["dims"][x["dim"]], 0.5) for x in agree]
        out.append({"part": p, "agree": agree, "worst": round(max(shares), 3), "score": round(sum(v * v for v in shares), 6)})
    return sorted(out, key=lambda m: m["score"])[:limit]


def lookup(designation):
    q = " ".join(designation.lower().split())
    if not q:
        return []
    words = q.split(" ")
    exact = [p for p in PARTS if p["designation"].lower().split(" ")[0] == words[0]]
    if len(words) == 1 and exact:
        return exact
    by_standard = [p for p in PARTS if p["standard"].lower() == q]
    if by_standard:
        return by_standard

    def hit(p):
        d = p["designation"].lower()
        if q in d:
            return True
        size, *rest = d.split(" ")
        return size == words[0] and all(w in d for w in words[1:]) and (len(words) > 1 or bool(rest))

    return [p for p in PARTS if hit(p)]


SOURCES = [
    {"id": "traceparts", "label": "TraceParts", "kind": "catalogue", "url": lambda q: f"https://www.traceparts.com/en/search?Keywords={quote(q)}",
     "terms": "Free account. Models are for your own design work; do not redistribute them."},
    {"id": "mcmaster", "label": "McMaster-Carr", "kind": "catalogue", "url": lambda q: f"https://www.mcmaster.com/{quote('-'.join(q.split()))}/",
     "terms": "CAD offered per product for designing with that product; do not redistribute."},
    {"id": "misumi", "label": "MISUMI", "kind": "catalogue", "url": lambda q: f"https://us.misumi-ec.com/vona2/result/?Keyword={quote(q)}",
     "terms": "Account needed for CAD; for designing with MISUMI parts; do not redistribute."},
    {"id": "printables", "label": "Printables", "kind": "library", "url": lambda q: f"https://www.printables.com/search/models?q={quote(q)}",
     "terms": "Each model carries its own licence: read it on the model's page and record it when you take the file."},
    {"id": "thangs", "label": "Thangs", "kind": "library", "url": lambda q: f"https://thangs.com/search/{quote(q)}?scope=all",
     "terms": "Each model carries its own licence: read it on the model's page and record it when you take the file."},
    {"id": "grabcad", "label": "GrabCAD Community", "kind": "library", "url": lambda q: f"https://grabcad.com/library?query={quote(q)}",
     "terms": "Models for personal use under GrabCAD's terms unless the author says otherwise; do not redistribute."},
]


def links(query, ids=None):
    return [{"source": s["id"], "label": s["label"], "kind": s["kind"], "url": s["url"](query), "terms": s["terms"]} for s in SOURCES if not ids or s["id"] in ids]
