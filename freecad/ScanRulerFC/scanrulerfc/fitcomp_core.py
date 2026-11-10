# SPDX-License-Identifier: AGPL-3.0-only
# Calibrate a printer from a scan of a print: the reference's flat walls,
# floors, tops and upright holes and bosses read on the scan, one weighted
# least-squares fit of what the printer did (scale on X, Y, Z; contour
# offset; hole offset; elephant foot), what is worth changing and the
# slicer's new values, and the reference pre-compensated. Ported from
# ScanRuler by CNC Kitchen: plugins/fit-comp/core/frame.ts, features.ts,
# measure.ts, solve.ts, suggest.ts, noiseCheck.ts and compensate.ts. The
# comments on why are upstream's, shortened.

import math

import numpy as np

from . import noise_core as NC

# ---- the build frame -----------------------------------------------------------

UPS = ["+z", "-z", "+x", "-x", "+y", "-y"]
ROWS = {
    "+z": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "-z": [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
    "+x": [[0, 1, 0], [0, 0, 1], [1, 0, 0]], "-x": [[0, 1, 0], [0, 0, -1], [-1, 0, 0]],
    "+y": [[0, 0, 1], [1, 0, 0], [0, 1, 0]], "-y": [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
}


def to_build(up, P):
    return np.asarray(P, float) @ np.array(ROWS[up], float).T


def from_build(up, P):
    return np.asarray(P, float) @ np.array(ROWS[up], float)


def r4(v):
    return round(float(v), 4) + 0.0


# ---- features --------------------------------------------------------------------

AXIS_COS = math.cos(math.radians(2))
UPRIGHT = 0.1
PLANE_BIN = 0.02
MIN_PLANE_AREA = 4
MIN_COVERAGE = 270


def fit_circle(xs, ys):
    """Kåsa, then Gauss–Newton on the geometric distance."""
    x, y = np.asarray(xs, float), np.asarray(ys, float)
    if len(x) < 3:
        return None
    mx, my = x.mean(), y.mean()
    u, v = x - mx, y - my
    suu, svv, suv = (u * u).sum(), (v * v).sum(), (u * v).sum()
    det = suu * svv - suv * suv
    if abs(det) < 1e-12:
        return None
    b1 = ((u ** 3).sum() + (u * v * v).sum()) / 2
    b2 = ((v ** 3).sum() + (v * u * u).sum()) / 2
    cx = mx + (b1 * svv - b2 * suv) / det
    cy = my + (b2 * suu - b1 * suv) / det
    r = np.hypot(x - cx, y - cy).mean()
    for _ in range(5):
        dx, dy = x - cx, y - cy
        d = np.hypot(dx, dy)
        d[d == 0] = 1e-12
        res = d - r
        J = np.column_stack([-dx / d, -dy / d, -np.ones_like(d)])
        try:
            step = np.linalg.solve(J.T @ J, -J.T @ res)
        except np.linalg.LinAlgError:
            break
        cx, cy, r = cx + step[0], cy + step[1], r + step[2]
        if np.linalg.norm(step) < 1e-9:
            break
    rms = math.sqrt(float(((np.hypot(x - cx, y - cy) - r) ** 2).mean()))
    return {"cx": float(cx), "cy": float(cy), "radius": float(r), "rms": rms}


def _coverage(x, y, cx, cy):
    a = np.sort(np.arctan2(y - cy, x - cx))
    gap = max(a[0] + 2 * math.pi - a[-1], float(np.diff(a).max()) if len(a) > 1 else 0.0)
    return 360 - math.degrees(gap)


def find_features(V, F):
    """Flat faces square to an axis and upright holes and bosses on the
    reference, in the build frame."""
    V, F = np.asarray(V, float), np.asarray(F, np.int64)
    T = V[F]
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    ln = np.linalg.norm(n, axis=1)
    area = ln / 2
    N = np.zeros_like(n)
    N[ln > 0] = n[ln > 0] / ln[ln > 0, None]
    z_min, z_max = float(V[:, 2].min()), float(V[:, 2].max())

    # Upright round walls: upright triangles joined through shared corners.
    key = np.round(V * 1e4).astype(np.int64)
    _, vid = np.unique(key, axis=0, return_inverse=True)
    vid = vid.reshape(-1)
    up = np.nonzero((area > 0) & (np.abs(N[:, 2]) < UPRIGHT))[0]
    parent = {int(t): int(t) for t in up}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    owner = {}
    for t in up:
        for k in range(3):
            v = int(vid[F[t, k]])
            o = owner.get(v)
            if o is None:
                owner[v] = int(t)
            else:
                ra, rb = find(o), find(int(t))
                if ra != rb:
                    parent[ra] = rb
    groups = {}
    for t in up:
        groups.setdefault(find(int(t)), []).append(int(t))
    used = set()
    circles = []
    for g in groups.values():
        if len(g) < 8:
            continue
        P = T[g].reshape(-1, 3)
        c = fit_circle(P[:, 0], P[:, 1])
        if not c or c["radius"] < 0.5 or c["radius"] > 150 or c["rms"] > 0.01 + 0.02 * c["radius"]:
            continue
        cov = _coverage(P[:, 0], P[:, 1], c["cx"], c["cy"])
        if cov < MIN_COVERAGE:
            continue
        gi = np.array(g)
        out = (area[gi] * (N[gi, 0] * (T[gi, 0, 0] - c["cx"]) + N[gi, 1] * (T[gi, 0, 1] - c["cy"]))).sum()
        circles.append({"id": "", "kind": "hole" if out < 0 else "boss", "center": [r4(c["cx"]), r4(c["cy"])], "radius": r4(c["radius"]),
                        "zMin": r4(P[:, 2].min()), "zMax": r4(P[:, 2].max()), "coverage": round(cov), "fit": r4(c["rms"])})
        used.update(g)
    circles.sort(key=lambda c: (c["kind"], c["radius"], c["center"][0]))
    for i, c in enumerate(circles):
        c["id"] = f"{'H' if c['kind'] == 'hole' else 'B'}{i + 1}"

    bins = {}
    for t in range(len(F)):
        if t in used or area[t] <= 0:
            continue
        for axis in range(3):
            nv = N[t, axis]
            if abs(nv) < AXIS_COS:
                continue
            k = (axis, 1 if nv > 0 else -1, int(round(T[t, 0, axis] / PLANE_BIN)))
            bins.setdefault(k, []).append(t)
    merged = {}
    for k in sorted(bins):
        axis, sign, b = k
        near = next((m for m in ((axis, sign, b - 1), (axis, sign, b + 1)) if m in merged), None)
        if near:
            merged[near] += bins[k]
        else:
            merged[k] = list(bins[k])
    planes = []
    for (axis, sign, _b), lst in merged.items():
        idx = np.array(lst)
        total = float(area[idx].sum())
        if total < MIN_PLANE_AREA:
            continue
        tris = T[idx]
        off = float((area[idx] * tris[:, :, axis].mean(axis=1)).sum() / total)
        P = tris.reshape(-1, 3)
        planes.append({"id": "", "kind": "plane", "axis": axis, "sign": sign, "offset": r4(off), "area": round(total, 1), "triangles": tris,
                       "min": P.min(0).tolist(), "max": P.max(0).tolist()})
    planes.sort(key=lambda p: (p["axis"], p["offset"], p["sign"]))
    count = {}
    for p in planes:
        base = f"{'+' if p['sign'] > 0 else '-'}{'XYZ'[p['axis']]}"
        count[base] = count.get(base, 0) + 1
        p["id"] = f"{base}{count[base]}"
    return {"planes": planes, "circles": circles, "zMin": z_min, "zMax": z_max}


def features_out(f):
    """Features as an answer gives them: no triangles."""
    return {"planes": [{k: v for k, v in p.items() if k != "triangles"} for p in f["planes"]], "circles": f["circles"],
            "zMin": r4(f["zMin"]), "zMax": r4(f["zMax"])}


# ---- measure ----------------------------------------------------------------------

DEFAULT_MEASURE = {"band": 1.0, "footBand": 0.2, "footAbove": 2.5}
INDEPENDENT_MM2 = 0.25
MASK_CELL = 0.5
MIN_POINTS = 30
FACING = 0.5


def _median(x):
    return float(np.median(x)) if len(x) else 0.0


def _mad(x, m):
    return 1.4826 * _median(np.abs(np.asarray(x) - m))


def _footprint(p, shrink):
    ua, va = (1, 2) if p["axis"] == 0 else (0, 2) if p["axis"] == 1 else (0, 1)
    u0, v0 = p["min"][ua] - MASK_CELL, p["min"][va] - MASK_CELL
    nu = math.ceil((p["max"][ua] - p["min"][ua]) / MASK_CELL) + 3
    nv = math.ceil((p["max"][va] - p["min"][va]) / MASK_CELL) + 3
    cells = np.zeros((nu, nv), bool)
    for tri in p["triangles"]:
        (ax, ay), (bx, by), (cx, cy) = tri[0, [ua, va]], tri[1, [ua, va]], tri[2, [ua, va]]
        d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        if d == 0:
            continue
        iu0, iu1 = max(0, int((min(ax, bx, cx) - u0) // MASK_CELL)), min(nu - 1, int((max(ax, bx, cx) - u0) // MASK_CELL))
        iv0, iv1 = max(0, int((min(ay, by, cy) - v0) // MASK_CELL)), min(nv - 1, int((max(ay, by, cy) - v0) // MASK_CELL))
        IU, IV = np.meshgrid(np.arange(iu0, iu1 + 1), np.arange(iv0, iv1 + 1), indexing="ij")
        x, y = u0 + (IU + 0.5) * MASK_CELL, v0 + (IV + 0.5) * MASK_CELL
        w1 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / d
        w2 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / d
        w3 = 1 - w1 - w2
        cells[IU, IV] |= (w1 >= -1e-9) & (w2 >= -1e-9) & (w3 >= -1e-9)
    mask = cells
    for _ in range(shrink):
        nxt = np.zeros_like(mask)
        nxt[1:-1, 1:-1] = mask[1:-1, 1:-1] & mask[:-2, 1:-1] & mask[2:, 1:-1] & mask[1:-1, :-2] & mask[1:-1, 2:]
        mask = nxt

    def inside(u, v):
        iu = np.floor((np.asarray(u) - u0) / MASK_CELL).astype(np.int64)
        iv = np.floor((np.asarray(v) - v0) / MASK_CELL).astype(np.int64)
        ok = (iu >= 0) & (iv >= 0) & (iu < nu) & (iv < nv)
        out = np.zeros(len(iu), bool)
        out[ok] = mask[iu[ok], iv[ok]]
        return out

    return inside


def measure(features, scan, opts=None, normals=None):
    o = {**DEFAULT_MEASURE, **(opts or {})}
    band, foot_band, foot_above = o["band"], o["footBand"], o["footAbove"]
    S = np.asarray(scan, float)
    Nn = None if normals is None else np.asarray(normals, float)
    bed = features["zMin"]
    planes, missed = [], []
    for p in features["planes"]:
        ax = p["axis"]
        ua, va = (1, 2) if ax == 0 else (0, 2) if ax == 1 else (0, 1)
        inside = _footprint(p, 1)
        lo, hi = np.array(p["min"], float), np.array(p["max"], float)
        lo[ax] -= band
        hi[ax] += band
        near = np.nonzero(((S >= lo) & (S <= hi)).all(1))[0]
        d = p["sign"] * (S[near, ax] - p["offset"])
        keep = np.abs(d) <= band
        if Nn is not None:
            keep &= p["sign"] * Nn[near, ax] >= FACING
        near, d = near[keep], d[keep]
        u, v, z = S[near, ua], S[near, va], S[near, 2] - bed
        upright = ax != 2
        on_bed = upright and p["min"][2] - bed < 0.05
        ins = inside(u, v)
        low = d[on_bed & (z < foot_band + 0.05) & (z > 0.02) & inside(u, np.maximum(v, bed + MASK_CELL * 2))] if on_bed else np.zeros(0)
        m_main = ins & ~(upright & (z < foot_band + 0.5))
        main = d[m_main]
        above = d[m_main & (z >= foot_band + 0.5) & (z < foot_band + foot_above)] if on_bed else np.zeros(0)
        if len(main) < MIN_POINTS:
            missed.append(p["id"])
            continue
        m = _median(main)
        s = _mad(main, m)
        n_eff = max(1.0, min(len(main), p["area"] / INDEPENDENT_MM2))
        rd = {"id": p["id"], "axis": ax, "sign": p["sign"], "nominal": p["offset"], "offset": r4(m), "se": r4(max(1.2533 * s / math.sqrt(n_eff), 1e-4)),
              "scatter": r4(s), "points": int(len(main))}
        if on_bed and len(low) >= MIN_POINTS / 2 and len(above) >= MIN_POINTS / 2:
            ml, ma = _median(low), _median(above)
            se = math.hypot(1.2533 * _mad(low, ml) / math.sqrt(len(low)), 1.2533 * _mad(above, ma) / math.sqrt(len(above)))
            rd["foot"] = {"band": r4(ml), "above": r4(ma), "se": r4(max(se, 1e-4)), "points": int(len(low))}
        planes.append(rd)

    circles = []
    for c in features["circles"]:
        reach = c["radius"] + band
        cx, cy = c["center"]
        near = np.nonzero((np.abs(S[:, 0] - cx) <= reach) & (np.abs(S[:, 1] - cy) <= reach) & (S[:, 2] >= c["zMin"]) & (S[:, 2] <= c["zMax"]))[0]
        x, y, z = S[near, 0], S[near, 1], S[near, 2]
        r = np.hypot(x - cx, y - cy)
        keep = np.abs(r - c["radius"]) <= band
        if Nn is not None:
            radial = np.where(r > 0, (Nn[near, 0] * (x - cx) + Nn[near, 1] * (y - cy)) / np.maximum(r, 1e-12), 0)
            keep &= (radial if c["kind"] == "boss" else -radial) >= FACING
        on_bed = c["zMin"] - bed < 0.05
        h = z - bed
        in_foot = keep & on_bed & (h > 0.02) & (h < foot_band + 0.05)
        wall = keep & ~in_foot & (z >= c["zMin"] + 0.3) & (z <= c["zMax"] - 0.3) & ~(on_bed & (h < foot_band + 0.5))
        if wall.sum() < MIN_POINTS:
            missed.append(c["id"])
            continue
        fit = fit_circle(x[wall], y[wall])
        if not fit:
            missed.append(c["id"])
            continue
        res = np.hypot(x[wall] - fit["cx"], y[wall] - fit["cy"]) - fit["radius"]
        s = _mad(res, _median(res))
        area = 2 * math.pi * c["radius"] * (c["zMax"] - c["zMin"])
        n_eff = max(1.0, min(int(wall.sum()), area / INDEPENDENT_MM2))
        rd = {"id": c["id"], "kind": c["kind"], "nominal": {"center": c["center"], "radius": c["radius"]}, "center": [r4(fit["cx"]), r4(fit["cy"])],
              "radius": r4(fit["radius"]), "seRadius": r4(max(1.2533 * s / math.sqrt(n_eff), 1e-4)),
              "seCenter": r4(max(1.2533 * s * math.sqrt(2) / math.sqrt(n_eff), 1e-4)), "scatter": r4(s), "points": int(wall.sum())}
        if on_bed and in_foot.sum() >= MIN_POINTS / 2:
            rs = np.hypot(x[in_foot] - fit["cx"], y[in_foot] - fit["cy"])
            mr = _median(rs)
            rd["foot"] = {"radius": r4(mr), "se": r4(max(1.2533 * _mad(rs, mr) / math.sqrt(len(rs)), 1e-4)), "points": int(len(rs))}
        circles.append(rd)
    flat = [p["scatter"] for p in planes if p["scatter"] > 0]
    return {"planes": planes, "circles": circles, "noise": r4(_median(flat)), "missed": missed}


# ---- solve ---------------------------------------------------------------------------

NAMES = ["sx", "sy", "sz", "tx", "ty", "tz", "contour", "hole"]
PRIOR = np.array([0.05, 0.05, 0.05, 10, 10, 10, 1, 1], float)
PRIOR_MEAN = np.array([1, 1, 1, 0, 0, 0, 0, 0], float)
HUBER = 3


def solve(readings, inner=(), floor=0.003):
    rows = []

    def row(rid, entries, y, sigma):
        a = np.zeros(8)
        for k, v in entries:
            a[k] += v
        rows.append((rid, a, y, math.hypot(sigma, floor)))

    for p in readings["planes"]:
        measured = p["nominal"] + p["sign"] * p["offset"]
        if p["axis"] == 2:
            row(p["id"], [(2, p["nominal"]), (5, 1)], measured, p["se"])
        else:
            row(p["id"], [(p["axis"], p["nominal"]), (3 + p["axis"], 1), (7 if p["id"] in inner else 6, p["sign"])], measured, p["se"])
    for c in readings["circles"]:
        r = c["nominal"]["radius"]
        row(f"{c['id']} radius", [(0, r / 2), (1, r / 2), (6, 1) if c["kind"] == "boss" else (7, -1)], c["radius"], c["seRadius"])
        row(f"{c['id']} centre x", [(0, c["nominal"]["center"][0]), (3, 1)], c["center"][0], c["seCenter"])
        row(f"{c['id']} centre y", [(1, c["nominal"]["center"][1]), (4, 1)], c["center"][1], c["seCenter"])
    A = np.array([r[1] for r in rows]) if rows else np.zeros((0, 8))
    y = np.array([r[2] for r in rows])
    sig = np.array([r[3] for r in rows])
    w = np.ones(len(rows))
    x = PRIOR_MEAN.copy()
    cov = np.diag(PRIOR ** 2)
    for _ in range(3):
        W = w / sig ** 2 if len(rows) else np.zeros(0)
        ata = (A.T * W) @ A + np.diag(1 / PRIOR ** 2)
        atb = (A.T * W) @ y + PRIOR_MEAN / PRIOR ** 2
        cov = np.linalg.inv(ata)
        x = cov @ atb
        if len(rows):
            z = np.abs(y - A @ x) / sig
            w = np.where(z <= HUBER, 1.0, HUBER / np.maximum(z, 1e-12))

    def est(k):
        se = math.sqrt(max(0.0, float(cov[k, k])))
        return {"value": float(x[k]), "se": se, "determined": bool(se < 0.5 * PRIOR[k])}

    res = y - A @ x if len(rows) else np.zeros(0)
    chi = float(((res / sig) ** 2).sum()) if len(rows) else 0.0
    outliers = [{"id": rows[i][0], "residual": round(float(res[i]), 4), "sigma": round(float(sig[i]), 4)} for i in range(len(rows)) if abs(res[i]) > 4 * sig[i]]
    used = int((np.abs(A) > 0).any(0).sum()) if len(rows) else 0
    dof = max(1, len(rows) - used)
    return {"scale": {"x": est(0), "y": est(1), "z": est(2)}, "contour": est(6), "hole": est(7), "foot": _foot(readings),
            "fit": round(chi / dof, 2), "dof": dof, "outliers": outliers}


def _foot(readings):
    items = []
    for p in readings["planes"]:
        if p.get("foot"):
            items.append((p["foot"]["band"] - p["foot"]["above"], p["foot"]["se"]))
    for c in readings["circles"]:
        if c.get("foot"):
            e = c["foot"]["radius"] - c["radius"] if c["kind"] == "boss" else c["radius"] - c["foot"]["radius"]
            items.append((e, math.hypot(c["foot"]["se"], c["seRadius"])))
    if not items:
        return None
    wsum = s = 0.0
    for e, se in items:
        wi = 1 / max(se, 1e-3) ** 2
        wsum += wi
        s += wi * e
    return {"value": s / wsum, "se": 1 / math.sqrt(wsum), "readings": len(items)}


# ---- suggest -------------------------------------------------------------------------

STEP_MM, STEP_SCALE = 0.02, 0.001


def _r(v, d=3):
    return round(float(v), d) + 0.0


def corrections(sol):
    out = []

    def judge(q, e, step, base, words):
        off = e["value"] - base
        if not e["determined"]:
            out.append({"quantity": q, "read": _r(e["value"], 4), "se": _r(e["se"], 4), "change": False, "why": f"not separable on this part: {words}"})
            return
        big = abs(off) >= max(3 * e["se"], step)
        why = (f"{_r(abs(off) / e['se'], 1)} standard errors from {'true scale' if base == 1 else 'zero'}" if big
               else f"under the {'0.1 %' if base == 1 else '0.02 mm'} worth changing" if abs(off) < step else f"within what this scan resolves (±{_r(3 * e['se'], 4)})")
        out.append({"quantity": q, "read": _r(e["value"], 4), "se": _r(e["se"], 4), "change": bool(big), "why": why})

    sx, sy = sol["scale"]["x"], sol["scale"]["y"]
    xy = {"value": (sx["value"] + sy["value"]) / 2, "se": math.hypot(sx["se"], sy["se"]) / 2, "determined": sx["determined"] and sy["determined"]}
    judge("scaleXY", xy, STEP_SCALE, 1, "scale needs features far apart (hole centres) or of different sizes")
    judge("scaleZ", sol["scale"]["z"], STEP_SCALE, 1, "Z scale needs two or more flat floors or tops at different heights")
    judge("contour", sol["contour"], STEP_MM, 0, "the contour offset needs outer walls or bosses beside features that pin the scale")
    judge("hole", sol["hole"], STEP_MM, 0, "the hole offset needs at least one hole")
    f = sol["foot"]
    if f:
        big = abs(f["value"]) >= max(3 * f["se"], STEP_MM)
        out.append({"quantity": "foot", "read": _r(f["value"], 4), "se": _r(f["se"], 4), "change": big and f["value"] > 0,
                    "why": "the first layer is not wider than the wall above it" if f["value"] <= 0 else f"{_r(f['value'] / f['se'], 1)} standard errors out" if big else "within what this scan resolves"})
    else:
        out.append({"quantity": "foot", "read": 0.0, "se": 0.0, "change": False, "why": "no wall stands on the bed in the scan"})
    return out


def slicer_changes(cs, keymap, current=None):
    current = current or {}
    out = []
    for c in cs:
        spec = keymap["keys"].get(c["quantity"])
        if not spec or not c["change"]:
            continue
        if spec["kind"] in ("unsupported", "objectScale") or not spec.get("key"):
            pct = _r(100 / c["read"], 3) if spec["kind"] == "objectScale" else None
            out.append({"quantity": c["quantity"], "key": None, "from": None, "to": pct, "unit": "% object scale" if pct is not None else "", **({"note": spec["note"]} if spec.get("note") else {})})
            continue
        sign = spec.get("sign", 1)
        k = spec["key"]
        if spec["kind"] == "add":
            frm = current.get(k, 0.0)
            to, unit = _r(frm + sign * c["read"], 3), "mm"
        elif spec["kind"] == "percentMeasured":
            frm = current.get(k, 100.0)
            to, unit = _r(frm * c["read"], 2), "%"
        else:
            frm = current.get(k, 0.0)
            to, unit = _r(100 * (1 - c["read"] * (1 - frm / 100)), 2), "%"
        out.append({"quantity": c["quantity"], "key": k, **({"section": spec["section"]} if spec.get("section") else {}), "from": frm, "to": to, "unit": unit,
                    **({"note": spec["note"]} if spec.get("note") else {})})
    return out


def ini_fragment(changes, keymap, header):
    lines = [f"; {header}", f"; {keymap['label']} keys" + (f" ({keymap['checked']})" if keymap.get("checked") else "")]
    for c in changes:
        if c["key"] and c["to"] is not None:
            lines.append(f"{c['key']} = {c['to']}%" if c["unit"] == "%" else f"{c['key']} = {c['to']}")
        elif c.get("note"):
            lines.append(f"; {c['quantity']}: {c['note']}" + (f" ({c['to']}{c['unit']})" if c["to"] is not None else ""))
    return "\n".join(lines) + "\n"


LENGTHS = ("contour", "hole", "foot")
WORDS = {"contour": "the contour offset", "hole": "the hole offset", "foot": "the elephant foot", "scaleXY": "the XY scale", "scaleZ": "the Z scale"}


def judge_noise(cs, scatter, plan):
    if not plan and not scatter > 0:
        return None
    sigma = NC.at_least(scatter if scatter > 0 else 0.0, plan)
    frm = (f"scanner {plan['profile']['name']}" if plan["source"] == "profile" else "measured on this scan") if plan and plan["sigmaMm"] >= scatter else "the run's scatter on flat faces"
    near = [{"quantity": c["quantity"], "read": c["read"]} for c in cs if c["change"] and c["quantity"] in LENGTHS and abs(c["read"]) < NC.TRUST_FACTOR * sigma]
    worse = None
    if plan and plan.get("profile") and scatter >= NC.WELL_ABOVE * plan["profile"]["sigmaMm"]:
        worse = {"scatterMm": scatter, "usualMm": plan["profile"]["sigmaMm"], "scanner": plan["profile"]["name"]}
    return {"sigmaMm": sigma, "from": frm, "nearNoise": near, "scanWorse": worse}


def noise_notes(j, poor):
    if not j:
        return []
    out = []
    if j["nearNoise"]:
        items = ", ".join(f"{WORDS[n['quantity']]} ({n['read']:g} mm)" for n in j["nearNoise"])
        out.append(f"{items} {'is' if len(j['nearNoise']) == 1 else 'are'} under three times the scan noise ({j['sigmaMm']:g} mm, {j['from']}): averaged over many points, "
                   "but finer than this scan is trusted for. Confirm on a second print or scan before changing the slicer.")
    if poor and j["scanWorse"]:
        w = j["scanWorse"]
        out.append(f"The scan's scatter on the flat faces ({w['scatterMm']:g} mm) is well above the {w['usualMm']:g} mm {w['scanner']} usually gives: the scan may be what fits poorly. Rescan before blaming the printer.")
    return out


# ---- compensate ------------------------------------------------------------------------

CUP = 0.3
SAME_WALL = math.cos(math.radians(10))


def compensate(V, F, features, c):
    """The reference in the build frame made so the print comes out true:
    printed = (model + offset) × scale, so model = part / scale − offset."""
    V, F = np.asarray(V, float), np.asarray(F, np.int64)
    n = len(V)
    walls = [[] for _ in range(n)]
    T = V[F]
    cr = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    ln = np.linalg.norm(cr, axis=1)
    for t in np.nonzero((ln > 0) & (np.abs(cr[:, 2]) <= CUP * np.maximum(ln, 1e-300)))[0]:
        h = math.hypot(cr[t, 0], cr[t, 1])
        wx, wy = cr[t, 0] / h, cr[t, 1] / h
        for v in F[t]:
            lst = walls[v]
            same = next((w for w in lst if w[0] * wx + w[1] * wy > SAME_WALL), None)
            if same:
                sx, sy = same[0] + wx, same[1] + wy
                sl = math.hypot(sx, sy)
                same[0], same[1] = sx / sl, sy / sl
            else:
                lst.append([wx, wy])
    hole = np.zeros(n, bool)
    for hc in features["circles"]:
        if hc["kind"] != "hole":
            continue
        rr = np.hypot(V[:, 0] - hc["center"][0], V[:, 1] - hc["center"][1])
        hole |= (V[:, 2] >= hc["zMin"] - 1e-6) & (V[:, 2] <= hc["zMax"] + 1e-6) & (np.abs(rr - hc["radius"]) < 0.02 + 0.01 * hc["radius"])
    bed = features["zMin"]
    out = np.empty_like(V)
    for i in range(n):
        x, y, z = V[i, 0] / c["sx"], V[i, 1] / c["sy"], V[i, 2]
        lst = walls[i]
        if lst:
            move = -(c["hole"] if hole[i] else c["contour"])
            h = z - bed
            if c["foot"] > 0 and h < c["footFade"]:
                move -= c["foot"] * (1 - h / c["footFade"])
            a11 = sum(w[0] * w[0] for w in lst)
            a12 = sum(w[0] * w[1] for w in lst)
            a22 = sum(w[1] * w[1] for w in lst)
            b1 = sum(w[0] * move for w in lst)
            b2 = sum(w[1] * move for w in lst)
            det = a11 * a22 - a12 * a12
            if abs(det) > 1e-6:
                x += (a22 * b1 - a12 * b2) / det
                y += (a11 * b2 - a12 * b1) / det
            else:
                x += move * lst[0][0]
                y += move * lst[0][1]
        out[i] = (x, y, bed + (z - bed) / c["sz"])
    return out
