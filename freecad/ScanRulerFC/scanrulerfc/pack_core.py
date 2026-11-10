# SPDX-License-Identifier: AGPL-3.0-only
# A finished part bundled for sharing: the licences a pack can carry and
# whether a remix of an upstream part may go out under the one chosen (a
# guide written for this plugin from each licence's terms as commonly read,
# not legal advice — the person confirms each upstream licence), the README
# and attribution, and what could identify the person or open their printer
# taken out of the files first. Ported from ScanRuler by CNC Kitchen:
# plugins/library-pack/core/licence.ts, plan.ts and scrub.ts.

import io
import re
import zipfile

LICENCES = {
    "CC-BY-4.0": {"name": "Creative Commons Attribution 4.0", "short": "CC BY", "url": "https://creativecommons.org/licenses/by/4.0/", "commercial": True, "adapt": True, "shareAlike": False},
    "CC-BY-SA-4.0": {"name": "Creative Commons Attribution-ShareAlike 4.0", "short": "CC BY-SA", "url": "https://creativecommons.org/licenses/by-sa/4.0/", "commercial": True, "adapt": True, "shareAlike": True},
    "CC-BY-NC-4.0": {"name": "Creative Commons Attribution-NonCommercial 4.0", "short": "CC BY-NC", "url": "https://creativecommons.org/licenses/by-nc/4.0/", "commercial": False, "adapt": True, "shareAlike": False},
    "CC-BY-NC-SA-4.0": {"name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0", "short": "CC BY-NC-SA", "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/", "commercial": False, "adapt": True, "shareAlike": True},
    "CC-BY-ND-4.0": {"name": "Creative Commons Attribution-NoDerivatives 4.0", "short": "CC BY-ND", "url": "https://creativecommons.org/licenses/by-nd/4.0/", "commercial": True, "adapt": False, "shareAlike": False},
    "CC-BY-NC-ND-4.0": {"name": "Creative Commons Attribution-NonCommercial-NoDerivatives 4.0", "short": "CC BY-NC-ND", "url": "https://creativecommons.org/licenses/by-nc-nd/4.0/", "commercial": False, "adapt": False, "shareAlike": False},
    "CC0-1.0": {"name": "CC0 1.0 Universal (public domain dedication)", "short": "CC0", "url": "https://creativecommons.org/publicdomain/zero/1.0/", "commercial": True, "adapt": True, "shareAlike": False},
    "MIT": {"name": "MIT License", "short": "MIT", "url": "https://opensource.org/license/mit", "commercial": True, "adapt": True, "shareAlike": False},
    "GPL-3.0-only": {"name": "GNU General Public License v3.0", "short": "GPL-3.0", "url": "https://www.gnu.org/licenses/gpl-3.0.html", "commercial": True, "adapt": True, "shareAlike": True},
    "ARR": {"name": "All rights reserved", "short": "All rights reserved", "url": "", "commercial": False, "adapt": False, "shareAlike": False},
}
ALIASES = [
    (r"^cc[\s-]*0|public\s*domain|cc0", "CC0-1.0"), (r"by[\s-]*nc[\s-]*nd", "CC-BY-NC-ND-4.0"), (r"by[\s-]*nc[\s-]*sa", "CC-BY-NC-SA-4.0"),
    (r"by[\s-]*nc", "CC-BY-NC-4.0"), (r"by[\s-]*nd", "CC-BY-ND-4.0"), (r"by[\s-]*sa", "CC-BY-SA-4.0"),
    (r"(cc[\s-]*by|attribution)(?![\s-]*(sa|nc|nd))", "CC-BY-4.0"), (r"^mit", "MIT"), (r"gpl[\s-]*v?3|gnu general public", "GPL-3.0-only"),
    (r"all rights reserved|^arr$|proprietary|standard digital file|personal use", "ARR"),
]
RESTRICTED_SOURCES = ["traceparts", "mcmaster", "misumi", "grabcad"]
DEFAULT_PACK = {"title": "Untitled part", "author": "", "summary": "", "printSettings": "", "licence": None, "includeStep": True,
                "include3mf": True, "renders": 4}


def read_licence(text):
    if not text:
        return None
    if text in LICENCES:
        return text
    t = re.sub(r"non[\s-]*commercial", "NC", text, flags=re.I)
    t = re.sub(r"share[\s-]*alike", "SA", t, flags=re.I)
    t = re.sub(r"no[\s-]*deriv(ative)?s?", "ND", t, flags=re.I)
    t = re.sub(r"creative\s*commons\s*[-–—]?\s*attribution|attribution", "CC BY", t, flags=re.I)
    t = re.sub(r"\s*[-–—]\s*", "-", t)
    for pat, lid in ALIASES:
        if re.search(pat, t, re.I):
            return lid
    return None


