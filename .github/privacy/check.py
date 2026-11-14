#!/usr/bin/env python3
# SPDX-License-Identifier: LGPL-2.1-or-later
"""Privacy and identity check for public repositories and release artefacts.

Run in CI on every push and again on release artefacts before a tag is
published. A failure blocks the release; findings are fixed, never waived.

    python3 .github/privacy/check.py --git .        # tracked files + history
    python3 .github/privacy/check.py dist/           # built artefacts
    python3 .github/privacy/check.py --git --since <rev> .   # history after <rev> only
    python3 .github/privacy/check.py --git --upstream <rev> .  # a fork: skip upstream's files and commits

What it looks for:
  * e-mail addresses other than GitHub noreply addresses (and the allow list);
  * personal home paths (/Users/<name>, /home/<name>, C:\\Users\\<name>);
  * computer names (<name>-macbook-air and the like);
  * military and deployment wording;
  * credentials that look like tokens;
  * personal terms (names, places) given only as salted scrypt hashes in
    terms.sha, so the list itself publishes nothing readable;
  * commit authors and committers that are not noreply identities, and the
    same text checks on commit and tag messages (--git);
  * raster images (screenshots, renders) not yet looked at by a person or
    agent and recorded by hash in images.txt;
  * the same checks inside zip-based files (.zip, .FCStd, .3mf, .mcpb, .whl).

Plain Python 3.9+, no dependencies.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SALT = b"agentlink-privacy-v1"
SCRYPT = dict(n=1024, r=8, p=1, dklen=16)

TEXT_RULES = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    ("home path", re.compile(r"(?:/Users/|/home/|[A-Za-z]:\\\\?Users\\\\?)([A-Za-z0-9._-]+)")),
    ("computer name", re.compile(r"\b[\w-]*?-(?:macbook|imac|mac-?mini|mac-?studio|mac-?pro)(?:-air|-pro)?(?:[-.]local)?\b", re.I)),
    ("computer name", re.compile(r"\b\w+['\u2019]s\s+(?:macbook|imac|mac\s?mini|mac\s?studio)\b", re.I)),
    ("military", re.compile(r"\b(?:USAF|C-17A?|squadron|airlift|air force base|TDY|PCS orders|deployment orders|deployed overseas)\b", re.I)),
    ("first name", re.compile(r"\bjames(?!k1000011)\b", re.I)),
    ("token", re.compile(r"\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16})\b")),
]
OK_EMAIL = re.compile(r"(?:^noreply@anthropic\.com$|@users\.noreply\.github\.com$|^noreply@github\.com$|@example\.(?:com|org|net)$|\.invalid$|\.test$)", re.I)
OK_HOME = {"runner", "user", "username", "you", "me", "name", "example", "someone", "<name>",
           "<you>", "<user>", "$user", "shared", "public", "work", "admin",
           "jane", "john", "alice", "bob"}
OK_AUTHOR_NAMES = {"Claude", "jamesK1000011", "github-actions[bot]", "GitHub"}
def ok_home(name):
    """Placeholders in examples and tests: /Users/me, /home/testuser, /Users/j."""
    n = name.lower()
    return n in OK_HOME or len(n) <= 2 or n.endswith("user") or n.startswith("test")


RASTER = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".ico", ".icns"}
ZIPLIKE = {".zip", ".fcstd", ".fcstd1", ".3mf", ".mcpb", ".whl", ".docx", ".xlsx", ".odt", ".ods"}
# "name@1.0.json" is a file name, not an address.
FILE_EXT = {"json", "py", "txt", "md", "svg", "png", "jpg", "stl", "step", "stp", "3mf", "fcstd", "js", "mjs",
            "ts", "html", "csv", "xml", "yml", "yaml", "toml", "zip", "gcode", "obj", "dxf", "pdf"}
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv"}


def load_lines(name):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip() and not l.lstrip().startswith("#")]


def tokens(text):
    return re.findall(r"[a-z0-9]+", text.lower())


def image_text(data):
    """Only the metadata of a PNG or JPEG (text chunks, EXIF, comments), not
    the compressed pixels, which are noise to a text scan."""
    import struct
    import zlib
    out = []
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        i = 8
        while i + 8 <= len(data):
            n, kind = struct.unpack(">I4s", data[i:i + 8])
            body = data[i + 8:i + 8 + n]
            if kind in (b"tEXt", b"iTXt", b"eXIf"):
                out.append(body)
            elif kind == b"zTXt":
                k, _, rest = body.partition(b"\0")
                try:
                    out.append(k + b" " + zlib.decompress(rest[1:]))
                except zlib.error:
                    out.append(body)
            i += 12 + n
        return b"\n".join(out)
    if data[:2] == b"\xff\xd8":
        end = data.find(b"\xff\xda")
        return data[:end if end > 0 else 65536]
    return data


def h(s):
    return hashlib.scrypt(s.encode(), salt=SALT, **SCRYPT).hex()


class Terms:
    """Personal terms, matched by hash. terms.sha holds `T <hash>` for each
    token of each term and `P <n> <hash>` for each whole term of n tokens."""

    def __init__(self):
        self.tok, self.phr, self.maxlen, self.digits = set(), {}, 64, set()
        for l in load_lines("terms.sha"):
            parts = l.split()
            if parts[0] == "M":
                self.maxlen = int(parts[1])
            elif parts[0] == "D":
                self.digits.add(int(parts[1]))
            elif parts[0] == "T":
                self.tok.add(parts[1])
            elif parts[0] == "P":
                self.phr.setdefault(int(parts[1]), set()).add(parts[2])
        self.cache = {}

    def is_tok(self, t):
        if len(t) > self.maxlen or (t.isdigit() and len(t) not in self.digits):
            return False
        v = self.cache.get(t)
        if v is None:
            v = self.cache[t] = h(t) in self.tok
        return v

    def find(self, text):
        if not self.tok:
            return []
        toks = tokens(text)
        hits, n_max = [], max(self.phr) if self.phr else 1
        marks = [self.is_tok(t) for t in toks]
        for i in range(len(toks)):
            if not marks[i]:
                continue
            for n in range(1, n_max + 1):
                if i + n > len(toks) or not marks[i + n - 1]:
                    break
                if n in self.phr and h(" ".join(toks[i:i + n])) in self.phr[n]:
                    hits.append("personal term (%d word%s)" % (n, "s" * (n > 1)))
        return hits


class Checker:
    def __init__(self):
        self.terms = Terms()
        self.allow = [re.compile(p) for p in load_lines("allow.txt")]
        self.images = {}
        for l in load_lines("images.txt"):
            digest, _, path = l.partition(" ")
            self.images[digest] = path.strip()
        self.findings = []

    def allowed(self, where, kind, snippet):
        line = "%s: %s: %s" % (where, kind, snippet)
        return any(p.search(line) for p in self.allow)

    def add(self, where, kind, snippet):
        snippet = snippet.strip()[:120]
        if not self.allowed(where, kind, snippet):
            self.findings.append((where, kind, snippet))

    def text(self, where, text):
        # The check's own rule files name what they look for; only the
        # personal terms are checked there.
        own = where.startswith(".github/privacy/")
        for lineno, line in enumerate(text.splitlines(), 1):
            w = "%s:%d" % (where, lineno)
            for kind, rx in () if own else TEXT_RULES:
                for m in rx.finditer(line):
                    s = m.group(0)
                    if kind == "email" and (OK_EMAIL.search(s) or s.rsplit(".", 1)[-1].lower() in FILE_EXT):
                        continue
                    if kind == "home path" and ok_home(m.group(1)):
                        continue
                    self.add(w, kind, s)
            for kind in self.terms.find(line):
                self.add(w, kind, "<hidden>")

    def blob(self, where, data, name):
        ext = os.path.splitext(name)[1].lower()
        self.text(where + " (name)", name)
        if ext in ZIPLIKE or data[:4] == b"PK\x03\x04":
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    for info in z.infolist():
                        if not info.is_dir():
                            self.blob("%s!%s" % (where, info.filename), z.read(info), info.filename)
                return
            except zipfile.BadZipFile:
                pass
        if ext in RASTER:
            digest = hashlib.sha256(data).hexdigest()
            if digest not in self.images:
                self.add(where, "image not reviewed", "sha256 %s" % digest)
            data = image_text(data)
        try:
            self.text(where, data.decode("utf-8"))
        except UnicodeDecodeError:
            strings = re.findall(rb"[\x20-\x7e]{4,}", data)
            self.text(where, "\n".join(s.decode("ascii") for s in strings))

    def path(self, root, rel):
        with open(os.path.join(root, rel), "rb") as f:
            self.blob(rel, f.read(), rel)

    def tree(self, root, tracked, base=None):
        if os.path.isfile(root):
            return self.path(os.path.dirname(root) or ".", os.path.basename(root))
        if tracked:
            out = subprocess.run(["git", "-C", root, "ls-files", "-z"], capture_output=True, check=True)
            files = [p for p in out.stdout.decode().split("\0") if p]
            if base:
                # A fork: a file whose exact content exists anywhere in the
                # upstream history is upstream's, not ours to check.

                out = subprocess.run(["git", "-C", root, "rev-list", "--objects", "--missing=allow-any",
                                      "--filter=blob:none", "--filter-print-omitted", base],
                                     capture_output=True, check=True)
                theirs = set(l.split(" ", 1)[0].lstrip("~") for l in out.stdout.decode().splitlines())
                out = subprocess.run(["git", "-C", root, "ls-files", "-s", "-z"], capture_output=True, check=True)
                blob = {}
                for rec in out.stdout.decode().split("\0"):
                    if rec:
                        meta, path = rec.split("\t", 1)
                        blob[path] = meta.split()[1]
                files = [p for p in files if blob.get(p) not in theirs]
        else:
            files = []
            for d, dirs, names in os.walk(root):
                dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
                files += [os.path.relpath(os.path.join(d, n), root) for n in names]
        for rel in sorted(files):
            if os.path.isfile(os.path.join(root, rel)):
                self.path(root, rel)

    def history(self, root, since=None, exclude=None):
        fmt = "%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e"
        out = subprocess.run(["git", "-C", root, "log", "--format=" + fmt] + (
                ["--all", "^" + exclude] if exclude else [since + "..HEAD"] if since else ["--all"]),
                             capture_output=True, check=True).stdout.decode("utf-8", "replace")
        for rec in out.split("\x1e"):
            rec = rec.strip("\n")
            if not rec:
                continue
            sha, an, ae, cn, ce, body = rec.split("\x1f", 5)
            w = "commit %s" % sha[:9]
            for name, mail, role in ((an, ae, "author"), (cn, ce, "committer")):
                if not OK_EMAIL.search(mail):
                    self.add(w, role + " email", mail)
                if name not in OK_AUTHOR_NAMES:
                    self.add(w, role + " name", name)
            self.text(w, body)
        tags = subprocess.run(["git", "-C", root, "for-each-ref", "refs/tags",
                               "--format=%(refname:short)%1f%(taggeremail)%1f%(contents)%1e"],
                              capture_output=True, check=True).stdout.decode("utf-8", "replace")
        for rec in tags.split("\x1e"):
            rec = rec.strip("\n")
            if not rec:
                continue
            tag, mail, body = rec.split("\x1f", 2)
            mail = mail.strip("<>")
            if mail and not OK_EMAIL.search(mail):
                self.add("tag " + tag, "tagger email", mail)
            self.text("tag " + tag, body)


def main(argv):
    git = "--git" in argv
    as_json = "--json" in argv
    since = upstream = None
    if "--upstream" in argv:
        i = argv.index("--upstream")
        upstream = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if "--since" in argv:
        i = argv.index("--since")
        since = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    roots = [a for a in argv if not a.startswith("--")] or ["."]
    c = Checker()
    for root in roots:
        c.tree(root, tracked=git, base=upstream)
        if git:
            c.history(root, since, upstream)
    if as_json:
        print(json.dumps([dict(where=w, kind=k, text=s) for w, k, s in c.findings], indent=1))
    else:
        for w, k, s in c.findings:
            print("%s: %s: %s" % (w, k, s))
        print("privacy check: %s (%d finding%s)" % ("FAILED" if c.findings else "passed",
                                                    len(c.findings), "s" * (len(c.findings) != 1)))
    return 1 if c.findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
