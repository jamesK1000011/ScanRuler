#!/usr/bin/env python3
# SPDX-License-Identifier: LGPL-2.1-or-later
"""Write terms.sha from a plaintext list kept OUTSIDE the repository.

    python3 hash_terms.py ~/private/privacy-terms.txt > terms.sha

Each line of the input is one term (a name, a place, a computer name).
Only salted scrypt hashes are written: the longest word's length (`M`), one `T` line per distinct word and
one `P <n>` line per whole term of n words. Never commit the input.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import h, tokens  # noqa: E402


def main(path):
    toks, phrases = set(), set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            t = tokens(line)
            toks.update(t)
            phrases.add((len(t), " ".join(t)))
    out = ["# Salted scrypt hashes of personal terms (see check.py). Do not edit by hand.",
           "M %d" % max(len(t) for t in toks)]
    out += ["D %d" % n for n in sorted({len(t) for t in toks if t.isdigit()})]
    out += sorted("T " + h(t) for t in toks)
    out += sorted("P %d %s" % (n, h(p)) for n, p in phrases)
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1])
