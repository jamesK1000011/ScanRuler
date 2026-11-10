# SPDX-License-Identifier: AGPL-3.0-only
# A first alignment proposed from the scan alone — ScanRuler's auto-align
# (src/core/autoAlign.ts), ported to numpy.
#
# A machined or printed part says where its axes are: most of its surface is
# flat faces square to one another, and walls — flat or round — that run
# along one of those directions. The surface's normals vote, by area, into a
# histogram over the directions of space (a normal and its opposite one
# direction); its peaks are the directions the faces are square to, and a
# direction every left-over normal is square to is the axis of a turned or
# extruded part. Frames are made from those candidates and judged by how
# much of the surface they explain; the winner is settled on the normals
# themselves. An open scan's flat rim votes as the face that would close it.
# Which way is up comes from the face the part would rest on and the side
# the scan is open on; the principal axes of the points are the fallback.

import math

import numpy as np

BINS = 64
CAP_DEG = 4.0
BAND_DEG = 4.0
MIN_MODE_SHARE = 0.015
SQUARE_TOL_DEG = 5.0
WALL_WORTH = 0.5
SCORE_TIE = 0.03
OPEN_WORTH = 0.5
OPEN_FACING_DEG = 35.0
MIN_OPENING_SHARE = 0.03
FLAT_LOOP = 0.02
EDGE_DEG = 30.0
MIN_FACE_SHARE = 0.002
MAX_FACES = 24


def rad(d):
    return d * math.pi / 180.0


def unit(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    return v / n if n > 0 and np.isfinite(n) else None


def eig(m):
    """Eigenvalues ascending and their vectors as rows."""
    w, v = np.linalg.eigh(np.asarray(m, dtype=float).reshape(3, 3))
    return w, v.T


# ---- the surface read into weighted samples --------------------------------------------

class Prepared:
    pass


def _tri(P, F):
    t = P[F]
    return np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])


