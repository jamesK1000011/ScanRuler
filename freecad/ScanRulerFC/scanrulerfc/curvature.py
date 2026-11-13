# SPDX-License-Identifier: AGPL-3.0-only
# How sharply an edge bends along it: what a curvature comb draws. A straight
# run has no teeth, an arc teeth all one length, and a blend that is no arc
# teeth that grow and shrink; where a flat turns into a round is where the
# teeth start.
#
# A chain of points (a section's cut, an image's detected edge) is read
# smoothed: resampled evenly by arc length, both coordinates smoothed along
# it with a Gaussian of sigma = window / 2, and the curvature read off the
# smooth curve, k = (x'y'' - y'x'') / |r'|^3. Smoothing a circle of radius R
# shrinks it to R·exp(-sigma²/2R²), so the reading is taken back through
# that factor and a round reads its own radius however wide the window. A
# step in curvature becomes a ramp about one window wide, its middle where the
# step is. The ends of an open chain, one window each, are left out.
#
# A fitted arc or circle is read exactly: 1/R.
#
# The sign is positive where the curve turns left as it runs; where the
# material side is known (a section's cut) a reading also says convex (a
# round) or concave (a fillet's hollow).
#
# Ported from ScanRuler by CNC Kitchen: src/core/flat/curvature.ts (0.11.2).

import math

import numpy as np

WINDOW_DEFAULT = 2.0
WINDOW_MIN = 0.2
WINDOW_MAX = 20.0
MAX_SAMPLES = 1_000_000
STRAIGHT_KAPPA = 1e-3


def unshrink(k, sigma):
    """The curvature of a circle that, smoothed by a Gaussian of sigma along
    it, reads k: k = kappa·exp(sigma²kappa²/2), solved by Newton from above."""
    t = abs(k)
    a = sigma * sigma / 2
    if not t > 0 or a * t * t > 30:
        return k
    x = t
    for _ in range(30):
        e = math.exp(a * x * x)
        dx = (x * e - t) / (e * (1 + 2 * a * x * x))
        x -= dx
        if abs(dx) <= 1e-12 * t:
            break
    return -x if k < 0 else x


def _convexity(k, n, o):
    if abs(k) < STRAIGHT_KAPPA:
        return 0
    d = float(n @ o)
    if abs(d) < 0.5:
        return 0
    return 1 if k * d < 0 else -1