def compatible(upstream, chosen, modified=True, permission=False):
    c = LICENCES[chosen]
    if not upstream:
        return ({"ok": True, "why": "Its licence is unknown, and you said you have the author's permission.", "needs": ["credit the author"]} if permission
                else {"ok": False, "why": "Its licence is unknown. Find it on the source page, or confirm you have the author's permission."})
    u = LICENCES[upstream]
    if upstream == "ARR":
        return ({"ok": True, "why": "All rights reserved, with the author's permission you confirmed.", "needs": ["credit the author"]} if permission
                else {"ok": False, "why": "Its author reserved all rights: it can't be shared on, changed or not, without their permission."})
    if modified and not u["adapt"]:
        return {"ok": False, "why": f"{u['short']} allows sharing it only unchanged; a remix of it can't be shared. Leave it out, or ask its author."}
    if not u["commercial"] and c["commercial"]:
        return {"ok": False, "why": f"{u['short']} forbids commercial use, and {c['short']} would allow it. Pick a NonCommercial licence (CC BY-NC or CC BY-NC-SA)."}
    if modified and u["shareAlike"]:
        same = upstream == chosen or (upstream == "CC-BY-SA-4.0" and chosen == "GPL-3.0-only")
        if not same:
            extra = " (or GPL-3.0, which it allows one way)" if upstream == "CC-BY-SA-4.0" else ""
            return {"ok": False, "why": f"{u['short']} is ShareAlike: a remix must go out under {u['short']}{extra}, not {c['short']}."}
    if upstream == "GPL-3.0-only" and chosen != "GPL-3.0-only":
        return {"ok": False, "why": f"GPL-3.0 work goes out under GPL-3.0, not {c['short']}."}
    if not modified and not u["adapt"]:
        return {"ok": True, "why": f"{u['short']}, included unchanged under its own licence.", "needs": ["credit the author", f"keep it under {u['short']}, marked as such"]}
    needs = [] if upstream == "CC0-1.0" else ["keep its copyright and licence notice"] if upstream == "MIT" else \
        ["credit the author, link the source and the licence"] + (["say it was changed"] if modified else [])
    return {"ok": True, "why": f"{u['short']} allows {'a remix' if modified else 'it'} under {c['short']}.", "needs": needs}


def plan(s, upstream):
    credited, left_out, blocked, problems = [], [], [], []
    if not s.get("licence"):
        problems.append("No licence chosen yet: pack_setup { licence }.")
    if not (s.get("author") or "").strip():
        problems.append("No author (the copyright holder) yet: pack_setup { author }.")
    for u in upstream:
        src = (u.get("source") or "").lower()
        if u.get("redistribute") is False or any(r in src for r in RESTRICTED_SOURCES):
            left_out.append({k: u[k] for k in ("part", "body", "url", "source") if u.get(k)} |
                            {"why": "its licence or source doesn't allow sharing its files" if u.get("redistribute") is False else f"{u.get('source')}'s terms don't allow passing its files on"})
            continue
        if not s.get("licence"):
            continue
        up = read_licence(u.get("licence"))
        v = compatible(up, s["licence"], u.get("modified", True), u.get("permission", False))
        if not v["ok"]:
            blocked.append({"part": u["part"], "why": v["why"]})
        else:
            credited.append({**{k: u[k] for k in ("part", "title", "author", "url") if u.get(k)}, "licence": LICENCES[up]["short"] if up else "used with permission",
                             "needs": v.get("needs", []), "modified": u.get("modified", True)})
            if up and up != "CC0-1.0" and (not u.get("author") or not u.get("url")):
                problems.append(f"{u['part']}: its author and source page are needed to credit it.")
    return {"ok": not blocked and bool(s.get("licence")) and bool((s.get("author") or "").strip()), "licence": s.get("licence"),
            "credited": credited, "leftOut": left_out, "blocked": blocked, "problems": problems}


