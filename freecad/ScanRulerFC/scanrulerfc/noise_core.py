# SPDX-License-Identifier: AGPL-3.0-only
# A scan's noise and the noise to plan with. Ported from ScanRuler by CNC
# Kitchen: src/core/geometry/scanQa.ts (localNoise, tessellationOf),
# plugins/scanner-profiles/core/noise.ts (pointSpacing) and
# plugins/_shared/scanNoise.ts (the rule every plugin that reads a scan
# plans with).
#
# The rule: the larger of the scanner's usual noise and this scan's when
# both are known — a scan is never surer than its scanner, and one that
# reads worse is worse — else whichever is known.

import math

import numpy as np

WELL_ABOVE = 1.5  # a scan this many times its scanner's noise reads worse than the scanner gives
TRUST_FACTOR = 3  # nothing finer than three times the noise is trustworthy
NOISE_SAMPLE = 4000
CAD_FLAT_SHARE = 0.5


def _ring(g, v, cap=48):
    off, lst = g.adj_off, g.adj_list
    ring = {v}
    for u in lst[off[v]:off[v + 1]]:
        ring.add(int(u))
        for w in lst[off[u]:off[u + 1]]:
            if len(ring) >= cap:
                break
            ring.add(int(w))
    return ring


def local_noise(g, sample=NOISE_SAMPLE):
    """The median and 90th percentile of the rms scatter of small plane fits
    (a vertex and two rings of neighbours, up to 48 points)."""
    step = max(1, g.n // sample)
    rms = []
    for v in range(0, g.n, step):
        ring = _ring(g, v)
        if len(ring) < 8:
            continue
        p = g.P[list(ring)]
        c = p - p.mean(axis=0)
        w = np.linalg.eigvalsh(c.T @ c)
        rms.append(math.sqrt(max(0.0, float(w[0])) / len(ring)))
    rms.sort()

    def at(q):
        return rms[min(len(rms) - 1, int(q * len(rms)))] if rms else 0.0

    return {"median": at(0.5), "p90": at(0.9), "sampled": len(rms)}


def is_cad(g, sample=NOISE_SAMPLE):
    """A CAD tessellation: at most vertices two triangles sharing an edge out
    of the vertex lie exactly in one plane (to the file's float rounding),
    which a scanner's scatter never leaves."""
    P, F = g.P, g.F
    tol = 2e-7 * (float(np.abs(P).max()) + g.bbox_diag) if g.n else 0.0
    # Triangles round each vertex, from the faces.
    step = max(1, g.n // sample)
    picked = np.arange(0, g.n, step)
    want = np.zeros(g.n, bool)
    want[picked] = True
    rows = np.nonzero(want[F].any(axis=1))[0]
    by_vertex = {}
    for t in rows:
        for v in F[t]:
            if want[v]:
                by_vertex.setdefault(int(v), []).append(t)
    looked = flat = 0
    for v, ts in by_vertex.items():
        if len(ts) < 2:
            continue
        looked += 1
        found = False
        for i, a in enumerate(ts):
            fa = F[a]
            n = np.cross(P[fa[1]] - P[fa[0]], P[fa[2]] - P[fa[0]])
            ln = np.linalg.norm(n)
            if not ln > 1e-12:
                continue
            n /= ln
            for b in ts[i + 1:]:
                shared = set(fa.tolist()) & set(F[b].tolist())
                if len(shared) != 2:
                    continue
                far = (set(F[b].tolist()) - shared).pop()
                if abs(float((P[far] - P[v]) @ n)) <= tol:
                    found = True
                    break
            if found:
                break
        flat += found
    share = flat / looked if looked else 0.0
    return looked >= 8 and share >= CAD_FLAT_SHARE, share


def point_spacing(P, F, max_edges=60000):
    """The median edge length, mm."""
    F = np.asarray(F)
    if not len(F):
        return float("nan")
    step = max(1, (3 * len(F)) // max_edges)
    f = F[::step]
    d = np.concatenate([np.linalg.norm(P[f[:, i]] - P[f[:, (i + 1) % 3]], axis=1) for i in range(3)])
    return float(np.median(d))


def r4(x):
    return round(float(x), 4) + 0.0


def _ok(x):
    return isinstance(x, (int, float)) and math.isfinite(x) and x > 0


def plan(profile, measured):
    """The noise to plan with, from the scanner's usual (`{name, noiseMm}`)
    and this scan's (`{sigmaMm}`); None with neither."""
    p = {"name": profile["name"], "sigmaMm": r4(profile["noiseMm"])} if profile and _ok(profile.get("noiseMm")) else None
    m = {"sigmaMm": r4(measured["sigmaMm"])} if measured and _ok(measured.get("sigmaMm")) else None
    if not p and not m:
        return None
    source = "profile" if p and (not m or p["sigmaMm"] >= m["sigmaMm"]) else "measured"
    sigma = p["sigmaMm"] if source == "profile" else m["sigmaMm"]
    if not p:
        warning = {"kind": "no-profile"}
    elif m and m["sigmaMm"] >= WELL_ABOVE * p["sigmaMm"]:
        warning = {"kind": "worse-than-profile", "ratio": round(10 * m["sigmaMm"] / p["sigmaMm"]) / 10}
    else:
        warning = None
    return {"sigmaMm": sigma, "source": source, "profile": p, "measured": m, "warning": warning}


def at_least(own, n):
    """A reading's own noise, raised to the noise to plan with where that is
    larger."""
    return n["sigmaMm"] if n and n["sigmaMm"] > own else own


def warning_text(n):
    if not n or not n["warning"]:
        return None
    if n["warning"]["kind"] == "no-profile":
        return (f"No scanner is set: planning with this scan's own noise ({n['sigmaMm']:g} mm). Name the scanner, with its usual noise, "
                "so a scan that reads too clean is not trusted past what the scanner gives.")
    return (f"This scan reads {n['measured']['sigmaMm']:g} mm, {n['warning']['ratio']:g}× the {n['profile']['sigmaMm']:g} mm "
            f"{n['profile']['name']} usually gives: worse than this scanner does (a shiny part, a poor pass). Planning with the scan's; rescan if the part allows.")


def answer(n):
    """`scanNoise` as the answers of the tools that read it give it."""
    out = {"sigmaMm": n["sigmaMm"], "source": n["source"],
           "from": f"scanner {n['profile']['name']}" if n["source"] == "profile" else "measured on this scan",
           "finestMm": r4(TRUST_FACTOR * n["sigmaMm"])}
    w = warning_text(n)
    if w:
        out["warning"] = w
    return out