def chain_run(chain, window=WINDOW_DEFAULT, scale=(1.0, 1.0), normals=None, step=None):
    """The smoothed curvature along one chain ((n, 2) in chain units; scale
    mm per unit per axis; normals (n, 2) out of the material, or None).
    Returns a run dict, or None when the chain is too short to read."""
    P = np.asarray(chain, dtype=float) * np.asarray(scale, dtype=float)
    N = None if normals is None else np.asarray(normals, dtype=float)
    keep = [0]
    for i in range(1, len(P)):
        if math.hypot(*(P[i] - P[keep[-1]])) >= 1e-9:
            keep.append(i)
    P = P[keep]
    src = np.array(keep)
    m = len(P)
    if m < 3:
        return None
    sigma = max(window, 1e-6) / 2
    seglen = np.hypot(*np.diff(P, axis=0).T)
    length = float(seglen.sum())
    gap = float(np.hypot(*(P[-1] - P[0])))
    closed = False
    if gap <= 1e-6:
        closed = True
        P, src = P[:-1], src[:-1]
        m -= 1
    elif gap <= 1.5 * length / (m - 1) and length > 20 * gap:
        closed = True
    if m < 3:
        return None
    Q = np.vstack([P, P[:1]]) if closed else P
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(Q, axis=0).T))])
    L = float(cum[-1])
    h = step if step else sigma / 4
    h = max(h, L / MAX_SAMPLES)
    trim = 0.0 if closed else 2 * sigma
    if not L > 0 or (not closed and L <= 2 * trim + 2 * h):
        return None
    n = max(8, round(L / h)) if closed else max(3, int(L / h) + 1)
    st = L / n if closed else L / (n - 1)
    s = np.arange(n) * st
    rx = np.interp(s, cum, Q[:, 0])
    ry = np.interp(s, cum, Q[:, 1])
    seg = np.clip(np.searchsorted(cum, s, side="right") - 1, 0, len(Q) - 2)
    frac = (s - cum[seg]) / np.maximum(cum[seg + 1] - cum[seg], 1e-300)
    rsrc = src[np.where(frac < 0.5, seg, (seg + 1) % m) % m]
    R = max(1, math.ceil(3 * sigma / st))
    w = np.exp(-((np.arange(-R, R + 1) * st) ** 2) / (2 * sigma * sigma))
    if closed:
        idx = (np.arange(n)[:, None] + np.arange(-R, R + 1)[None, :]) % n
        W = np.broadcast_to(w, idx.shape)
        gx = (rx[idx] * W).sum(1) / W.sum(1)
        gy = (ry[idx] * W).sum(1) / W.sum(1)
    else:
        num_x = np.convolve(rx, w, mode="same")
        num_y = np.convolve(ry, w, mode="same")
        den = np.convolve(np.ones(n), w, mode="same")
        gx, gy = num_x / den, num_y / den
    i0 = 0 if closed else max(1, math.ceil(trim / st))
    i1 = n - 1 if closed else n - 1 - i0
    if i1 < i0:
        return None
    ks = np.arange(i0, i1 + 1)
    prev = (ks - 1) % n if closed else ks - 1
    nxt = (ks + 1) % n if closed else ks + 1
    dx = (gx[nxt] - gx[prev]) / (2 * st)
    dy = (gy[nxt] - gy[prev]) / (2 * st)
    ddx = (gx[nxt] - 2 * gx[ks] + gx[prev]) / (st * st)
    ddy = (gy[nxt] - 2 * gy[ks] + gy[prev]) / (st * st)
    sp = np.hypot(dx, dy)
    ok = sp > 1e-12
    nrm = np.zeros((len(ks), 2))
    nrm[ok] = np.c_[-dy[ok] / sp[ok], dx[ok] / sp[ok]]
    kap = np.zeros(len(ks))
    raw = np.where(ok, (dx * ddy - dy * ddx) / np.maximum(sp, 1e-300) ** 3, 0.0)
    kap[ok] = [unshrink(float(k), sigma) for k in raw[ok]]
    run = {"points": np.c_[rx[ks], ry[ks]], "normals": nrm, "kappa": kap, "at": ks * st, "closed": closed, "exact": False}
    if N is not None and len(N) == len(chain):
        run["convex"] = np.array([_convexity(kap[o], nrm[o], N[rsrc[k]]) for o, k in enumerate(ks)], dtype=int)
    return run


def fit_run(fit, step=0.05):
    """The exact curvature of a fitted circle or arc; None for anything else."""
    if fit.get("kind") not in ("circle", "arc"):
        return None
    full = fit["kind"] == "circle" or fit.get("sweep", 0) >= 2 * math.pi - 1e-6
    start = fit.get("start", 0.0) if fit["kind"] == "arc" else 0.0
    sweep = 2 * math.pi if full else float(fit["sweep"])
    r = float(fit["radius"])
    if not r > 0 or not sweep > 0:
        return None
    spans = min(20000, max(64 if full else 8, math.ceil(r * sweep / max(step, 1e-6))))
    n = spans if full else spans + 1
    th = start + sweep * np.arange(n) / spans
    c, s = np.cos(th), np.sin(th)
    cx, cy = fit["center"]
    return {"points": np.c_[cx + r * c, cy + r * s], "normals": np.c_[-c, -s], "kappa": np.full(n, 1 / r), "at": r * sweep * np.arange(n) / spans, "closed": full, "exact": True}


def scatter(run, lag):
    """How much a run's curvature scatters, 1/mm: the robust spread of the
    change over `lag` samples. 0 on an exact run."""
    if run["exact"]:
        return 0.0
    k = run["kappa"]
    d = max(1, round(lag))
    if len(k) <= d:
        return 0.0
    diffs = np.abs(k[d:] - k[:-d])
    return float(1.4826 * np.median(diffs) / math.sqrt(2))