def read_openings(P, F, total):
    """The scan's vector area, and its open loops (share of the surface each
    spans, and the plane each lies in when it lies in one), largest first."""
    cr = _tri(P, F)
    vector_area = cr.sum(0) / 2
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    key = np.sort(E, axis=1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    open_e = E[cnt[inv] == 1]
    openings = []
    if len(open_e):
        parent = {}

        def find(v):
            r = v
            while parent[r] != r:
                r = parent[r]
            while parent[v] != r:
                parent[v], v = r, parent[v]
            return r

        for a, b in open_e:
            parent.setdefault(int(a), int(a))
            parent.setdefault(int(b), int(b))
        for a, b in open_e:
            ra, rb = find(int(a)), find(int(b))
            if ra != rb:
                parent[ra] = rb
        roots = np.array([find(int(a)) for a in open_e[:, 0]])
        o = P[0]
        A, B = P[open_e[:, 0]] - o, P[open_e[:, 1]] - o
        for r in np.unique(roots):
            m = roots == r
            a, b = A[m], B[m]
            area = np.cross(a, b).sum(0) / 2
            l = np.linalg.norm(b - a, axis=1)
            share = float(np.linalg.norm(area)) / total
            L = l.sum()
            if share < MIN_OPENING_SHARE or not L > 0:
                continue
            mid = (a + b) / 2
            mean = (l[:, None] * mid).sum(0) / L
            c = (l[:, None, None] * mid[:, :, None] * mid[:, None, :]).sum(0) / L - np.outer(mean, mean)
            w, vec = eig(c)
            flat = math.sqrt(max(0.0, w[0])) <= FLAT_LOOP * math.sqrt(max(0.0, w[2]))
            openings.append({"share": share, "normal": vec[0] if flat else None})
    openings.sort(key=lambda x: -x["share"])
    return vector_area, openings


def prepare(g, smoothing=2):
    P, F, N = g.P, g.F, g.N
    n = len(P)
    cr = _tri(P, F)
    l = np.linalg.norm(cr, axis=1)
    good = l > 0
    third = l / 6
    area = np.zeros(n)
    for k in range(3):
        np.add.at(area, F[good, k], third[good])
    total = float(3 * third[good].sum())
    vector_area, openings = read_openings(P, F, total)

    cos_edge = math.cos(rad(EDGE_DEG))
    on_edge = np.zeros(n, bool)
    for k in range(3):
        o = F[:, k]
        bad = good & ((cr * N[o]).sum(1) < cos_edge * l)
        on_edge[o[bad]] = True

    # Smoothing passes over the neighbours, not across an edge of the part.
    rows = np.repeat(np.arange(n), np.diff(g.adj_off))
    cols = g.adj_list
    normals = N.copy()
    for _ in range(smoothing):
        along = (normals[rows] * normals[cols]).sum(1)
        keep = (~on_edge[cols]) & (along >= cos_edge)
        acc = normals * (2 * area)[:, None]
        np.add.at(acc, rows[keep], normals[cols[keep]] * area[cols[keep], None])
        ln = np.linalg.norm(acc, axis=1)
        ok = ln > 0
        out = normals.copy()
        out[ok] = acc[ok] / ln[ok, None]
        normals = out

    # Each triangle's area to its vertices, or to a sample of its own at its
    # middle for the corners on an edge.
    vw = np.zeros(n)
    kept = np.zeros(len(F))
    for k in range(3):
        o = F[:, k]
        e = on_edge[o] & good
        kept[e] += third[e]
        ne = (~on_edge[o]) & good
        np.add.at(vw, o[ne], third[ne])
    own = kept > 0
    fn = np.zeros_like(cr)
    fn[good] = cr[good] / l[good, None]
    pre = Prepared()
    pre.vcount = n
    pre.pos = np.concatenate([P, P[F[own]].mean(1)])
    pre.normals = np.concatenate([normals, fn[own]])
    pre.weight = np.concatenate([vw, kept[own]])
    pre.total = total
    pre.vector_area = vector_area
    pre.openings = openings
    return pre


# ---- the votes ----------------------------------------------------------------------------

def vote(pre):
    size = 3 * BINS * BINS
    Nn = pre.normals
    w = pre.weight
    ok = w > 0
    x, y, z = Nn[ok, 0].copy(), Nn[ok, 1].copy(), Nn[ok, 2].copy()
    w = w[ok]
    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    face = np.where((ax >= ay) & (ax >= az), 0, np.where(ay >= az, 1, 2))
    major = np.choose(face, [x, y, z])
    keep = major != 0
    x, y, z, w, face, major = x[keep], y[keep], z[keep], w[keep], face[keep], major[keep]
    flip = major < 0
    x[flip], y[flip], z[flip] = -x[flip], -y[flip], -z[flip]
    m = np.abs(major)
    s = np.where(face == 0, y, x)
    t = np.where(face == 2, y, z)
    warp = (4 / math.pi) * 0.5 * BINS
    i = np.minimum(BINS - 1, np.floor(np.arctan(s / m) * warp + BINS / 2)).astype(np.int64)
    j = np.minimum(BINS - 1, np.floor(np.arctan(t / m) * warp + BINS / 2)).astype(np.int64)
    b = (face * BINS + i) * BINS + j
    W = np.bincount(b, w, size)
    S = np.stack([np.bincount(b, w * x, size), np.bincount(b, w * y, size), np.bincount(b, w * z, size)], 1)
    live = W > 0
    ln = np.linalg.norm(S, axis=1)
    live &= ln > 0
    dirs = S[live] / ln[live, None]
    share = W[live] / pre.total
    rims = [o for o in pre.openings if o["normal"] is not None]
    scanned = len(dirs)
    if rims:
        dirs = np.concatenate([dirs, np.array([r["normal"] for r in rims])])
        share = np.concatenate([share, np.array([r["share"] for r in rims])])
    return {"dirs": dirs, "share": share, "scanned": scanned}


def climb(votes, start, cos_cap):
    d = np.asarray(start, dtype=float)
    share = 0.0
    D, S = votes["dirs"], votes["share"]
    for _ in range(12):
        c = D @ d
        m = np.abs(c) >= cos_cap
        sv = np.where(c[m] < 0, -S[m], S[m])
        share = float(S[m].sum())
        nxt = unit((sv[:, None] * D[m]).sum(0))
        if nxt is None:
            break
        moved = 1 - float(nxt @ d)
        d = nxt
        if moved < 1e-12:
            break
    return {"dir": d, "share": share}


def find_modes(votes):
    cos_cap, cos_same = math.cos(rad(CAP_DEG)), math.cos(rad(2 * CAP_DEG))
    order = np.argsort(-votes["share"], kind="stable")[:80]
    modes = []
    for b in order:
        if len(modes) >= 12:
            break
        seed = votes["dirs"][b]
        if any(abs(m["dir"] @ seed) > cos_same for m in modes):
            continue
        mode = climb(votes, seed, cos_cap)
        if mode["share"] < MIN_MODE_SHARE:
            continue
        if any(abs(m["dir"] @ mode["dir"]) > cos_same for m in modes):
            continue
        modes.append(mode)
    return sorted(modes, key=lambda m: -m["share"])


def find_pole(votes, modes):
    cos_cap = math.cos(rad(CAP_DEG))
    D, S = votes["dirs"], votes["share"]
    free = np.ones(len(D), bool)
    for m in modes:
        free &= np.abs(D @ m["dir"]) < cos_cap
    free_share = float(S[free].sum())
    if free_share < 0.1:
        return None
    pole = None
    Df, Sf = D[free], S[free]
    for it in range(4):
        sel = np.ones(len(Df), bool) if pole is None else np.abs(Df @ pole) <= math.sin(rad(15 if it < 2 else 8))
        s = (Sf[sel, None, None] * Df[sel, :, None] * Df[sel, None, :]).sum(0)
        pole = eig(s)[1][0]
    sin_band = math.sin(rad(BAND_DEG))
    band = float(Sf[np.abs(Df @ pole) <= sin_band].sum())
    return pole if band >= 0.12 and band >= 3 * sin_band * free_share else None


def score_frame(votes, f, count=None):
    cos_cap, sin_band = math.cos(rad(CAP_DEG)), math.sin(rad(BAND_DEG))
    D, S = votes["dirs"], votes["share"]
    if count is not None:
        D, S = D[:count], S[:count]
    c = np.abs(D @ np.asarray(f).T)
    caps, walls = [0.0] * 3, [0.0] * 3
    taken = np.zeros(len(D), bool)
    for k in range(3):
        m = (~taken) & (c[:, k] >= cos_cap)
        caps[k] = float(S[m].sum())
        taken |= m
    for k in range(3):
        m = (~taken) & (c[:, k] <= sin_band)
        walls[k] = float(S[m].sum())
        taken |= m
    return {"caps": caps, "walls": walls, "score": sum(caps) + WALL_WORTH * sum(walls)}


def evidence(votes, d):
    c = np.abs(votes["dirs"] @ d)
    S = votes["share"]
    return float(S[c >= math.cos(rad(CAP_DEG))].sum() + WALL_WORTH * S[c <= math.sin(rad(BAND_DEG))].sum())


def _thin(P, wanted=40000):
    return P[:: max(1, len(P) // wanted)]


def box_volume(P, f):
    h = _thin(P) @ np.asarray(f).T
    return float(np.prod(h.max(0) - h.min(0)))


def fallback_second(P, d1):
    seed = np.array([1.0, 0, 0]) if abs(d1[0]) < 0.9 else np.array([0, 1.0, 0])
    u = unit(seed - d1 * (seed @ d1))
    v = np.cross(d1, u)
    Q = _thin(P)
    a, b = Q @ u, Q @ v
    a, b = a - a.mean(), b - b.mean()
    suu, suv, svv = (a * a).sum(), (a * b).sum(), (b * b).sum()
    mean = (suu + svv) / 2
    diff = math.hypot((suu - svv) / 2, suv)
    if mean > 0 and (mean + diff) / max(mean - diff, 1e-30) > 1.2:
        ang = 0.5 * math.atan2(2 * suv, suu - svv)
        return unit(u * math.cos(ang) + v * math.sin(ang))
    return u


def principal_triad(P):
    Q = _thin(P)
    Q = Q - Q.mean(0)
    e = eig(Q.T @ Q)[1]
    return [e[2], e[1], np.cross(e[2], e[1])]


# ---- settling the frame on the normals ----------------------------------------------------

def best_rotation(s):
    """The rows of the rotation that best carries what was summed for each
    axis onto it: s[i, k] the i component of everything that should become
    axis k. Maximises trace(R s), by SVD (Horn's closed form in the source)."""
    U, _, Vt = np.linalg.svd(s)
    d = np.sign(np.linalg.det(Vt.T @ U.T)) or 1.0
    return Vt.T @ np.diag([1, 1, d]) @ U.T


def square_up(f, k, d):
    a, b = (k + 1) % 3, (k + 2) % 3
    da = unit(f[a] - d * (f[a] @ d))
    if da is None:
        da = unit(np.cross(f[b], d))
    out = [np.asarray(x, float) for x in f]
    out[k] = d
    out[a] = da
    out[b] = np.cross(d, da)
    return out


def settle_on_faces(pre, f, cap_deg):
    cos_cap = math.cos(rad(cap_deg))
    w = pre.weight
    ok = w > 0
    Nn, w = pre.normals[ok], w[ok]
    c = Nn @ np.asarray(f).T
    s = np.zeros((3, 3))
    held = np.zeros(3)
    taken = np.zeros(len(Nn), bool)
    for k in range(3):
        m = (~taken) & (np.abs(c[:, k]) >= cos_cap)
        taken |= m
        sw = np.where(c[m, k] < 0, -w[m], w[m])
        s[:, k] = (sw[:, None] * Nn[m]).sum(0)
        held[k] = w[m].sum()
    live = [k for k in range(3) if held[k] >= 0.005 * pre.total]
    if not live:
        return f
    if len(live) == 1:
        d = unit(s[:, live[0]])
        return square_up(f, live[0], d) if d is not None else f
    r = best_rotation(s)
    return [r[0], r[1], r[2]]


def settle_on_walls(pre, f, k, band_deg):
    sin_band, cos_cap = math.sin(rad(band_deg)), math.cos(rad(CAP_DEG))
    a, b = (k + 1) % 3, (k + 2) % 3
    w = pre.weight
    ok = w > 0
    Nn, w = pre.normals[ok], w[ok]
    m = (np.abs(Nn @ f[k]) <= sin_band) & (np.abs(Nn @ f[a]) < cos_cap) & (np.abs(Nn @ f[b]) < cos_cap)
    if not m.any():
        return f
    s = (w[m, None, None] * Nn[m, :, None] * Nn[m, None, :]).sum(0)
    if np.trace(s) <= 0:
        return f
    d = eig(s)[1][0]
    if d @ f[k] < 0:
        d = -d
    return square_up(f, k, d)


# ---- which way up, and where zero is -------------------------------------------------------

def axis_point(pre, size, z, x, y):
    sin_band, cos_cap = math.sin(rad(6)), math.cos(rad(CAP_DEG))
    w = pre.weight
    ok = w > 0
    Nn, Pp, w = pre.normals[ok], pre.pos[ok], w[ok]
    m = np.abs(Nn @ z) <= sin_band
    u, t = Nn[m] @ x, Nn[m] @ y
    m2 = (np.abs(u) < cos_cap) & (np.abs(t) < cos_cap)
    u, t = u[m2], t[m2]
    ll = np.hypot(u, t)
    u, t = u / ll, t / ll
    Q = Pp[m][m2]
    W = w[m][m2]
    cu, cv = Q @ x, Q @ y
    p00, p01, p11 = 1 - u * u, -u * t, 1 - t * t
    a00, a01, a11 = (W * p00).sum(), (W * p01).sum(), (W * p11).sum()
    b0, b1 = (W * (p00 * cu + p01 * cv)).sum(), (W * (p01 * cu + p11 * cv)).sum()
    tot = W.sum()
    det = a00 * a11 - a01 * a01
    if not tot > 0.05 * pre.total or abs(det) < 1e-9 * tot * tot:
        return None
    at = ((a11 * b0 - a01 * b1) / det, (a00 * b1 - a01 * b0) / det)
    dd = (at[0] - cu) * -t + (at[1] - cv) * u
    rms = math.sqrt(float((W * dd * dd).sum()) / tot)
    return at if rms <= 0.02 * size else None


def stand(g, pre, f, main_axis):
    F3 = np.asarray(f)
    used = np.diff(g.adj_off) > 0
    H = g.P[used] @ F3.T
    lo, hi = H.min(0), H.max(0)
    eps = 0.01 * g.bbox_diag
    cos_facing = math.cos(rad(15))
    w = pre.weight
    ok = w > 0
    h = pre.pos[ok] @ F3.T
    c = pre.normals[ok] @ F3.T
    w = w[ok]
    face, level = np.zeros(6), np.zeros(6)
    for k in range(3):
        m0 = (h[:, k] - lo[k] <= eps) & (-c[:, k] >= cos_facing)
        m1 = (hi[k] - h[:, k] <= eps) & (c[:, k] >= cos_facing)
        face[2 * k], level[2 * k] = w[m0].sum(), (w[m0] * h[m0, k]).sum()
        face[2 * k + 1], level[2 * k + 1] = w[m1].sum(), (w[m1] * h[m1, k]).sum()

    def down(side):
        k = side >> 1
        return (-1 if side & 1 else 1) * F3[k][2]

    def best(sides, worth):
        out = sides[0]
        for s_ in sides[1:]:
            if worth(s_) > worth(out):
                out = s_
        return out

    open_area = float(np.linalg.norm(pre.vector_area))
    cos_open = math.cos(rad(OPEN_FACING_DEG))
    opened = []
    for s_ in range(6):
        k = s_ >> 1
        if not open_area >= MIN_OPENING_SHARE * pre.total:
            opened.append(0.0)
            continue
        facing = ((-1 if s_ & 1 else 1) * float(pre.vector_area @ F3[k])) / open_area
        if facing < cos_open:
            opened.append(0.0)
            continue
        side_area = (hi[(k + 1) % 3] - lo[(k + 1) % 3]) * (hi[(k + 2) % 3] - lo[(k + 2) % 3])
        opened.append(min(1.0, open_area * facing / side_area) if side_area > 0 else 0.0)

    def worth(s_):
        return (face[s_] / pre.total) * (1 + 0.15 * down(s_)) + OPEN_WORTH * opened[s_]

    if main_axis is not None:
        side = best([main_axis * 2, main_axis * 2 + 1], lambda s_: worth(s_) + 1e-9 * down(s_))
        base = "open-side" if OPEN_WORTH * opened[side] > face[side] / pre.total else "axis-end"
    else:
        side = best(list(range(6)), worth)
        if OPEN_WORTH * opened[side] > face[side] / pre.total:
            base = "open-side"
        elif face[side] >= 0.02 * pre.total:
            base = "face"
        else:
            base = "extent"
            thin = int(np.argmin(hi - lo))
            side = best([thin * 2, thin * 2 + 1], down)

    kz = side >> 1
    z = F3[kz] * (-1 if side & 1 else 1)
    ka, kb = (kz + 1) % 3, (kz + 2) % 3
    kx = ka if hi[ka] - lo[ka] >= hi[kb] - lo[kb] else kb
    x = F3[kx].copy()
    lean = x[0] if abs(x[0]) > 1e-6 else x[1]
    if lean < 0:
        x = -x
    y = np.cross(z, x)
    ky = 3 - kz - kx
    height = level[side] / face[side] if face[side] >= 0.01 * pre.total else (hi[kz] if side & 1 else lo[kz])
    origin = F3[kz] * height + F3[kx] * (lo[kx] + hi[kx]) / 2 + F3[ky] * (lo[ky] + hi[ky]) / 2
    on_axis = False
    if main_axis == kz:
        at = axis_point(pre, g.bbox_diag, z, x, y)
        if at is not None:
            origin = F3[kz] * height + x * at[0] + y * at[1]
            on_axis = True
    return {"axes": [x, y, z], "origin": origin, "base": base, "onAxis": on_axis}


# ---- the faces, and how square it came out ------------------------------------------------

def flat_faces(g, pre, f):
    cos_cap = math.cos(rad(CAP_DEG))
    n = g.n
    Nn, Pp, W = pre.normals[:n], pre.pos[:n], pre.weight[:n]
    c = Nn @ np.asarray(f).T
    label = np.full(n, -1)
    for k in range(3):
        m = (label < 0) & (W > 0) & (np.abs(c[:, k]) >= cos_cap)
        label[m] = k * 2 + (c[m, k] < 0)
    # Patches: neighbours with the same label, joined (connected components).
    rows = np.repeat(np.arange(n), np.diff(g.adj_off))
    cols = g.adj_list
    same = (label[rows] >= 0) & (label[rows] == label[cols])
    comp = np.arange(n)
    r, cc = rows[same], cols[same]
    while True:
        lo_ = np.minimum(comp[r], comp[cc])
        new = comp.copy()
        np.minimum.at(new, r, lo_)
        np.minimum.at(new, cc, lo_)
        new = new[new]
        if np.array_equal(new, comp):
            break
        comp = new
    faces = []
    for root in np.unique(comp[label >= 0]):
        mem = np.nonzero((comp == root) & (label >= 0))[0]
        w = W[mem]
        area = float(w.sum())
        if len(mem) < 3 or area < MIN_FACE_SHARE * pre.total:
            continue
        ctr = (w[:, None] * Pp[mem]).sum(0) / area
        mean = (w[:, None] * Nn[mem]).sum(0)
        d = Pp[mem] - ctr
        nrm = eig((w[:, None, None] * d[:, :, None] * d[:, None, :]).sum(0))[1][0]
        if nrm @ mean < 0:
            nrm = -nrm
        faces.append({"normal": nrm, "center": ctr, "area": area})
    faces.sort(key=lambda x: -x["area"])
    return faces[:MAX_FACES]


def face_axis(axes, normal):
    cos_cap = math.cos(rad(CAP_DEG + 1))
    k = int(np.argmax([abs(normal @ a) for a in axes]))
    c = normal @ axes[k]
    if abs(c) < cos_cap:
        return None
    return k, (-normal if c < 0 else normal)


def deg_between(a, b):
    return math.degrees(math.acos(min(1.0, abs(float(a @ b)))))


def tilts(r, per_axis=3):
    names = "xyz"
    rows = [{"axis": names[k], "tiltDeg": 0.0, "area": 0.0, "faces": []} for k in range(3)]
    largest = None
    for f in r["faces"]:
        on = face_axis(r["axes"], f["normal"])
        if not on:
            continue
        k = on[0]
        t = deg_between(f["normal"], r["axes"][k])
        row = rows[k]
        row["tiltDeg"] += f["area"] * t
        row["area"] += f["area"]
        rel = f["center"] - r["origin"]
        if len(row["faces"]) < per_axis:
            row["faces"].append({"area": f["area"], "tiltDeg": t, "center": [float(rel @ a) for a in r["axes"]]})
        if largest is None or f["area"] > largest["area"]:
            largest = {"axis": names[k], "area": f["area"], "tiltDeg": t, "at": f["center"], "normal": f["normal"]}
    for row in rows:
        if row["area"] > 0:
            row["tiltDeg"] /= row["area"]
    return {"axes": [x for x in rows if x["area"] > 0], "largest": largest}


def level_largest(r):
    """The pose squared exactly to its largest face, the others settled
    about its normal."""
    big = next(((f, face_axis(r["axes"], f["normal"])) for f in r["faces"] if face_axis(r["axes"], f["normal"])), None)
    if not big:
        return r
    k, d = big[1]
    f = square_up(r["axes"], k, d)
    ia, ib = (k + 1) % 3, (k + 2) % 3
    sa = sb = 0.0
    for face in r["faces"]:
        on = face_axis(f, face["normal"])
        if not on or on[0] == k:
            continue
        m = on[1] - d * (on[1] @ d)
        if on[0] == ia:
            sa += face["area"] * (m @ f[ia])
            sb += face["area"] * (m @ f[ib])
        else:
            sa += face["area"] * (m @ f[ib])
            sb -= face["area"] * (m @ f[ia])
    out = dict(r)
    if not math.hypot(sa, sb) > 0:
        out["axes"] = f
        return out
    th = math.atan2(sb, sa)
    axes = list(f)
    axes[ia] = unit(f[ia] * math.cos(th) + f[ib] * math.sin(th))
    axes[ib] = np.cross(d, axes[ia])
    out["axes"] = axes
    return out


def rigid(r):
    """(R, t): the proposal's axes onto X, Y, Z, its origin onto zero."""
    R = np.array(r["axes"], dtype=float)
    return R, -R @ np.asarray(r["origin"], dtype=float)


# ---- the proposal -------------------------------------------------------------------------

def auto_align(g, smoothing=2, level="settled"):
    if g.n < 4 or len(g.F) < 4:
        raise ValueError("Too little surface to align.")
    pre = prepare(g, smoothing)
    if not pre.total > 0:
        raise ValueError("Too little surface to align.")
    votes = vote(pre)
    modes = find_modes(votes)
    pole = find_pole(votes, modes)
    cos_same = math.cos(rad(CAP_DEG))
    cands = [m["dir"] for m in modes]
    if pole is not None and not any(abs(c @ pole) >= cos_same for c in cands):
        cands.append(pole)

    method, frame, main_axis = "principal", principal_triad(g.P), None
    plane_share = wall_share = 0.0
    if cands:
        sin_tol = math.sin(rad(SQUARE_TOL_DEG))
        frames = []
        firsts = sorted(cands, key=lambda d: -evidence(votes, d))[:5] if len(cands) > 5 else cands
        for d1 in firsts:
            seconds = [c for c in cands if c is not d1 and abs(c @ d1) <= sin_tol]
            if not seconds:
                seconds = [fallback_second(g.P, d1)]
            for c in seconds:
                d2 = unit(c - d1 * (c @ d1))
                if d2 is None:
                    continue
                f = [d1, d2, np.cross(d1, d2)]
                frames.append((f, score_frame(votes, f)))
        if frames:
            top = max(s["score"] for _, s in frames)
            close = [x for x in frames if x[1]["score"] >= top - SCORE_TIE]
            won = close[0] if len(close) == 1 else min(close, key=lambda x: box_volume(g.P, x[0]))
            frame, sc = won
            method = "planes"
            k = int(np.argmax(sc["walls"]))
            others = sc["caps"][(k + 1) % 3] + sc["caps"][(k + 2) % 3]
            if sc["walls"][k] >= 0.2 and sc["walls"][k] >= 2 * others:
                method, main_axis = "axis", k
            if main_axis is not None:
                frame = settle_on_walls(pre, frame, main_axis, 8)
                frame = settle_on_walls(pre, frame, main_axis, BAND_DEG)
                frame = square_up(settle_on_faces(pre, frame, 3), main_axis, frame[main_axis])
            else:
                frame = settle_on_faces(pre, frame, 6)
                frame = settle_on_faces(pre, frame, 3)
            settled = score_frame(votes, frame, votes["scanned"])
            plane_share, wall_share = sum(settled["caps"]), sum(settled["walls"])

    st = stand(g, pre, frame, main_axis)
    faces = [] if method == "principal" else flat_faces(g, pre, st["axes"])
    out = {**st, "method": method, "planeShare": plane_share, "wallShare": wall_share, "faces": faces}
    return level_largest(out) if level == "largest" else out


def note(r, t, level):
    """What the pose was read from, as ScanRuler's proposal says it."""
    pct = lambda s: f"{round(s * 100)} %"  # noqa: E731
    stands = {"open-side": "the side the scan is open on", "face": "its largest flat face", "axis-end": "an end of its main axis", "extent": "its flattest side"}[r["base"]]
    if r["method"] == "principal":
        read = "The scan shows no face directions and no round walls, so this is the principal axes of its points — a guess."
    elif r["method"] == "axis":
        read = f"Read off the scan: the main axis from the round walls ({pct(r['wallShare'])} of the surface){', zero on that axis' if r['onAxis'] else ''}; {pct(r['planeShare'])} of the surface is faces square to the axes."
    else:
        more = f", {pct(r['wallShare'])} more is wall running along them" if r["wallShare"] >= 0.05 else ""
        read = f"Read off the scan: {pct(r['planeShare'])} of the surface is faces square to these axes{more}."
    sq = ""
    if t["largest"]:
        deg = lambda v: f"{v:.3f}°" if v < 0.01 else f"{v:.2f}°"  # noqa: E731
        L = t["largest"]
        if level == "largest":
            lg = f"Squared to its largest face (square to {L['axis'].upper()}, {round(L['area'])} mm²) — it stands {deg(L['tiltDeg'])} off"
        else:
            lg = f"Its largest face (square to {L['axis'].upper()}, {round(L['area'])} mm²) stands {deg(L['tiltDeg'])} off square"
        each = ", ".join(f"{a['axis'].upper()} {deg(a['tiltDeg'])}" for a in t["axes"])
        sq = f" {lg}; the faces square to each axis lean off it by {each}, by area."
    return f"{read}{sq} The part stands on {stands}, its long side along X."


def faces_in(scan_V, scan_F, largest, size, rays=3, hits_needed=6):
    """Rays from the largest face out along its normal, a 3 x 3 patch about
    its middle: most meeting the scan within twice the part's size is a
    face that looks into the part (a rib's, a pocket's wall)."""
    n = unit(largest["normal"])
    if n is None or not size > 0:
        return None
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    u = unit(np.cross(n, a))
    v = np.cross(n, u)
    cell = math.sqrt(largest["area"]) / (rays + 1)
    off = max(0.3, 0.002 * size)
    half = rays * cell / 2
    o0 = np.asarray(largest["at"]) + n * off - (u + v) * half
    T = scan_V[scan_F]
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    out = []
    for i in range(rays):
        for j in range(rays):
            o = o0 + u * (i + 0.5) * cell + v * (j + 0.5) * cell
            h = np.cross(n, e2)
            det = (e1 * h).sum(1)
            okd = np.abs(det) > 1e-12
            inv = np.where(okd, 1 / np.where(okd, det, 1), 0)
            s_ = o - T[:, 0]
            uu = inv * (s_ * h).sum(1)
            q = np.cross(s_, e1)
            vv = inv * (q @ n)
            t = inv * (e2 * q).sum(1)
            m = okd & (uu >= 0) & (vv >= 0) & (uu + vv <= 1) & (t > 0) & (t <= 2 * size)
            if m.any():
                out.append(float(t[m].min()))
    out.sort()
    return {"clear": out[len(out) // 2] + off, "hits": len(out)} if len(out) >= hits_needed else None
