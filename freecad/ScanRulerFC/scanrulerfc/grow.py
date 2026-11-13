# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/fit/regionGrow.ts, guide.ts,
# selection.ts, fitPlaneFromSeed.ts, fitSphereFromSeed.ts,
# fitCylinderFromSeed.ts, fitConeFromSeed.ts, fitTorusFromSeed.ts
#
# From a click to the whole surface. A patch round the seed gives the robust
# estimate, retried on a larger patch when it is too small or too flat; the
# region then grows from the seed, the model refitted every round, and a
# vertex joins only inside the noise band and with a normal that agrees with
# the model's — the normal test is what stops it at an edge rather than
# leaking onto the next face. The rings of a scan's rounded edge that still
# get in are peeled off the rim afterwards.

import math

import numpy as np

from . import shapes as S
from .linalg import FitError, ortho_basis
from .meshgraph import bfs_levels

FIT_SUBSAMPLE = 60000
COS_SPHERE_MAX = math.cos(math.radians(38))
COS_CYLINDER_MAX = math.cos(math.radians(32))
COS_CONE_MAX = math.cos(math.radians(32))
COS_PLANE_MAX = math.cos(math.radians(25))
PEEL_TILT_FACTOR = 2
PEEL_TILT_FLOOR = math.radians(0.5)
MAX_PEEL_RINGS = 6
SEED_PATCHES = [1500, 6000, 24000]
MIN_SELECTED = 20


def require_selection(selection, noun):
    if len(selection) < MIN_SELECTED:
        raise FitError(f"Paint more of the {noun} — a fit needs at least {MIN_SELECTED} marked points, and this selection has {len(selection)}.")


def collect_patch(g, seeds, limit):
    return bfs_levels(g, seeds, None, limit)[0]


def stranded_seeds(g, region, seeds):
    """Seeds that grew nothing: in the region only as places the growing
    started from, standing alone."""
    inreg = set(int(v) for v in region)
    is_seed = [int(s) for s in dict.fromkeys(int(x) for x in seeds) if int(s) in inreg]
    seedset = set(is_seed)
    lists = g.lists()
    stranded, seen = set(), set()
    for s in is_seed:
        if s in seen:
            continue
        seen.add(s)
        joined = [s]
        grew = False
        k = 0
        while k < len(joined):
            for nb in lists[joined[k]]:
                if nb not in inreg:
                    continue
                if nb not in seedset:
                    grew = True
                elif nb not in seen:
                    seen.add(nb)
                    joined.append(nb)
            k += 1
        if not grew:
            stranded.update(joined)
    return stranded


def seeded_fit(g, seeds, estimate, grow, finish):
    for size in SEED_PATCHES:
        patch = collect_patch(g, seeds, size)
        if len(patch) < 30:
            break
        cand = estimate(patch, (seeds[0] if seeds else 1) + size)
        if not cand:
            continue
        grown = grow(cand)
        if not grown or len(grown["region"]) < 60:
            continue
        if len(seeds) > 1:
            st = stranded_seeds(g, grown["region"], seeds)
            if st:
                grown = dict(grown, region=np.array([v for v in grown["region"] if int(v) not in st], dtype=np.int64))
        if len(grown["region"]) < 60:
            continue
        fit = finish(grown)
        if fit:
            return fit
    return None


# ---- the guide --------------------------------------------------------------

AXIS_SIN = math.sin(math.radians(30))
AXIS_FINAL_COS = math.cos(math.radians(20))
RADIUS_SLACK = 0.1
GUIDED_TRIES = 4


def has_guide(gd):
    return bool(gd) and any(gd.get(k) is not None for k in ("side", "radius", "axis", "within"))


def unit_axis(gd):
    a = gd.get("axis")
    if a is None:
        return None
    ln = math.hypot(*a)
    return np.asarray(a, dtype=float) / ln if ln > 0 else None


def in_box(gd, X):
    b = gd.get("within")
    if not b:
        return np.ones(len(X), dtype=bool)
    return np.all((X >= np.asarray(b["min"])) & (X <= np.asarray(b["max"])), axis=1)


def radius_in_range(gd, r, rough=False):
    rr = gd.get("radius") or {}
    lo, hi = rr.get("min"), rr.get("max")
    if lo is not None and r < lo * ((1 - RADIUS_SLACK) if rough else 1):
        return False
    if hi is not None and r > hi * ((1 + RADIUS_SLACK) if rough else 1):
        return False
    return True


def axis_agrees(gd, a):
    u = unit_axis(gd)
    return True if u is None else abs(float(u @ np.asarray(a))) >= AXIS_FINAL_COS


def _bent_as_asked(g, patch, gd):
    P, N = g.P, g.N
    nb, owner = g.neighbours(patch)
    D = P[nb] - P[patch][owner]
    l2 = (D * D).sum(axis=1)
    ok = l2 > 0
    val = np.where(ok, ((N[nb] - N[patch][owner]) * D).sum(axis=1) / np.where(ok, l2, 1), 0.0)
    s = np.bincount(owner, weights=val, minlength=len(patch))
    c = np.bincount(owner, weights=ok.astype(float), minlength=len(patch))
    bend = np.where(c > 0, s / np.maximum(c, 1), 0.0)
    at = np.full(g.n, np.nan)
    at[patch] = bend
    nbv = at[nb]
    have = np.isfinite(nbv)
    s2 = bend + np.bincount(owner, weights=np.where(have, nbv, 0), minlength=len(patch))
    c2 = 1 + np.bincount(owner, weights=have.astype(float), minlength=len(patch))
    b = s2 / c2
    rmax = (gd.get("radius") or {}).get("max")
    floor = 1 / (4 * rmax) if rmax is not None else 0.25 / g.bbox_diag
    sign = 1 if gd.get("side") == "outside" else -1 if gd.get("side") == "inside" else 0
    keep = sign * b > floor if sign else np.abs(b) > floor
    return patch[keep]