def stretches(run, min_length=0.5, straight_below=None, tolerance=0.1):
    """The run told as stretches in order: straight, arc (radius from its
    middle reading, least and most) or the transition between."""
    k = run["kappa"]
    at = run["at"]
    n = len(k)
    if n == 0:
        return []
    spacing = (at[-1] - at[0]) / (n - 1) if n > 1 else 1.0
    sc = scatter(run, min_length / max(spacing, 1e-9))
    straight = straight_below if straight_below is not None else max(0.002, 4 * sc)
    raw, cur = [], None
    for i in range(n):
        ki = float(k[i])
        is_straight = abs(ki) < straight
        if cur is not None:
            mean = cur["sum"] / (cur["i1"] - cur["i0"] + 1)
            fits = (cur["kind"] == "straight") if is_straight else (
                cur["kind"] == "arc" and np.sign(ki) == np.sign(mean) and abs(ki - mean) <= max(tolerance * abs(mean), 3 * sc))
            if fits:
                cur["i1"] = i
                cur["sum"] += ki
                continue
        cur = {"kind": "straight" if is_straight else "arc", "i0": i, "i1": i, "sum": ki}
        raw.append(cur)
    out = []
    pt = lambda i: [float(run["points"][i, 0]), float(run["points"][i, 1])]  # noqa: E731
    for s in raw:
        frm, to = float(at[s["i0"]]), float(at[s["i1"]])
        kind = "transition" if to - frm < min_length else s["kind"]
        if out and out[-1]["kind"] == "transition" and kind == "transition":
            out[-1]["to"] = to
            out[-1]["end"] = pt(s["i1"])
            continue
        st = {"kind": kind, "from": frm, "to": to, "start": pt(s["i0"]), "end": pt(s["i1"])}
        if kind == "arc":
            a = np.sort(np.abs(k[s["i0"]:s["i1"] + 1]))
            st["radius"] = float(1 / a[len(a) // 2])
            st["radiusMin"] = float(1 / a[-1])
            st["radiusMax"] = float(1 / a[0])
            if run.get("convex") is not None:
                votes = int(run["convex"][s["i0"]:s["i1"] + 1].sum())
                if votes:
                    st["convex"] = votes > 0
        out.append(st)
    return out


def comb(run, spacing, per_curvature, cap):
    """Teeth (from the curve to its tip, square to it, away from the centre of
    curvature) every `spacing` mm, and the line through the tips."""
    k, P, Nn, at = run["kappa"], run["points"], run["normals"], run["at"]

    def tip(i):
        ln = min(abs(k[i]) * per_curvature, cap)
        sgn = -1 if k[i] > 0 else 1
        return P[i] + sgn * ln * Nn[i]

    teeth, env, nxt, nenv = [], [], at[0] if len(at) else 0, at[0] if len(at) else 0
    for i in range(len(k)):
        if at[i] + 1e-9 >= nxt:
            nxt = at[i] + spacing
            if abs(k[i]) * per_curvature >= 1e-9:
                teeth.append((P[i].copy(), tip(i)))
        if at[i] + 1e-9 >= nenv or i == len(k) - 1:
            nenv = at[i] + spacing / 4
            env.append(tip(i))
    if run["closed"] and len(env) >= 2:
        env.append(env[0])
    return teeth, env


def reach(runs, diagonal, scale=1.0):
    """How long to draw teeth (mm per 1/mm) and the cap: the usual bend reaches
    0.6 of its radius, at most 5 % of the sheet's diagonal."""
    d = diagonal if diagonal > 0 else 1.0
    floor = 4 / d
    allk = np.concatenate([np.abs(r["kappa"]) for r in runs]) if runs else np.zeros(0)
    curved = np.sort(allk[allk > floor])
    ref = max(floor, float(curved[int(0.75 * (len(curved) - 1))])) if len(curved) else floor
    rch = min(0.05 * d, 0.6 / ref) * scale
    return rch / ref, 2.5 * rch