def md_text(t):
    return (t or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def web_url(u):
    return u if u and re.match(r"^https?://[^\s<>\"]+$", u, re.I) else None


def attribution(p):
    if not p["credited"]:
        return ""
    lines = ["## Attribution", ""]
    for c in p["credited"]:
        url = web_url(c.get("url"))
        lines.append(f"- {'Remixed from' if c['modified'] else 'Includes'} **{md_text(c.get('title') or c['part'])}**"
                     f"{' by ' + md_text(c['author']) if c.get('author') else ''}{f' ({url})' if url else ''}, {c['licence']}.{' Changed for this design.' if c['modified'] else ''}")
    return "\n".join(lines + [""])


def readme(s, planned, files, scrubbed):
    title, author = md_text(s["title"]), md_text(s.get("author"))
    lic = LICENCES.get(s.get("licence") or "")
    out = [f"# {title}", ""]
    if s.get("summary"):
        out += [md_text(s["summary"]), ""]
    out += [f"By {author or 'the author'}. " + (f"Licensed {lic['short']}{' (' + lic['url'] + ')' if lic['url'] else ''}; see LICENSE." if lic else ""), ""]
    out += ["## Files", ""] + [f"- `{f}`" for f in files] + [""]
    if s.get("printSettings"):
        out += ["## Print settings", "", md_text(s["printSettings"]), ""]
    att = attribution(planned)
    if att:
        out.append(att)
    if planned["leftOut"]:
        out += ["## Parts not included", "", "These come from sources that don't allow passing their files on. Get them from the source:", ""]
        for x in planned["leftOut"]:
            url = web_url(x.get("url"))
            out.append(f"- {md_text(x['part'])}{' (' + md_text(x['source']) + ')' if x.get('source') else ''}{': ' + url if url else ''}")
        out.append("")
    out += ["---", "", "Packed with ScanRuler for FreeCAD. Personal details were removed from the files before packing.", ""]
    return "\n".join(out)


def licence_file(lid, holder, year):
    lic = LICENCES[lid]
    if lid == "MIT":
        return (f"MIT License\n\nCopyright (c) {year} {holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and "
                "associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, "
                "modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, "
                "subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions "
                "of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF "
                "MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES "
                "OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER "
                "DEALINGS IN THE SOFTWARE.\n")
    if lid == "ARR":
        return f"Copyright (c) {year} {holder}. All rights reserved.\n\nNo part of these files may be copied, changed or shared without the copyright holder's written permission.\n"
    if lid == "GPL-3.0-only":
        return f"Copyright (C) {year} {holder}\n\nThis work is licensed under the GNU General Public License, version 3 only.\n\nThe full text is at https://www.gnu.org/licenses/gpl-3.0.txt\n"
    return f"Copyright (c) {year} {holder}\n\nThis work is licensed under the {lic['name']} licence ({lic['short']}).\nTo view a copy of this licence, visit {lic['url']}\n"


# ---- scrub ---------------------------------------------------------------------

SECRET = r"(access[_ -]?code|api[_ -]?key|apikey|print_?host_?apikey|token|password|passwd|secret|auth(orization)?)"
SERIAL = r"(serial(_?number)?|dev_?id|device_?id|printer_?sn|\bsn\b)"
HOST = r"(print_?host|printhost|host_?ip|ip_?address|printer_?ip|\bhost\b)"
PATH = re.compile(r"(?:[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+([^\\/\"'<>\s;,]+)(?:[\\/]+[^\"'<>\r\n;,]*)?|/(?:Users|home)/([^/\"'<>\s;,]+)(?:/[^\"'<>\r\n;,]*)?)")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PRIVATE_IP = re.compile(r"\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b")
TEXT = re.compile(r"\.(gcode|txt|md|json|xml|config|ini|model|rels|html|csv|svg)$", re.I)


class Tally:
    def __init__(self):
        self.changes = {}

    def add(self, what, n=1):
        if n > 0:
            self.changes[what] = self.changes.get(what, 0) + n


def _base(p):
    parts = [x for x in re.split(r"[\\/]", p) if x]
    return parts[-1] if parts else ""


def scrub_text(text, t, users):
    def line_key(key, label):
        nonlocal text
        k0 = re.sub(r"\((?!\?)", "(?:", key)

        def blank(m):
            pre, k, sep, v = m.group(1), m.group(2), m.group(3), m.group(4)
            bare = v.strip().strip("\"'")
            if not bare:
                return m.group(0)
            t.add(label)
            quoted = v.strip()[:1] in ('"', "'")
            return pre + k + sep + ('""' if quoted else "")

        text = re.sub(r"(^|[\n\0;{,]\s*[\"']?)([\w .-]*" + k0 + r"[\w.-]*)([\"']?\s*[:=]\s*)(\"(?:[^\"\\]|\\.)*\"|'[^']*'|[^\n\0,}\]]*)", blank, text, flags=re.I | re.M)

        def attr(m):
            t.add(label)
            return m.group(1) + m.group(3)

        text = re.sub(r"(<[^>]*\bkey\s*=\s*\"[^\"]*" + k0 + r"[^\"]*\"[^>]*\bvalue\s*=\s*\")([^\"]+)(\")", attr, text, flags=re.I)
        text = re.sub(r"(\b[\w-]*" + k0 + r"[\w-]*\s*=\s*\")([^\"]+)(\")", attr, text, flags=re.I)

    line_key(SECRET, "access codes, keys, tokens or passwords emptied")
    line_key(SERIAL, "printer serial numbers emptied")
    line_key(HOST, "printer addresses emptied")

    def path(m):
        u = m.group(1) or m.group(2)
        if u:
            users.add(u)
        t.add("absolute paths cut to the file name")
        return _base(m.group(0))

    text = PATH.sub(path, text)
    for u in list(users):
        if len(u) > 2:
            text, n = re.subn(r"\b" + re.escape(u) + r"\b", "user", text)
            t.add("the user name replaced", n)
    text, n = EMAIL.subn("<email>", text)
    t.add("e-mail addresses removed", n)
    text, n = PRIVATE_IP.subn("0.0.0.0", text)
    t.add("local network addresses removed", n)
    return text


def scrub_png(b, t):
    if len(b) < 8 or b[:4] != b"\x89PNG":
        return b
    out, i, dropped = [b[:8]], 8, 0
    while i + 8 <= len(b):
        n = int.from_bytes(b[i:i + 4], "big")
        kind = b[i + 4:i + 8]
        end = i + 12 + n
        if kind in (b"tEXt", b"iTXt", b"zTXt", b"eXIf", b"tIME"):
            dropped += 1
        else:
            out.append(b[i:end])
        i = end
    t.add("picture text and EXIF chunks removed", dropped)
    return b"".join(out)


def scrub_jpeg(b, t):
    if b[:2] != b"\xff\xd8":
        return b
    out, i, dropped = [b[:2]], 2, 0
    while i + 4 <= len(b) and b[i] == 0xFF:
        marker = b[i + 1]
        if marker == 0xDA:
            out.append(b[i:])
            break
        n = (b[i + 2] << 8) | b[i + 3]
        if marker in (0xE1, 0xED, 0xFE):
            dropped += 1
        else:
            out.append(b[i:i + 2 + n])
        i += 2 + n
    t.add("picture EXIF, XMP and comments removed", dropped)
    return b"".join(out)


def scrub_step(text, t, users):
    def fn(m):
        name, stamp, author, org, pre, sysn = m.groups()[:6]
        if author.replace("'", "").strip() or org.replace("'", "").strip():
            t.add("STEP author and organisation emptied")
        return f"FILE_NAME('{_base(name)}','{stamp}',(''),(''),'{pre}','{sysn}','')"

    text = re.sub(r"FILE_NAME\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*\(([^)]*)\)\s*,\s*\(([^)]*)\)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)", fn, text, count=1)
    return scrub_text(text, t, users)


def scrub_stl(b, t):
    head = b[:80].decode("latin-1")
    if re.match(r"^solid\s", head, re.I) and re.search(r"facet", b[:400].decode("latin-1"), re.I):
        text = b.decode("latin-1")
        named = re.sub(r"endsolid[^\n]*", "endsolid part", re.sub(r"^solid[^\n]*", "solid part", text, count=1, flags=re.I), flags=re.I)
        if named != text:
            t.add("the STL solid's name made plain")
        return named.encode("latin-1")
    if re.search(r"[\\/]|@|[A-Za-z]:\\", head):
        t.add("the STL header blanked")
        return b"library-pack".ljust(80, b"\0") + b[80:]
    return b


def scrub_file(name, data, users=None):
    """The file's bytes scrubbed, and what changed: [{file, what, count}]."""
    users = users if users is not None else set()
    t = Tally()
    low = name.lower()
    out = data
    if low.endswith((".3mf", ".zip")):
        src = zipfile.ZipFile(io.BytesIO(data))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as dst:
            for info in src.infolist():
                b2, inner = scrub_file(info.filename, src.read(info.filename), users)
                dst.writestr(info.filename, b2)
                for c in inner:
                    t.add(c["what"], c["count"])
        out = buf.getvalue()
    elif low.endswith(".png"):
        out = scrub_png(data, t)
    elif re.search(r"\.jpe?g$", low):
        out = scrub_jpeg(data, t)
    elif low.endswith(".stl"):
        out = scrub_stl(data, t)
    elif re.search(r"\.(step|stp)$", low):
        out = scrub_step(data.decode("latin-1"), t, users).encode("latin-1")
    elif TEXT.search(low):
        out = scrub_text(data.decode("utf-8", "replace"), t, users).encode("utf-8")
    return out, [{"file": name, "what": w, "count": c} for w, c in t.changes.items()]