def guide_patch(g, patch, gd):
    u = unit_axis(gd)
    bend = gd.get("side") is not None or gd.get("radius") is not None
    if u is None and not gd.get("within") and not bend:
        return patch
    keep = in_box(gd, g.P[patch])
    if u is not None:
        keep &= np.abs(g.N[patch] @ u) <= AXIS_SIN
    out = patch[keep]
    return _bent_as_asked(g, out, gd) if bend else out


def side_share(g, idx, side, outward):
    idx = np.asarray(idx)
    step = max(1, len(idx) // 400)
    sub = idx[::step]
    O = outward(g.P[sub])
    ok = np.any(O != 0, axis=1)
    if not ok.any():
        return 0.0
    sign = 1 if side == "outside" else -1
    return float(np.mean(sign * (O[ok] * g.N[sub][ok]).sum(axis=1) > 0))


def radial_from(c):
    c = np.asarray(c, dtype=float)

    def f(X):
        D = X - c
        d = np.linalg.norm(D, axis=1)
        return np.where((d > 1e-12)[:, None], D / np.where(d > 1e-12, d, 1)[:, None], 0.0)

    return f


def radial_off(p, a):
    p, a = np.asarray(p, dtype=float), np.asarray(a, dtype=float)

    def f(X):
        Q = X - p
        W = Q - (Q @ a)[:, None] * a
        d = np.linalg.norm(W, axis=1)
        return np.where((d > 1e-12)[:, None], W / np.where(d > 1e-12, d, 1)[:, None], 0.0)

    return f


def judge_round(g, gd, radius, inliers, outward, rough):
    if not radius_in_range(gd, radius, rough):
        return {"radius": radius, "why": "size"}
    if gd.get("side") and side_share(g, inliers, gd["side"], outward) < 0.6:
        return {"radius": radius, "why": "an outside" if gd["side"] == "inside" else "an inside"}
    return None


def axis_off(gd, radius, axis, center, inliers):
    u = unit_axis(gd)
    a = np.asarray(axis, dtype=float)
    a = a / (np.linalg.norm(a) or 1)
    cs = min(1.0, abs(float(u @ a))) if u is not None else 1.0
    return {"radius": radius, "why": "axis off", "axis": a, "center": center, "offDeg": math.degrees(math.acos(cs)), "inliers": inliers}


def guided_estimate(g, patch, gd, estimate, judge, on, seen):
    if gd.get("radius") and not gd.get("side"):
        patches = sorted([guide_patch(g, patch, dict(gd, side="outside")), guide_patch(g, patch, dict(gd, side="inside"))], key=lambda p: -len(p))
    else:
        patches = [guide_patch(g, patch, gd)]
    for p in patches:
        for _ in range(GUIDED_TRIES):
            if len(p) < 30:
                break
            c = estimate(p)
            if not c:
                break
            no = judge(c)
            if not no:
                return c
            seen.append(no)
            gone = np.isin(p, c["inliers"])
            p = p[~gone & ~on(c, p)]
    return None


def guided_seeds(g, inliers, gd, outward):
    if not gd.get("side"):
        return inliers
    sign = 1 if gd["side"] == "outside" else -1
    O = outward(g.P[inliers])
    ok = np.any(O != 0, axis=1) & (sign * (O * g.N[inliers]).sum(axis=1) > 0)
    return inliers[ok]


def guide_refusal(kind, gd, seen):
    rr = gd.get("radius")
    rng = f"{'R%s' % rr['min'] if rr.get('min') is not None else ''}–{'R%s' % rr['max'] if rr.get('max') is not None else ''}" if rr else ""
    uniq = {}
    for s in seen:
        uniq.setdefault(f"{s['radius']:.2f} {s['why']}", s)
    found = sorted(uniq.values(), key=lambda s: not radius_in_range(gd, s["radius"]))[:3]

    def fx(v, d):
        return "[" + ", ".join(str(round(float(x), d)) for x in v) + "]"

    def seen_as(s):
        if s.get("axis") is not None and s.get("center") is not None:
            return f"R{s['radius']:.2f} (axis off by {s['offDeg']:.1f}°: axis {fx(s['axis'], 3)} through {fx(s['center'], 2)}, {s['inliers']} points)"
        return f"R{s['radius']:.2f} ({s['why']})"

    said = f" Found {', '.join(seen_as(s) for s in found)}." if found else ""
    off = " If that is the surface, give that axis or drop axis." if any(s.get("axis") is not None for s in found) else ""
    return f"No {kind} there within the guide{f' (radius {rng})' if rng else ''}.{said}{off} Seed on the surface itself, widen radius, or check side{' and within' if gd.get('within') else ''}."


# ---- growing ----------------------------------------------------------------


def _peel(g, members, align):
    n = len(members)
    if n < 60:
        return members
    a = np.sort(align(members))
    noise_tilt = math.acos(min(1.0, float(a[n >> 1])))
    limit = math.cos(max(PEEL_TILT_FACTOR * noise_tilt, noise_tilt + PEEL_TILT_FLOOR))
    keep_at_least = max(60, n >> 1)
    inside = np.zeros(g.n, dtype=bool)
    inside[members] = True
    nb, owner = g.neighbours(members)
    on_rim = np.zeros(n, dtype=bool)
    np.logical_or.at(on_rim, owner, ~inside[nb])
    ring = members[on_rim]
    remaining = n
    for _ in range(MAX_PEEL_RINGS):
        if len(ring) == 0 or remaining - len(ring) < keep_at_least:
            break
        ra = np.sort(align(ring))
        if ra[len(ring) >> 1] >= limit:
            break
        inside[ring] = False
        remaining -= len(ring)
        nb, _ = g.neighbours(ring)
        nxt = np.unique(nb[inside[nb]])
        ring = nxt
    if remaining == n:
        return members
    return members[inside[members]]


def grow_region(g, seeds, init, init_sigma, init_count, spec, guide=None):
    P, N = g.P, g.N
    signed = spec.get("signed")
    side_sign = (1 if guide["side"] == "outside" else -1) if (guide and guide.get("side") and signed) else 0
    model = init
    sigma = max(init_sigma, 1e-6)
    prev = max(init_count, 50)
    last = None
    for rnd in range(30):
        band = spec["band"](model, sigma)
        cap = max(6000, prev * 3)

        def accept(c, model=model, band=band):
            X = P[c]
            with np.errstate(invalid="ignore"):
                ok = np.abs(spec["residual"](model, X)) <= band
                a = side_sign * signed(model, X, N[c]) if side_sign else spec["align"](model, X, N[c])
                ok &= a >= spec["cosMax"]
            if guide and guide.get("within"):
                ok &= in_box(guide, X)
            return ok

        region, capped = bfs_levels(g, seeds, accept, cap)
        if len(region) < 10:
            return None
        fit_idx = region
        if len(region) > FIT_SUBSAMPLE:
            fit_idx = region[np.floor(np.arange(FIT_SUBSAMPLE) * (len(region) / FIT_SUBSAMPLE)).astype(np.int64)]
        fit = spec["refit"](fit_idx, model)
        if not fit:
            return None
        growth = abs(len(region) - prev)
        model = fit[0]
        sigma = max(fit[1], 1e-6)
        last = (region, capped)
        if not capped and rnd >= 3 and growth <= max(3, 0.002 * prev):
            break
        prev = len(region)
    if last is None:
        return None
    region, capped = last
    m = model
    kept = region if capped else _peel(g, region, lambda vs: spec["align"](m, P[vs], N[vs]))
    return {"region": kept, "model": model, "sigma": sigma}


def _sph_align(s, X, Nn):
    D = X - np.array([s["cx"], s["cy"], s["cz"]])
    d = np.linalg.norm(D, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.abs((D * Nn).sum(axis=1) / d)


def _sph_signed(s, X, Nn):
    D = X - np.array([s["cx"], s["cy"], s["cz"]])
    d = np.linalg.norm(D, axis=1)
    return np.where(d > 1e-12, (D * Nn).sum(axis=1) / np.where(d > 1e-12, d, 1), 0.0)


def _cyl_signed(c, X, Nn):
    _e, W, _t, rho = S.cyl_radial(c, X)
    return np.where(rho > 1e-12, (W * Nn).sum(axis=1), 0.0)


def grow_sphere(g, seeds, init, sig, cnt, guide=None):
    def refit(idx, _m):
        f = S.fit_sphere_clipped(g.P, idx, 3)
        return f and (f["sphere"], f["sigma"])

    return grow_region(g, seeds, init, sig, cnt, {
        "cosMax": COS_SPHERE_MAX,
        "band": lambda s, sg: max(3.5 * sg, 0.004 * s["r"]),
        "residual": lambda s, X: np.where(np.linalg.norm(X - np.array([s["cx"], s["cy"], s["cz"]]), axis=1) < 1e-12, np.nan, S.sphere_residual(s, X)),
        "align": _sph_align,
        "signed": _sph_signed,
        "refit": refit,
    }, guide)


def grow_cylinder(g, seeds, init, sig, cnt, guide=None):
    def refit(idx, c):
        f = S.fit_cylinder_clipped(g.P, idx, c, 3)
        return f and (f["cylinder"], f["sigma"])

    return grow_region(g, seeds, init, sig, cnt, {
        "cosMax": COS_CYLINDER_MAX,
        "band": lambda c, sg: max(3.5 * sg, 0.004 * c["r"]),
        "residual": S.cylinder_residual,
        "align": lambda c, X, Nn: np.abs(_cyl_signed(c, X, Nn)),
        "signed": _cyl_signed,
        "refit": refit,
    }, guide)


def grow_cone(g, seeds, init, sig, cnt, guide=None):
    def refit(idx, c):
        f = S.fit_cone_clipped(g.P, idx, c, 3)
        return f and (f["cone"], f["sigma"])

    return grow_region(g, seeds, init, sig, cnt, {
        "cosMax": COS_CONE_MAX,
        "band": lambda c, sg: max(3.5 * sg, 0.004 * c["r"]),
        "residual": S.cone_residual,
        "align": S.cone_normal_align,
        "signed": S.cone_normal_signed,
        "refit": refit,
    }, guide)


def grow_torus(g, seeds, init, sig, cnt, guide=None):
    def refit(idx, t):
        f = S.fit_torus_clipped(g.P, idx, 3, t)
        return f and (f["torus"], f["sigma"])

    return grow_region(g, seeds, init, sig, cnt, {
        "cosMax": COS_CYLINDER_MAX,
        "band": lambda t, sg: max(3.5 * sg, 0.004 * t["r"]),
        "residual": S.torus_residual,
        "align": S.torus_normal_align,
        "refit": refit,
    }, guide)


def grow_plane(g, seeds, init, sig, cnt, guide=None):
    floor = 2e-4 * g.bbox_diag

    def refit(idx, _m):
        f = S.fit_plane_clipped(g.P, idx, 3)
        return f and (f["plane"], f["sigma"])

    return grow_region(g, seeds, init, sig, cnt, {
        "cosMax": COS_PLANE_MAX,
        "band": lambda _p, sg: max(3.5 * sg, floor),
        "residual": S.plane_residual,
        "align": lambda p, X, Nn: np.abs(Nn @ np.array([p["nx"], p["ny"], p["nz"]])),
        "refit": refit,
    }, guide)


def flood_by_normal(g, seed, max_deg, limit=None):
    """Flood over every edge whose two vertex normals turn by less than
    max_deg — the region a plain angle bounds."""
    if not (0 <= seed < g.n):
        return np.zeros(0, dtype=np.int64)
    cos_min = math.cos(math.radians(max(0, max_deg)))
    stamp = np.zeros(g.n, dtype=bool)
    stamp[seed] = True
    out = [np.array([seed])]
    front = out[0]
    total = 1
    limit = limit or g.n
    while len(front) and total < limit:
        nb, owner = g.neighbours(front)
        ok = ~stamp[nb] & ((g.N[nb] * g.N[front][owner]).sum(axis=1) >= cos_min)
        nb = nb[ok]
        _, first = np.unique(nb, return_index=True)
        nb = nb[np.sort(first)][: limit - total]
        stamp[nb] = True
        out.append(nb)
        total += len(nb)
        front = nb
    return np.concatenate(out)


# ---- what each kind reports -------------------------------------------------

FRAME_STEPS = 45
FRAME_SAMPLES = 4096


def _patch_extents(P, region, p):
    Q = P[region]
    m = Q.mean(axis=0)
    n = np.array([p["nx"], p["ny"], p["nz"]])
    u0, v0 = ortho_basis(n)
    step = max(1, math.ceil(len(region) / FRAME_SAMPLES))
    D = Q[::step] - m
    sa, sb = D @ u0, D @ v0
    if len(sa) < 3:
        return None
    best_area, best_angle = math.inf, 0.0
    for t in range(FRAME_STEPS):
        ang = t / FRAME_STEPS * (math.pi / 2)
        c, s = math.cos(ang), math.sin(ang)
        q1, q2 = sa * c + sb * s, -sa * s + sb * c
        area = (q1.max() - q1.min()) * (q2.max() - q2.min())
        if area < best_area:
            best_area, best_angle = area, ang
    ca, sn = math.cos(best_angle), math.sin(best_angle)
    bu = u0 * ca + v0 * sn
    bv = -u0 * sn + v0 * ca
    D = Q - m
    pu, pv = D @ bu, D @ bv
    cu, cv = (pu.min() + pu.max()) / 2, (pv.min() + pv.max()) / 2
    c = m + cu * bu + cv * bv
    off = float(n @ c - p["d"])
    return {"center": c - off * n, "basisU": bu, "basisV": bv, "extentU": (pu.max() - pu.min()) / 2, "extentV": (pv.max() - pv.min()) / 2}


def _orient_to_surface(p, N, region):
    vote = float((N[region] @ np.array([p["nx"], p["ny"], p["nz"]])).sum())
    return p if vote >= 0 else {"nx": -p["nx"], "ny": -p["ny"], "nz": -p["nz"], "d": -p["d"]}


def _plane_out(fin, plane, ext, region):
    same = fin["plane"]["nx"] * plane["nx"] + fin["plane"]["ny"] * plane["ny"] + fin["plane"]["nz"] * plane["nz"] > 0
    lo, hi = (fin["min"], fin["max"]) if same else (-fin["max"], -fin["min"])
    return {
        "kind": "plane", "center": ext["center"], "normal": [plane["nx"], plane["ny"], plane["nz"]],
        "basisU": ext["basisU"], "basisV": ext["basisV"], "extentU": ext["extentU"], "extentV": ext["extentV"],
        "sigma": fin["sigma"], "usedPoints": len(fin["used"]), "regionSize": len(region), "formError": fin["span"],
        "residualMin": lo, "residualMax": hi, "region": region,
    }


def fit_plane_from_seed(g, seeds, settings, guide=None):
    within = {"within": guide["within"]} if guide and guide.get("within") else None

    def finish(grown):
        fin = S.fit_plane_clipped(g.P, grown["region"], settings["sigma"])
        if not fin:
            return None
        plane = _orient_to_surface(fin["plane"], g.N, grown["region"])
        ext = _patch_extents(g.P, grown["region"], plane)
        if not ext or not fin["sigma"] < 0.1 * max(ext["extentU"], ext["extentV"]):
            return None
        return _plane_out(fin, plane, ext, grown["region"])

    fit = seeded_fit(
        g, seeds,
        lambda patch, seed: S.ransac_plane(g.P, guide_patch(g, patch, within) if within else patch, {"seed": seed}),
        lambda c: grow_plane(g, c["inliers"] if within else seeds, c["plane"], c["sigma"], len(c["inliers"]), within),
        finish,
    )
    if fit:
        return fit
    raise FitError("Couldn't fit a plane at this point — try clicking in the middle of a flat surface, away from edges.")


def fit_plane_on_selection(g, sel, settings):
    require_selection(sel, "surface")
    fin = S.fit_plane_clipped(g.P, sel, settings["sigma"])
    if not fin:
        raise FitError("Couldn't fit a plane to the marked surface — the points lie along a line rather than spanning an area.")
    plane = _orient_to_surface(fin["plane"], g.N, sel)
    ext = _patch_extents(g.P, sel, plane)
    if not ext:
        raise FitError("Couldn't measure the extent of the marked surface — try marking a wider patch.")
    return _plane_out(fin, plane, ext, sel)


def _held_radius(settings):
    d = settings.get("knownDiameter")
    return d / 2 if d is not None and math.isfinite(d) and d > 0 else None


def _held_too_far(fin):
    if "free" not in fin:
        return False
    return abs(2 * fin["free"]["r"] - 2 * fin["sphere"]["r"]) > max(1, 0.1 * 2 * fin["sphere"]["r"])


def _held_refusal(fin):
    known = 2 * fin["sphere"]["r"]
    free = 2 * fin["free"]["r"] if "free" in fin else math.nan
    return f"The surface here fits a sphere of Ø {free:.3f} mm, too far from the known Ø {known:.3f} mm to hold it — check the diameter, or that this is the ball meant."


def _sphere_out(fin, region):
    s = fin["sphere"]
    out = {"kind": "sphere", "center": [s["cx"], s["cy"], s["cz"]], "radius": s["r"]}
    if "free" in fin:
        f = fin["free"]
        out["held"] = {"freeDiameter": 2 * f["r"], "shift": math.hypot(f["cx"] - s["cx"], f["cy"] - s["cy"], f["cz"] - s["cz"])}
    out.update(sigma=fin["sigma"], usedPoints=len(fin["used"]), regionSize=len(region), formError=fin["span"], residualMin=fin["min"], residualMax=fin["max"], region=region)
    return out


def _ctr(s):
    return [s["cx"], s["cy"], s["cz"]]


def fit_sphere_from_seed(g, seeds, settings, guide=None):
    guided = guide if has_guide(guide) else None
    seen, held = [], []

    def estimate(patch, seed):
        if not guided:
            return S.ransac_sphere(g.P, patch, {"seed": seed})

        def on(c, vs):
            s = c["sphere"]
            return np.abs(S.sphere_residual(s, g.P[vs])) <= max(3 * c["sigma"], 0.01 * s["r"])

        return guided_estimate(g, patch, guided, lambda p: S.ransac_sphere(g.P, p, {"seed": seed}),
                               lambda c: judge_round(g, guided, c["sphere"]["r"], c["inliers"], radial_from(_ctr(c["sphere"])), True), on, seen)

    def grow(c):
        frm = guided_seeds(g, c["inliers"], guided, radial_from(_ctr(c["sphere"]))) if guided else seeds
        return grow_sphere(g, frm, c["sphere"], c["sigma"], len(c["inliers"]), guided) if len(frm) else None

    def finish(grown):
        fin = S.fit_sphere_clipped(g.P, grown["region"], settings["sigma"], _held_radius(settings))
        if not fin:
            return None
        s = fin["sphere"]
        if not math.isfinite(s["r"]) or s["r"] <= 0:
            return None
        if _held_too_far(fin):
            held.append(fin)
            return None
        if s["r"] > 0.8 * g.bbox_diag or fin["sigma"] > 0.03 * s["r"]:
            return None
        if guided:
            no = judge_round(g, guided, s["r"], grown["region"], radial_from(_ctr(s)), False)
            if no:
                seen.append(no)
                return None
        return _sphere_out(fin, grown["region"])

    fit = seeded_fit(g, seeds, estimate, grow, finish)
    if fit:
        return fit
    if held:
        raise FitError(_held_refusal(held[-1]))
    if guided:
        raise FitError(guide_refusal("sphere", guided, seen))
    raise FitError("Couldn't fit a sphere at this point — try clicking nearer the middle of a sphere.")


def fit_sphere_on_selection(g, sel, settings):
    require_selection(sel, "sphere")
    fin = S.fit_sphere_clipped(g.P, sel, settings["sigma"], _held_radius(settings))
    if not fin or not math.isfinite(fin["sphere"]["r"]) or fin["sphere"]["r"] <= 0:
        raise FitError("Couldn't fit a sphere to the marked surface — it curves too little to place a centre. Mark more of the ball.")
    if _held_too_far(fin):
        raise FitError(_held_refusal(fin))
    return _sphere_out(fin, sel)


def _cyl_result(P, fin, used, extent):
    c = fin["cylinder"]
    cov, lo, hi = S.axial_extents(P, used, c)
    if extent is not used:
        _c, lo, hi = S.axial_extents(P, extent, c)
    length = hi - lo
    if not length > 0:
        return None
    mid = (lo + hi) / 2
    return {
        "kind": "cylinder", "center": [c["px"] + mid * c["ax"], c["py"] + mid * c["ay"], c["pz"] + mid * c["az"]],
        "axis": [c["ax"], c["ay"], c["az"]], "radius": c["r"], "length": length, "coverage": cov,
        "sigma": fin["sigma"], "usedPoints": len(fin["used"]), "regionSize": len(used), "formError": fin["span"],
        "residualMin": fin["min"], "residualMax": fin["max"], "region": used,
    }


def _turned_down_as(s):
    over = f"σ {s['sigma']:.2f} over {s['length']:.1f} mm along the axis"
    if s["why"] == "noise":
        return f"{over} — two surfaces? give within, or seed nearer one end"
    if s["why"] == "arc":
        return f"{over}, {round(s['coverage'])}° of arc — too little of the round to pin it; seed where more of it was scanned"
    return "out of scale with the part — a flat, not a round"


def _cyl_of(c):
    return [c["px"], c["py"], c["pz"]], [c["ax"], c["ay"], c["az"]]


def fit_cylinder_from_seed(g, seeds, settings, guide=None):
    guided = guide if has_guide(guide) else None
    seen, turned = [], []

    def judge(region, model):
        fin = S.fit_cylinder_clipped(g.P, region, model, settings["sigma"])
        if not fin:
            return None
        c = fin["cylinder"]
        if not math.isfinite(c["r"]) or c["r"] <= 0:
            return None
        cov, lo, hi = S.axial_extents(g.P, region, c)

        def seen_as(why):
            return {"radius": c["r"], "sigma": fin["sigma"], "length": hi - lo, "coverage": cov, "why": why}

        if c["r"] > 0.8 * g.bbox_diag:
            return seen_as("scale")
        if fin["sigma"] > 0.03 * c["r"]:
            return seen_as("noise")
        res = _cyl_result(g.P, fin, region, region)
        if not res or not res["coverage"] >= 29:
            return seen_as("arc")
        return {"result": res, "fin": fin}

    def guide_says(res, c, region):
        if not guided:
            return None
        if not axis_agrees(guided, res["axis"]):
            return axis_off(guided, c["r"], res["axis"], res["center"], len(region))
        return judge_round(g, guided, c["r"], region, radial_off(*_cyl_of(c)), False)

    def estimate(patch, seed):
        if not guided:
            return S.ransac_cylinder(g.P, g.N, patch, {"seed": seed})

        def jd(c):
            cy = c["cylinder"]
            p, a = _cyl_of(cy)
            if not axis_agrees(guided, a):
                return axis_off(guided, cy["r"], a, p, len(c["inliers"]))
            return judge_round(g, guided, cy["r"], c["inliers"], radial_off(p, a), True)

        def on(c, vs):
            return np.abs(S.cylinder_residual(c["cylinder"], g.P[vs])) <= max(3 * c["sigma"], 0.01 * c["cylinder"]["r"])

        return guided_estimate(g, patch, guided, lambda p: S.ransac_cylinder(g.P, g.N, p, {"seed": seed}), jd, on, seen)

    def grow(c):
        frm = guided_seeds(g, c["inliers"], guided, radial_off(*_cyl_of(c["cylinder"]))) if guided else seeds
        return grow_cylinder(g, frm, c["cylinder"], c["sigma"], len(c["inliers"]), guided) if len(frm) else None

    def finish(grown):
        j = judge(grown["region"], grown["model"])
        if not j:
            return None
        if "result" not in j:
            turned.append(j)
            if guided:
                seen.append({"radius": j["radius"], "why": _turned_down_as(j)})
            return None
        no = guide_says(j["result"], j["fin"]["cylinder"], grown["region"])
        if no:
            seen.append(no)
            return None
        return j["result"]

    fit = seeded_fit(g, seeds, estimate, grow, finish)
    if fit:
        return fit
    if guided:
        raise FitError(guide_refusal("cylinder", guided, seen))
    uniq = {}
    for t in turned:
        uniq.setdefault(f"{t['radius']:.2f}", t)
    found = sorted(uniq.values(), key=lambda t: t["why"] == "scale")[:3]
    said = f" Found {', '.join('R%.2f (%s)' % (t['radius'], _turned_down_as(t)) for t in found)}." if found else ""
    raise FitError(f"Couldn't fit a cylinder at this point.{said} Try clicking on a clearly curved part of the cylindrical surface.")


MARKED_MIN_COVERAGE = 29  # degrees of arc, as the seeded path asks
MARKED_MAX_SIGMA_R = 0.03  # sigma / radius, as the seeded path asks
MARKED_PLANE_FACTOR = 1.5  # a plane within this many times the round's sigma fits as well


def _arc_coverage(P, sel, model, residual, sigma, scale):
    """The arc the marked points truly span round the axis: only those
    within 2σ of the fitted surface (a floor for clean data), so the far
    reaches of two flats meeting at an edge do not count as round."""
    sel = np.asarray(sel, dtype=np.int64)
    band = max(2.0 * sigma, 1e-6 * max(scale, 1.0))
    near = sel[np.abs(residual(model, P[sel])) <= band]
    if len(near) < 3:
        return 0.0
    return S.axial_extents(P, near, model)[0]


def _judge_marked(g, sel, kind, radius, sigma, coverage, radius_far=None):
    """The seeded path's checks (scale, scatter, arc) and a plane compared,
    for a round fitted to marked points: None, or why it is refused."""
    noun = "cylinder" if kind == "cylinder" else "cone"
    far = radius if radius_far is None else radius_far
    if far > 0.8 * g.bbox_diag:
        return f"Couldn't fit a {noun} to the marked surface: radius {radius:.4g} mm is out of scale with the part ({g.bbox_diag:.4g} mm across) — a flat, not a round. Fit a plane, or mark a surface that curves."
    pl = S.fit_plane_clipped(g.P, sel, 3)
    if pl is not None and pl["sigma"] <= MARKED_PLANE_FACTOR * sigma + 1e-9 * max(g.bbox_diag, 1.0):
        return f"Couldn't fit a {noun} to the marked surface: a plane fits it as well or better (σ {pl['sigma']:.4g} mm against the {noun}'s {sigma:.4g} mm) — it is flat, or curves too little to tell from flat. Fit a plane, or mark more of the way round."
    if sigma > MARKED_MAX_SIGMA_R * radius:
        return f"Couldn't fit a {noun} to the marked surface: σ {sigma:.4g} mm is {100 * sigma / radius:.1f} % of the radius {radius:.4g} mm (over {100 * MARKED_MAX_SIGMA_R:.0f} %) — the points are not on one round: two flats meeting at a sharp edge, or more than one surface marked. Mark only the round."
    if not coverage >= MARKED_MIN_COVERAGE:
        return f"Couldn't fit a {noun} to the marked surface: the points on it span only {coverage:.1f}° of arc (at least {MARKED_MIN_COVERAGE}° needed) — too little of the round to pin it. Mark more of the way round."
    return None


def fit_cylinder_on_selection(g, sel, settings):
    require_selection(sel, "cylindrical surface")
    axis = S.axis_from_normals(g.N, sel)
    init = S.fit_cylinder_on_axis(g.P, sel, axis) if axis is not None else None
    if not init:
        r = S.ransac_cylinder(g.P, g.N, sel, {"seed": 0x5EED})
        init = r and r["cylinder"]
    if not init:
        raise FitError("Couldn't find an axis in the marked surface — it curves too little to be told from a plane. Mark more of the way around the cylinder.")
    fin = S.fit_cylinder_clipped(g.P, sel, init, settings["sigma"])
    if not fin or not math.isfinite(fin["cylinder"]["r"]) or fin["cylinder"]["r"] <= 0:
        raise FitError("Couldn't fit a cylinder to the marked surface.")
    res = _cyl_result(g.P, fin, sel, sel)
    if not res:
        raise FitError("Couldn't measure the length of the marked surface.")
    c = fin["cylinder"]
    res["coverage"] = float(_arc_coverage(g.P, fin["used"], c, S.cylinder_residual, fin["sigma"], c["r"]))
    no = _judge_marked(g, sel, "cylinder", float(c["r"]), float(fin["sigma"]), res["coverage"])
    if no:
        raise FitError(no)
    res["radius"] = float(res["radius"])
    return res


def _cone_report(P, region, c):
    cov, lo, hi = S.axial_extents(P, region, c)
    length = hi - lo
    if not length > 0:
        return None
    tan = math.tan(c["phi"])
    mid = (lo + hi) / 2
    radius = c["r"] + mid * tan
    if not radius > 0 or not math.isfinite(radius):
        return None
    return {
        "center": [c["px"] + mid * c["ax"], c["py"] + mid * c["ay"], c["pz"] + mid * c["az"]], "axis": [c["ax"], c["ay"], c["az"]],
        "halfAngle": math.degrees(c["phi"]), "radius": radius, "radius1": max(0.0, c["r"] + lo * tan), "radius2": c["r"] + hi * tan,
        "length": length, "coverage": cov,
    }


def _cone_out(rep, fin, region):
    out = {"kind": "cone"}
    out.update(rep)
    out.update(sigma=fin["sigma"], usedPoints=len(fin["used"]), regionSize=len(region), formError=fin["span"], residualMin=fin["min"], residualMax=fin["max"], region=region)
    return out


def _cone_outward(c):
    cs, sn = math.cos(c["phi"]), math.sin(c["phi"])
    a = np.array([c["ax"], c["ay"], c["az"]])

    def f(X):
        _e, W, _t, rho = S.cone_slant(c, X)
        O = cs * W - sn * a
        return np.where((rho > 1e-12)[:, None], O, 0.0)

    return f


def fit_cone_from_seed(g, seeds, settings, guide=None):
    guided = guide if has_guide(guide) else None
    seen = []

    def estimate(patch, seed):
        if not guided:
            return S.ransac_cone(g.P, g.N, patch, {"seed": seed})

        def jd(c):
            k = c["cone"]
            p, a = _cyl_of(k)
            if not axis_agrees(guided, a):
                return axis_off(guided, k["r"], a, p, len(c["inliers"]))
            return judge_round(g, guided, k["r"], c["inliers"], _cone_outward(k), True)

        def on(c, vs):
            return np.abs(S.cone_residual(c["cone"], g.P[vs])) <= max(3 * c["sigma"], 0.01 * c["cone"]["r"])

        return guided_estimate(g, patch, guided, lambda p: S.ransac_cone(g.P, g.N, p, {"seed": seed}), jd, on, seen)

    def grow(c):
        frm = guided_seeds(g, c["inliers"], guided, _cone_outward(c["cone"])) if guided else seeds
        return grow_cone(g, frm, c["cone"], c["sigma"], len(c["inliers"]), guided) if len(frm) else None

    def finish(grown):
        fin = S.fit_cone_clipped(g.P, grown["region"], grown["model"], settings["sigma"])
        if not fin:
            return None
        c = fin["cone"]
        if not math.isfinite(c["r"]) or c["r"] <= 0 or not abs(c["phi"]) < 1.45:
            return None
        rep = _cone_report(g.P, grown["region"], c)
        if not rep or rep["radius2"] > 0.8 * g.bbox_diag or fin["sigma"] > 0.03 * rep["radius"] or not rep["coverage"] >= 29:
            return None
        if guided:
            no = axis_off(guided, rep["radius"], rep["axis"], rep["center"], len(grown["region"])) if not axis_agrees(guided, rep["axis"]) else judge_round(g, guided, rep["radius"], grown["region"], _cone_outward(c), False)
            if no:
                seen.append(no)
                return None
        return _cone_out(rep, fin, grown["region"])

    fit = seeded_fit(g, seeds, estimate, grow, finish)
    if fit:
        return fit
    if guided:
        raise FitError(guide_refusal("cone", guided, seen))
    raise FitError("Couldn't fit a cone at this point — try clicking in the middle of the tapered surface, away from its edges.")


def fit_cone_on_selection(g, sel, settings):
    require_selection(sel, "conical surface")
    axis = S.cone_axis_from_normals(g.N, sel)
    init = S.fit_cone_on_axis(g.P, sel, axis) if axis is not None else None
    if not init:
        r = S.ransac_cone(g.P, g.N, sel, {"seed": 0x5EED})
        init = r and r["cone"]
    if not init:
        raise FitError("Couldn't find an axis in the marked surface — it curves too little to be told from a plane. Mark more of the way around the cone.")
    fin = S.fit_cone_clipped(g.P, sel, init, settings["sigma"])
    if not fin or not math.isfinite(fin["cone"]["r"]) or fin["cone"]["r"] <= 0 or not abs(fin["cone"]["phi"]) < 1.45:
        raise FitError("Couldn't fit a cone to the marked surface.")
    rep = _cone_report(g.P, sel, fin["cone"])
    if not rep:
        raise FitError("Couldn't measure the extent of the marked surface.")
    rep["coverage"] = float(_arc_coverage(g.P, fin["used"], fin["cone"], S.cone_residual, fin["sigma"], rep["radius"]))
    no = _judge_marked(g, sel, "cone", float(rep["radius"]), float(fin["sigma"]), rep["coverage"], float(max(rep["radius1"], rep["radius2"])))
    if no:
        raise FitError(no)
    return _cone_out(rep, fin, sel)


TORUS_MAX_R_DIAGS = 5
SEED_COS_MAX = math.cos(math.radians(32))


def _rnd(x):
    return round(x) if abs(x) >= 100 else round(x * 100) / 100


def _implausible(t, g):
    if not math.isfinite(t["R"]) or not math.isfinite(t["r"]) or not t["r"] > 0:
        return {"why": "no torus", "size": False}
    if not t["R"] > t["r"] * 0.999:
        return {"why": f"R {_rnd(t['R'])} is no larger than r {_rnd(t['r'])} — a spindle, not a round", "size": False}
    max_r = TORUS_MAX_R_DIAGS * g.bbox_diag
    if not t["R"] < max_r:
        return {"why": f"R {_rnd(t['R'])} is past the limit of {TORUS_MAX_R_DIAGS} × the scan's diagonal ({_rnd(max_r)} mm) — the surface bends too little the long way to place the spine; fit a cylinder or a B-spline surface", "size": True}
    if not t["r"] < 0.5 * g.bbox_diag:
        return {"why": f"r {_rnd(t['r'])} is past the limit of half the scan's diagonal ({_rnd(0.5 * g.bbox_diag)} mm)", "size": True}
    return None


def _torus_out(g, t, fin, region):
    t = S.canonical_torus(t, g.N, fin["used"])
    tube, spine = S.torus_coverage(t, g.P, fin["used"])
    return {
        "kind": "torus", "center": [t["cx"], t["cy"], t["cz"]], "axis": [t["ax"], t["ay"], t["az"]], "majorRadius": t["R"], "minorRadius": t["r"],
        "tubeCoverage": tube, "spineCoverage": spine, "sigma": fin["sigma"], "usedPoints": len(fin["used"]), "regionSize": len(region),
        "formError": fin["span"], "residualMin": fin["min"], "residualMax": fin["max"], "region": region,
    }


def fit_torus_from_seed(g, seeds, settings, guide=None):
    within = {"within": guide["within"]} if guide and guide.get("within") else None
    refused = [None]

    def plausible(t):
        no = _implausible(t, g)
        if no and no["size"]:
            refused[0] = no["why"]
        return not no

    def estimate(patch, seed):
        c = S.ransac_torus(g.P, g.N, guide_patch(g, patch, within) if within else patch, {"seed": seed})
        return c if c and plausible(c["torus"]) else None

    def on_it(t, sigma):
        band = max(3 * sigma, 0.02 * t["r"])
        sd = np.asarray(seeds)
        X = g.P[sd]
        if np.any(np.abs(S.torus_residual(t, X)) > band):
            return False
        return bool(np.all(S.torus_normal_align(t, X, g.N[sd]) >= SEED_COS_MAX))

    def finish(grown):
        fin = S.fit_torus_clipped(g.P, grown["region"], settings["sigma"], grown["model"])
        if not fin or not plausible(fin["torus"]) or fin["sigma"] > 0.05 * fin["torus"]["r"] or not on_it(fin["torus"], fin["sigma"]):
            return None
        return _torus_out(g, fin["torus"], fin, grown["region"])

    fit = seeded_fit(g, seeds, estimate, lambda c: grow_torus(g, c["inliers"] if within else seeds, c["torus"], c["sigma"], len(c["inliers"]), within), finish)
    if fit:
        return fit
    if refused[0]:
        raise FitError(f"Couldn't fit a torus at this point: the one found was turned down — {refused[0]}.")
    raise FitError("Couldn't fit a torus at this point — try clicking on the middle of a round or a bend.")


def fit_torus_on_selection(g, sel, settings):
    require_selection(sel, "round")
    cand = S.ransac_torus(g.P, g.N, sel, {"seed": int(sel[0]) if len(sel) else 1})
    fin = S.fit_torus_clipped(g.P, sel, settings["sigma"], cand["torus"]) if cand else None
    no = _implausible(fin["torus"], g) if fin else None
    if no and no["size"]:
        raise FitError(f"Couldn't fit a torus to the marked surface: {no['why']}.")
    if not fin or no:
        raise FitError("Couldn't fit a torus to the marked surface — it has to curve two ways, like a fillet's round or a bend. Mark more of it.")
    return _torus_out(g, fin["torus"], fin, sel)


FROM_SEED = {"plane": fit_plane_from_seed, "sphere": fit_sphere_from_seed, "cylinder": fit_cylinder_from_seed, "cone": fit_cone_from_seed, "torus": fit_torus_from_seed}
ON_SELECTION = {"plane": fit_plane_on_selection, "sphere": fit_sphere_on_selection, "cylinder": fit_cylinder_on_selection, "cone": fit_cone_on_selection, "torus": fit_torus_on_selection}

