# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/flat/edges.ts,
# src/core/flat/image.ts, src/core/flat/calibration.ts,
# src/core/flat/dimensions.ts, src/core/flat/refs.ts, src/core/flat/summary.ts,
# src/core/flat/report.ts, src/core/flat/drawing.ts, src/core/flat/dxf.ts and
# src/core/flat/svg.ts.
#
# The 2D sheet: a flatbed image read and calibrated, its edges found to
# subpixel (Canny, then chains linked, bridged and judged as chains),
# dimensions between 2D elements, and the sheet written as a report, a DXF or
# an SVG at true scale. The PNG decoder here (zlib and the five row filters)
# is this port's own: ScanRuler decodes in the browser. Pure numpy.

import math
import struct
import zlib

import numpy as np

from .geom2d import FitError, fit_circle_2d, simplify_run

# ---- reading an image ---------------------------------------------------------------------

def is_png(b):
    return len(b) > 8 and b[:8] == b"\x89PNG\r\n\x1a\n"


def is_jpeg(b):
    return len(b) > 2 and b[0] == 0xFF and b[1] == 0xD8


def png_pixels_per_mm(b):
    at = 8
    while at + 12 <= len(b):
        length = struct.unpack(">I", b[at:at + 4])[0]
        typ = b[at + 4:at + 8]
        if typ == b"pHYs" and length >= 9:
            x, y, unit = struct.unpack(">IIB", b[at + 8:at + 17])
            if unit != 1:
                return None
            return {"x": x / 1000, "y": y / 1000} if x > 0 and y > 0 else None
        if typ in (b"IDAT", b"IEND"):
            return None
        at += 12 + length
    return None


def jpeg_pixels_per_mm(b):
    at = 2
    while at + 4 <= len(b):
        if b[at] != 0xFF:
            return None
        marker = b[at + 1]
        if marker == 0xD8 or 0xD0 <= marker <= 0xD7:
            at += 2
            continue
        if marker in (0xDA, 0xD9):
            return None
        length = (b[at + 2] << 8) | b[at + 3]
        if length < 2:
            return None
        if marker == 0xE0 and length >= 16 and b[at + 4:at + 9] == b"JFIF\0":
            unit = b[at + 11]
            xd, yd = (b[at + 12] << 8) | b[at + 13], (b[at + 14] << 8) | b[at + 15]
            if unit == 1:
                return {"x": xd / 25.4, "y": yd / 25.4} if xd > 0 and yd > 0 else None
            if unit == 2:
                return {"x": xd / 10, "y": yd / 10} if xd > 0 and yd > 0 else None
            return None
        at += 2 + length
    return None


def image_pixels_per_mm(b):
    if is_png(b):
        return png_pixels_per_mm(b)
    if is_jpeg(b):
        return jpeg_pixels_per_mm(b)
    return None


MAX_IMAGE_PIXELS = 16384 * 16384


def decode_png_gray(b):
    """A PNG's pixels as 8-bit grey (rows top first): bit depths 8 and 16,
    grey, grey+alpha, RGB, RGBA and palette, not interlaced."""
    if not is_png(b):
        raise ValueError("not a PNG file")
    at = 8
    idat = []
    plte = None
    w = h = depth = ctype = interlace = None
    while at + 12 <= len(b):
        length = struct.unpack(">I", b[at:at + 4])[0]
        typ = b[at + 4:at + 8]
        data = b[at + 8:at + 8 + length]
        if typ == b"IHDR":
            w, h, depth, ctype, _c, _f, interlace = struct.unpack(">IIBBBBB", data[:13])
        elif typ == b"PLTE":
            plte = np.frombuffer(data, dtype=np.uint8).reshape(-1, 3)
        elif typ == b"IDAT":
            idat.append(data)
        elif typ == b"IEND":
            break
        at += 12 + length
    if w is None:
        raise ValueError("the PNG has no header")
    if w * h > MAX_IMAGE_PIXELS:
        raise ValueError(f"{w} x {h} pixels, more than can be decoded")
    if interlace:
        raise ValueError("interlaced PNGs are not read — save it without interlacing")
    if depth not in (8, 16) and not (ctype == 3 and depth == 8):
        raise ValueError(f"bit depth {depth} is not read — 8 or 16 bits per channel")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = channels * depth // 8
    stride = w * bpp
    raw = np.frombuffer(zlib.decompress(b"".join(idat)), dtype=np.uint8)
    out = np.zeros((h, stride), dtype=np.int64)
    prev = np.zeros(stride, dtype=np.int64)
    pos = 0
    for y in range(h):
        f = raw[pos]
        line = raw[pos + 1:pos + 1 + stride].astype(np.int64)
        pos += 1 + stride
        if f == 0:
            cur = line
        elif f == 2:
            cur = (line + prev) & 0xFF
        else:
            cur = np.zeros(stride, dtype=np.int64)
            for x in range(stride):
                left = cur[x - bpp] if x >= bpp else 0
                up = prev[x]
                if f == 1:
                    v = line[x] + left
                elif f == 3:
                    v = line[x] + ((left + up) >> 1)
                else:
                    ul = prev[x - bpp] if x >= bpp else 0
                    p = left + up - ul
                    pa, pb, pc = abs(p - left), abs(p - up), abs(p - ul)
                    v = line[x] + (left if pa <= pb and pa <= pc else up if pb <= pc else ul)
                cur[x] = v & 0xFF
        out[y] = cur
        prev = cur
    px = out.reshape(h, w, bpp)
    if depth == 16:
        px = px.reshape(h, w, channels, 2)[..., 0]
    else:
        px = px.reshape(h, w, channels)
    if ctype == 3:
        if plte is None:
            raise ValueError("a palette PNG with no palette")
        rgb = plte[px[..., 0]].astype(float)
    elif ctype in (2, 6):
        rgb = px[..., :3].astype(float)
    else:
        g = px[..., 0].astype(float)
        return np.clip(np.round(g), 0, 255).astype(np.uint8), w, h
    g = rgb @ np.array([0.299, 0.587, 0.114])
    return np.clip(np.round(g), 0, 255).astype(np.uint8), w, h


# ---- edges (edges.ts) ---------------------------------------------------------------------

EDGE_MIN_FEATURE_MM = 1
BRIDGE_RADIUS = 4
BRIDGE_ANGLE_DEG = 35
SIDE_OFFSET = 3
MIN_SIDE_STEP = 12
MIN_SIDE_CONSISTENCY = 0.8


def gaussian_blur(gray, sigma):
    radius = max(1, math.ceil(3 * sigma))
    k = np.exp(-(np.arange(-radius, radius + 1) ** 2) / (2 * sigma * sigma))
    k /= k.sum()
    g = gray.astype(float)
    h, w = g.shape
    pad = np.pad(g, ((0, 0), (radius, radius)), mode="edge")
    tmp = sum(k[i] * pad[:, i:i + w] for i in range(len(k)))
    pad = np.pad(tmp, ((radius, radius), (0, 0)), mode="edge")
    return sum(k[i] * pad[i:i + h, :] for i in range(len(k)))


def detect_edges(gray, sensitivity=0.5, sigma=1.4, min_length=24):
    """Subpixel edge chains of a grey image (rows bottom first, so pixel
    centres sit at (x + 0.5, y + 0.5) with y up): a list of (n, 2) arrays."""
    gray = np.asarray(gray)
    height, width = gray.shape
    sensitivity = min(1.0, max(0.0, sensitivity))
    if width < 8 or height < 8:
        return []
    b = gaussian_blur(gray, sigma)
    gx = np.zeros_like(b)
    gy = np.zeros_like(b)
    A, B_, C = b[:-2, :-2], b[:-2, 1:-1], b[:-2, 2:]
    D, F_ = b[1:-1, :-2], b[1:-1, 2:]
    G, H, I = b[2:, :-2], b[2:, 1:-1], b[2:, 2:]
    gx[1:-1, 1:-1] = C + 2 * F_ + I - (A + 2 * D + G)
    gy[1:-1, 1:-1] = G + 2 * H + I - (A + 2 * B_ + C)
    mag = np.hypot(gx, gy)
    flat = mag.reshape(-1)
    stride = max(1, flat.size // 400_000)
    sample = np.sort(flat[::stride][flat[::stride] > 0])
    if len(sample) == 0:
        return []

    def q(t):
        return sample[min(len(sample) - 1, int(t * len(sample)))]

    base, strong = q(0.6), q(0.995)
    high = base + (strong - base) * (0.5 - 0.42 * sensitivity)
    low = 0.4 * high
    # Non-maximum suppression across the edge, the gradient quantised to 4.
    m = mag[1:-1, 1:-1]
    ax, ay = np.abs(gx[1:-1, 1:-1]), np.abs(gy[1:-1, 1:-1])
    hor = ax >= 2.4142 * ay
    ver = ~hor & (ay >= 2.4142 * ax)
    diag = ~hor & ~ver & (gx[1:-1, 1:-1] * gy[1:-1, 1:-1] > 0)
    anti = ~hor & ~ver & ~diag
    m1 = np.select([hor, ver, diag, anti], [mag[1:-1, :-2], mag[:-2, 1:-1], mag[:-2, :-2], mag[:-2, 2:]])
    m2 = np.select([hor, ver, diag, anti], [mag[1:-1, 2:], mag[2:, 1:-1], mag[2:, 2:], mag[2:, :-2]])
    peak = (m >= low) & (m > m1) & (m >= m2)
    weak = np.zeros_like(mag, dtype=bool)
    weak[1:-1, 1:-1] = peak
    strongm = weak & (mag >= high)
    # Hysteresis: weak pixels survive connected (8-way) to a strong one.
    kept = strongm.copy()
    while True:
        grow = kept.copy()
        p = np.pad(kept, 1)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grow |= p[1 + dy:1 + dy + height, 1 + dx:1 + dx + width]
        grow &= weak
        if np.array_equal(grow, kept):
            break
        kept = grow
    chains = _trace_chains(kept, gx, gy, mag)
    judged = [c for c in _bridge_gaps(chains, BRIDGE_RADIUS, BRIDGE_ANGLE_DEG) if _path_length(c) >= min_length and _consistent_sides(c, b)]
    return [np.array(c, dtype=float).reshape(-1, 2) for c in judged]


def _path_length(c):
    a = np.asarray(c, dtype=float).reshape(-1, 2)
    return float(np.hypot(*np.diff(a, axis=0).T).sum()) if len(a) > 1 else 0.0


def _trace_chains(kept, gx, gy, mag):
    height, width = kept.shape
    ys, xs = np.nonzero(kept)
    on = set(zip(xs.tolist(), ys.tolist()))
    visited = set()
    order = sorted(on, key=lambda p: (p[1], p[0]))

    def nbrs(p):
        x, y = p
        for k in range(9):
            if k == 4:
                continue
            ox, oy = k % 3 - 1, k // 3 - 1
            q = (x + ox, y + oy)
            if 0 <= q[0] < width and q in on:
                yield k, q

    def degree(p):
        return sum(1 for _ in nbrs(p))

    chains = []

    def walk(start):
        chain = [start]
        visited.add(start)
        cur = start
        dx = dy = 0.0
        while True:
            best, best_score = None, -math.inf
            for k, q in nbrs(cur):
                if q in visited:
                    continue
                ox, oy = k % 3 - 1, k // 3 - 1
                L = math.hypot(ox, oy)
                score = -L if dx == 0 and dy == 0 else (dx * ox + dy * oy) / L
                if score > best_score:
                    best, best_score = q, score
            if best is None or (best_score < -0.5 and (dx != 0 or dy != 0)):
                break
            ox, oy = best[0] - cur[0], best[1] - cur[1]
            L = math.hypot(ox, oy)
            dx, dy = ox / L, oy / L
            chain.append(best)
            visited.add(best)
            cur = best
        chains.append(chain)

    for p in order:
        if p not in visited and degree(p) == 1:
            walk(p)
    for p in order:
        if p not in visited:
            walk(p)

    def sample(x, y):
        x0, y0 = math.floor(x), math.floor(y)
        if x0 < 0 or y0 < 0 or x0 >= width - 1 or y0 >= height - 1:
            return 0.0
        fx, fy = x - x0, y - y0
        return mag[y0, x0] * (1 - fx) * (1 - fy) + mag[y0, x0 + 1] * fx * (1 - fy) + mag[y0 + 1, x0] * (1 - fx) * fy + mag[y0 + 1, x0 + 1] * fx * fy

    out = []
    for chain in chains:
        c = []
        for x, y in chain:
            m0 = mag[y, x]
            px, py = x + 0.5, y + 0.5
            if m0 > 0:
                nx, ny = gx[y, x] / m0, gy[y, x] / m0
                m1, m2 = sample(x - nx, y - ny), sample(x + nx, y + ny)
                den = m1 + m2 - 2 * m0
                if den < 0:
                    t = max(-0.5, min(0.5, (m1 - m2) / (2 * den)))
                    px += t * nx
                    py += t * ny
            c += [px, py]
        out.append(c)
    return out


def _outward(c, at_end):
    n = len(c) // 2
    k = min(6, n - 1)
    a = n - 1 - k if at_end else k
    b = n - 1 if at_end else 0
    dx, dy = c[b * 2] - c[a * 2], c[b * 2 + 1] - c[a * 2 + 1]
    L = math.hypot(dx, dy) or 1
    return dx / L, dy / L


def _reversed(c):
    n = len(c) // 2
    out = []
    for i in range(n - 1, -1, -1):
        out += [c[i * 2], c[i * 2 + 1]]
    return out


def _bridge_gaps(chains, radius, max_angle):
    cos_min = math.cos(math.radians(max_angle))
    cur = chains
    for _ in range(4):
        ends = []
        for ci, c in enumerate(cur):
            if len(c) < 6:
                continue
            sx, sy = _outward(c, False)
            ex, ey = _outward(c, True)
            ends.append((ci, False, c[0], c[1], sx, sy))
            ends.append((ci, True, c[-2], c[-1], ex, ey))
        grid = {}
        for i, e in enumerate(ends):
            grid.setdefault((math.floor(e[2] / radius), math.floor(e[3] / radius)), []).append(i)
        best = [-1] * len(ends)
        best_d = [math.inf] * len(ends)
        for i, e in enumerate(ends):
            cx, cy = math.floor(e[2] / radius), math.floor(e[3] / radius)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for j in grid.get((cx + dx, cy + dy), []):
                        f = ends[j]
                        if f[0] == e[0]:
                            continue
                        vx, vy = f[2] - e[2], f[3] - e[3]
                        d = math.hypot(vx, vy)
                        if d > radius or d >= best_d[i]:
                            continue
                        dn = d or 1
                        if (e[4] * vx + e[5] * vy) / dn < cos_min or (f[4] * -vx + f[5] * -vy) / dn < cos_min:
                            continue
                        best[i], best_d[i] = j, d
        taken, out, joined = set(), [], 0
        for i, e in enumerate(ends):
            j = best[i]
            if j < 0 or best[j] != i or i > j:
                continue
            f = ends[j]
            if e[0] in taken or f[0] in taken:
                continue
            a, b = cur[e[0]], cur[f[0]]
            head = a if e[1] else _reversed(a)
            tail = _reversed(b) if f[1] else b
            out.append(head + tail)
            taken |= {e[0], f[0]}
            joined += 1
        out += [c for ci, c in enumerate(cur) if ci not in taken]
        cur = out
        if not joined:
            break
    return cur


def _consistent_sides(c, img):
    height, width = img.shape
    n = len(c) // 2
    stride = max(1, n // 64)
    s = count = positive = 0
    for i in range(0, n, stride):
        a, b = max(0, i - 2), min(n - 1, i + 2)
        tx, ty = c[b * 2] - c[a * 2], c[b * 2 + 1] - c[a * 2 + 1]
        L = math.hypot(tx, ty)
        if L < 1e-6:
            continue
        tx, ty = tx / L, ty / L
        px, py = c[i * 2] - 0.5, c[i * 2 + 1] - 0.5
        x1, y1 = round(px - ty * SIDE_OFFSET), round(py + tx * SIDE_OFFSET)
        x2, y2 = round(px + ty * SIDE_OFFSET), round(py - tx * SIDE_OFFSET)
        if min(x1, x2, y1, y2) < 0 or max(x1, x2) >= width or max(y1, y2) >= height:
            continue
        d = img[y1, x1] - img[y2, x2]
        s += d
        count += 1
        if d > 0:
            positive += 1
    if not count:
        return False
    return abs(s / count) >= MIN_SIDE_STEP and max(positive, count - positive) / count >= MIN_SIDE_CONSISTENCY


# ---- calibration (calibration.ts) --------------------------------------------------------

AXIS_DOMINANCE = 10


def distance_calibration(a, b, true_mm, current=None, split_axes=False):
    if not true_mm > 0:
        raise FitError("The true distance must be a positive length.")
    dx, dy = abs(b[0] - a[0]), abs(b[1] - a[1])
    L = math.hypot(dx, dy)
    if not L > 1:
        raise FitError("The two points coincide — pick the two ends of the reference.")
    f = L / true_mm
    if not split_axes:
        return {"x": f, "y": f}
    if dx >= AXIS_DOMINANCE * dy:
        return {"x": f, "y": (current or {}).get("y", f)}
    if dy >= AXIS_DOMINANCE * dx:
        return {"x": (current or {}).get("x", f), "y": f}
    raise FitError("To calibrate one axis, the reference must run along it — this one is diagonal. Align the reference with an image edge, or calibrate both axes together.")


def diameter_calibration(picks, true_mm):
    if not true_mm > 0:
        raise FitError("The true diameter must be a positive length.")
    if len(picks) < 3:
        raise FitError("A circle needs at least three points around its edge.")
    fit = fit_circle_2d(np.asarray(picks, dtype=float))
    if fit is None:
        raise FitError("Couldn't fit a circle through these points.")
    f = 2 * fit[2] / true_mm
    if not f > 0:
        raise FitError("Couldn't fit a circle through these points.")
    return {"x": f, "y": f}


# ---- what an element stands for, and dimensions (refs.ts, dimensions.ts) -----------------

def role_of(kind):
    return None if kind == "spline" else ("line" if kind == "line" else "point")


def ref_point(fit):
    if fit["kind"] == "point":
        return np.array(fit["at"], dtype=float)
    if fit["kind"] in ("circle", "arc"):
        return np.array(fit["center"], dtype=float)
    return None


def ref_line(fit):
    if fit["kind"] != "line":
        return None
    return np.array(fit["center"], dtype=float), np.array(fit["dir"], dtype=float), fit["length"] / 2


DIMENSION_TYPES = [
    {"id": "flat-dist-point-point", "group": "distance", "label": "Point – Point", "slots": ["point", "point"]},
    {"id": "flat-dist-point-line", "group": "distance", "label": "Point – Line", "slots": ["point", "line"]},
    {"id": "flat-dist-line-line", "group": "distance", "label": "Line – Line", "slots": ["line", "line"]},
    {"id": "flat-angle-line-line", "group": "angle", "label": "Line – Line", "slots": ["line", "line"]},
]
PARALLEL_MAX_DEG = 3
PARALLEL_WARN_DEG = 0.5
EXTENT_MARGIN = 1.3


def acute_angle(a, b):
    c = abs(float(a @ b)) / (np.linalg.norm(a) * np.linalg.norm(b))
    return math.degrees(math.acos(min(1.0, c)))


def length_text(v, unit, dec=3, bare=False):
    s = f"{v:.{dec}f}"
    return s if bare else f"{s} {unit}"


def evaluate_dimension(typ, fits, unit="mm"):
    def deg(v):
        return f"{v:.2f}°"

    if typ == "flat-dist-point-point":
        a, b = ref_point(fits[0]), ref_point(fits[1])
        if a is None or b is None:
            return {"label": "Distance", "invalid": "A reference is not a point."}
        d = float(np.linalg.norm(b - a))
        dd = b - a

        def f(v):
            s = length_text(v, unit, 3, True)
            return f"+{s.replace('-', '')}" if float(s) == 0 else (f"+{s}" if v >= 0 else s)

        return {"label": "Center distance", "value": length_text(d, unit), "raw": d, "segment": [a.tolist(), b.tolist()], "detail": f"ΔX {f(dd[0])} · ΔY {f(dd[1])} {unit}"}
    if typ == "flat-dist-point-line":
        p, line = ref_point(fits[0]), ref_line(fits[1])
        if p is None or line is None:
            return {"label": "Distance to line", "invalid": "A reference is missing."}
        o, d, half = line
        t = float((p - o) @ d)
        foot = o + d * t
        dist = float(np.linalg.norm(p - foot))
        out = {"label": "Distance to line", "value": length_text(dist, unit), "raw": dist, "segment": [p.tolist(), foot.tolist()]}
        if abs(t) > half * EXTENT_MARGIN:
            out["warning"] = "The perpendicular foot lies beyond the measured section of the line."
        return out
    if typ == "flat-dist-line-line":
        a, b = ref_line(fits[0]), ref_line(fits[1])
        if a is None or b is None:
            return {"label": "Line distance", "invalid": "A reference is missing."}
        fold = acute_angle(a[1], b[1])
        if fold > PARALLEL_MAX_DEG:
            return {"label": "Line distance", "invalid": f"The lines are {deg(fold)} apart — a distance between non-parallel lines has no meaning. Use an angle dimension instead."}
        t = float((a[0] - b[0]) @ b[1])
        foot = b[0] + b[1] * t
        warnings = []
        if fold > PARALLEL_WARN_DEG:
            warnings.append(f"The lines are {deg(fold)} off parallel — the value depends on where along them it is taken.")
        if abs(t) > b[2] * EXTENT_MARGIN:
            warnings.append("Measured beyond the fitted section of the second line.")
        d = float(np.linalg.norm(a[0] - foot))
        out = {"label": "Line distance", "value": length_text(d, unit), "raw": d, "segment": [a[0].tolist(), foot.tolist()], "detail": f"Lines {deg(fold)} apart"}
        if warnings:
            out["warning"] = " ".join(warnings)
        return out
    if typ == "flat-angle-line-line":
        a, b = ref_line(fits[0]), ref_line(fits[1])
        if a is None or b is None:
            return {"label": "Line angle", "invalid": "A reference is missing."}
        v = acute_angle(a[1], b[1])
        out = {"label": "Line angle", "value": deg(v), "raw": v}
        if v < 90:
            out["detail"] = f"Supplement {deg(180 - v)}"
        return out
    return {"label": "Dimension", "invalid": f"Unknown flat dimension type \"{typ}\"."}


# ---- how a fit reads (summary.ts) and the report (report.ts) -----------------------------

def aligned_fit(fit, al):
    """A fit read in an aligned frame: the sheet place p becomes
    R(−angle)·(p − origin), directions turn, arcs start turned."""
    if not al:
        return fit
    c, sn = math.cos(-al["angle"]), math.sin(-al["angle"])
    ox, oy = al["origin"]

    def place(p):
        x, y = p[0] - ox, p[1] - oy
        return [c * x - sn * y, sn * x + c * y]

    out = dict(fit)
    for key in ("center", "at"):
        if key in out:
            out[key] = place(out[key])
    if "dir" in out:
        out["dir"] = [c * out["dir"][0] - sn * out["dir"][1], sn * out["dir"][0] + c * out["dir"][1]]
    if "start" in out:
        out["start"] = out["start"] - al["angle"]
    return out


def format_primary(fit, unit):
    k = fit["kind"]
    if k == "point":
        return f"X {length_text(fit['at'][0], unit, 3, True)} · Y {length_text(fit['at'][1], unit)}"
    if k == "line":
        return f"L {length_text(fit['length'], unit)} · {math.degrees(math.atan2(fit['dir'][1], fit['dir'][0])):.2f}°"
    if k == "circle":
        return f"Ø {length_text(2 * fit['radius'], unit)}"
    if k == "arc":
        return f"R {length_text(fit['radius'], unit)} · {math.degrees(fit['sweep']):.1f}°"
    return ""


def format_detail(fit, unit):
    if fit.get("usedPoints", 0) == 0:
        return ""
    parts = [f"σ {length_text(fit['sigma'], unit, 4, True)}"]
    if fit.get("formError") is not None:
        parts.append(f"form {length_text(fit['formError'], unit, 4)}")
    parts.append(f"{fit['usedPoints']} pts")
    return " · ".join(parts)


def scale_line(r):
    if r.get("section"):
        return "Scale: millimetres of the 3D scan (a section, not an image)"
    p = r.get("pxPerMm")
    if r["calSource"] == "measured" and p:
        return f"Scale: CALIBRATED, {p['x']:.4f} px/mm" if p["x"] == p["y"] else f"Scale: CALIBRATED, X {p['x']:.4f} / Y {p['y']:.4f} px/mm"
    if r["calSource"] == "metadata" and p:
        return f"Scale: UNCALIBRATED — nominal {p['x'] * 25.4:.0f} dpi from file metadata"
    return "Scale: UNCALIBRATED — no scale, all values in PIXELS"


def title_line(r):
    s = r.get("section")
    if s:
        return f"ScanRuler 2D measurement — {s['name']}: {s['scanName']} cut {s['cut']}"
    return f"ScanRuler 2D measurement — {r['imageName']} ({r['imageWidth']} × {r['imageHeight']} px)"


def build_report(r):
    lines = [title_line(r), scale_line(r)]
    al = r.get("alignment")
    if al:
        lines.append(f"Coordinates: aligned — origin at {length_text(al['origin'][0], r['unit'], 3, True)}, {length_text(al['origin'][1], r['unit'])} of the sheet, X axis at {math.degrees(al['angle']):.3f}°, y up")
    else:
        lines.append("Coordinates: section frame, origin at the cutting plane’s centre, y up" if r.get("section") else "Coordinates: image frame, origin bottom-left, y up")
    if r["elements"]:
        lines += ["", "Elements"]
        for el in r["elements"]:
            if not el.get("fit"):
                lines.append(f"  {el['name']}: no fit — {el.get('error') or 'unavailable'}")
                continue
            detail = format_detail(el["fit"], r["unit"])
            lines.append(f"  {el['name']}: {format_primary(el['fit'], r['unit'])}{f' ({detail})' if detail else ''}")
    if r["dimensions"]:
        lines += ["", "Dimensions"]
        for d in r["dimensions"]:
            v = d["value"]
            if v.get("invalid"):
                lines.append(f"  {d['title']} — {v['label']}: invalid ({v['invalid']})")
                continue
            extras = " — ".join(x for x in [v.get("detail"), v.get("warning") and f"⚠ {v['warning']}"] if x)
            lines.append(f"  {d['title']} — {v['label']}: {v['value']}{f' ({extras})' if extras else ''}")
    if r.get("notes"):
        lines += ["", "Notes"] + [f"  {n['text']}" for n in r["notes"]]
    return "\n".join(lines)


# ---- drawings (drawing.ts, dxf.ts, svg.ts) ------------------------------------------------

DRAWING_EDGE_COLOR = "#11b5a5"
DXF_EDGE_TOLERANCE = {"mm": 0.01, "px": 0.25}


def num(v, decimals):
    s = f"{v:.{decimals}f}"
    t = s.rstrip("0").rstrip(".") if "." in s else s
    return "0" if t == "-0" else t


def label_spot(fit, diag):
    lift = diag * 0.01
    k = fit["kind"]
    if k == "point":
        return [fit["at"][0], fit["at"][1] + lift]
    if k == "line":
        return [fit["center"][0], fit["center"][1] + lift]
    if k == "circle":
        d = fit["radius"] * 0.7071
        return [fit["center"][0] + d, fit["center"][1] + d]
    mid = fit["start"] + fit["sweep"] / 2
    return [fit["center"][0] + fit["radius"] * math.cos(mid), fit["center"][1] + fit["radius"] * math.sin(mid)]


def _g(code, value):
    return f"{code:>3}\n{value}"


TEXT_SPELLINGS = {"Ø": "%%c", "°": "%%d", "±": "%%p"}


def dxf_text(s):
    out = ""
    import re

    # A line break or other control character becomes a space: a value is one
    # line of the file, and a break would be read as the next group code
    # (ScanRuler 0.11.0).
    for ch in re.sub(r"\s*·\s*", ", ", re.sub(r"\s*[\x00-\x1f\x7f]+\s*", " ", s)):
        c = ord(ch)
        out += ch if c < 127 else TEXT_SPELLINGS.get(ch, "\\U+%04X" % c)
    return out


def _true_color(css):
    css = css.strip()
    if len(css) == 7 and css[0] == "#":
        try:
            return int(css[1:], 16)
        except ValueError:
            return None
    return None


MODEL_SPACE = "1F"


def _tables(layers):
    def table(name, handle, count, records, extra=()):
        return [_g(0, "TABLE"), _g(2, name), _g(5, handle), _g(330, "0"), _g(100, "AcDbSymbolTable"), _g(70, count), *extra, *records, _g(0, "ENDTAB")]

    def record(typ, handle, owner, sub, body):
        return [_g(0, typ), _g(5, handle), _g(330, owner), _g(100, "AcDbSymbolTableRecord"), _g(100, sub), *body]

    def ltype(handle, name, desc):
        return record("LTYPE", handle, "5", "AcDbLinetypeTableRecord", [_g(2, name), _g(70, 0), _g(3, desc), _g(72, 65), _g(73, 0), _g(40, 0)])

    return [
        _g(0, "SECTION"), _g(2, "TABLES"),
        *table("VPORT", "8", 0, []),
        *table("LTYPE", "5", 3, [*ltype("14", "BYBLOCK", ""), *ltype("15", "BYLAYER", ""), *ltype("16", "CONTINUOUS", "Solid line")]),
        *table("LAYER", "2", 4, layers),
        *table("STYLE", "3", 1, record("STYLE", "11", "3", "AcDbTextStyleTableRecord", [_g(2, "STANDARD"), _g(70, 0), _g(40, 0), _g(41, 1), _g(50, 0), _g(71, 0), _g(42, 2.5), _g(3, "txt"), _g(4, "")])),
        *table("VIEW", "6", 0, []),
        *table("UCS", "7", 0, []),
        *table("APPID", "9", 1, record("APPID", "12", "9", "AcDbRegAppTableRecord", [_g(2, "ACAD"), _g(70, 0)])),
        *table("DIMSTYLE", "A", 0, [], [_g(100, "AcDbDimStyleTable")]),
        *table("BLOCK_RECORD", "1", 2, [*record("BLOCK_RECORD", MODEL_SPACE, "1", "AcDbBlockTableRecord", [_g(2, "*MODEL_SPACE")]), *record("BLOCK_RECORD", "1B", "1", "AcDbBlockTableRecord", [_g(2, "*PAPER_SPACE")])]),
        _g(0, "ENDSEC"),
    ]


BLOCKS = [
    _g(0, "SECTION"), _g(2, "BLOCKS"),
    _g(0, "BLOCK"), _g(5, "20"), _g(330, MODEL_SPACE), _g(100, "AcDbEntity"), _g(8, "0"),
    _g(100, "AcDbBlockBegin"), _g(2, "*MODEL_SPACE"), _g(70, 0),
    _g(10, 0), _g(20, 0), _g(30, 0), _g(3, "*MODEL_SPACE"), _g(1, ""),
    _g(0, "ENDBLK"), _g(5, "21"), _g(330, MODEL_SPACE), _g(100, "AcDbEntity"), _g(8, "0"),
    _g(100, "AcDbBlockEnd"),
    _g(0, "BLOCK"), _g(5, "1C"), _g(330, "1B"), _g(100, "AcDbEntity"), _g(67, 1), _g(8, "0"),
    _g(100, "AcDbBlockBegin"), _g(2, "*PAPER_SPACE"), _g(70, 0),
    _g(10, 0), _g(20, 0), _g(30, 0), _g(3, "*PAPER_SPACE"), _g(1, ""),
    _g(0, "ENDBLK"), _g(5, "1D"), _g(330, "1B"), _g(100, "AcDbEntity"), _g(67, 1), _g(8, "0"),
    _g(100, "AcDbBlockEnd"),
    _g(0, "ENDSEC"),
]

OBJECTS = [
    _g(0, "SECTION"), _g(2, "OBJECTS"),
    _g(0, "DICTIONARY"), _g(5, "C"), _g(330, "0"), _g(100, "AcDbDictionary"), _g(281, 1),
    _g(3, "ACAD_GROUP"), _g(350, "D"),
    _g(0, "DICTIONARY"), _g(5, "D"), _g(330, "C"), _g(100, "AcDbDictionary"), _g(281, 1),
    _g(0, "ENDSEC"),
]


def build_dxf(r):
    """The sheet as an AutoCAD 2000 ASCII DXF, y up, in the sheet's units:
    edges as thinned LWPOLYLINEs, fits as LINE / CIRCLE / ARC / POINT,
    labels as TEXT. r: bounds, chains (list of (n, 2) in chain units),
    chainUnit, elements [{fit, color, name, value}], unit, title, scaleNote,
    edgeTolerance, origin."""
    o = r.get("origin") or [0, 0]

    def at(p):
        return [p[0] - o[0], p[1] - o[1]]

    unit = r["unit"]
    dec = 4 if unit == "mm" else 3

    def n(v):
        return num(v, dec)

    def deg(rad):
        return num((math.degrees(rad) % 360 + 360) % 360, 6)

    mn, mx = r["bounds"]["min"], r["bounds"]["max"]
    corners = [at(mn), at(mx)]
    x0, x1 = min(c[0] for c in corners), max(c[0] for c in corners)
    y0, y1 = min(c[1] for c in corners), max(c[1] for c in corners)
    diag = math.hypot(x1 - x0, y1 - y0) or 1
    text_h, point_size = diag * 0.011, diag * 0.012
    seed = [0x100]

    def handle():
        h = "%X" % seed[0]
        seed[0] += 1
        return h

    def xyz(code, p):
        return [_g(code, n(p[0])), _g(code + 10, n(p[1])), _g(code + 20, 0)]

    ents = []

    def entity(typ, layer, rgb, body):
        ents.extend([_g(0, typ), _g(5, handle()), _g(330, MODEL_SPACE), _g(100, "AcDbEntity"), _g(8, layer)])
        if rgb is not None:
            ents.append(_g(420, rgb))
        ents.extend(body)

    ux, uy = r["chainUnit"]["x"], r["chainUnit"]["y"]
    tol = r["edgeTolerance"] / max(ux, uy)
    for c in r.get("chains") or []:
        if len(c) < 2:
            continue
        closed = len(c) > 3 and np.array_equal(c[0], c[-1])
        kept = simplify_run(c, 0, len(c) - 1 if closed else len(c), tol)
        body = [_g(100, "AcDbPolyline"), _g(90, len(kept)), _g(70, 1 if closed else 0)]
        for i in kept:
            x, y = at([c[i][0] * ux, c[i][1] * uy])
            body += [_g(10, n(x)), _g(20, n(y))]
        entity("LWPOLYLINE", "edges", None, body)

    def shapes(fit):
        k = fit["kind"]
        if k == "point":
            return [("POINT", [_g(100, "AcDbPoint"), *xyz(10, at(fit["at"]))])]
        if k == "line":
            (cx, cy), (dx, dy), half = fit["center"], fit["dir"], fit["length"] / 2
            return [("LINE", [_g(100, "AcDbLine"), *xyz(10, at([cx - dx * half, cy - dy * half])), *xyz(11, at([cx + dx * half, cy + dy * half]))])]
        if k == "circle" or (k == "arc" and fit["sweep"] >= 2 * math.pi - 1e-6):
            return [("CIRCLE", [_g(100, "AcDbCircle"), *xyz(10, at(fit["center"])), _g(40, n(fit["radius"]))])]
        if k == "arc":
            return [("ARC", [_g(100, "AcDbCircle"), *xyz(10, at(fit["center"])), _g(40, n(fit["radius"])), _g(100, "AcDbArc"), _g(50, deg(fit["start"])), _g(51, deg(fit["start"] + fit["sweep"]))])]
        return []

    def text(p, s, rgb):
        if s == "":
            return
        entity("TEXT", "labels", rgb, [_g(100, "AcDbText"), *xyz(10, p), _g(40, n(text_h)), _g(1, dxf_text(s)), _g(100, "AcDbText")])

    for el in r["elements"]:
        rgb = _true_color(el["color"])
        for typ, body in shapes(el["fit"]):
            entity(typ, "elements", rgb, body)
        lx, ly = at(label_spot(el["fit"], diag))
        text([lx, ly + 1.2 * text_h], el["name"], rgb)
        text([lx, ly], el["value"], rgb)
    for note in r.get("notes") or []:
        text(at(note["at"]), note["text"], _true_color("#808080"))

    def layer(name, aci, rgb):
        return [_g(0, "LAYER"), _g(5, handle()), _g(330, "2"), _g(100, "AcDbSymbolTableRecord"), _g(100, "AcDbLayerTableRecord"), _g(2, name), _g(70, 0), _g(62, aci), *([] if rgb is None else [_g(420, rgb)]), _g(6, "CONTINUOUS")]

    layers = [*layer("0", 7, None), *layer("edges", 4, _true_color(DRAWING_EDGE_COLOR)), *layer("elements", 7, None), *layer("labels", 7, None)]

    def comment(s):
        return _g(999, dxf_text(s.replace("—", "-").replace("×", "x")))

    word = "millimetre" if unit == "mm" else "image pixel"
    header = [
        comment(r["title"]), comment(r["scaleNote"]),
        comment(f"One unit is one {word}; y up; the origin is {'the alignment' + chr(39) + 's origin' if r.get('origin') else 'the sheet' + chr(39) + 's own origin'}"),
        comment(f"Layers: edges (the detected edge chains{', thinned to ' + num(r['edgeTolerance'], 4) + ' ' + unit if r['edgeTolerance'] > 0 else ''}), elements (the fitted geometry), labels (names, readings and notes)"),
        _g(0, "SECTION"), _g(2, "HEADER"),
        _g(9, "$ACADVER"), _g(1, "AC1015"),
        _g(9, "$DWGCODEPAGE"), _g(3, "ANSI_1252"),
        _g(9, "$INSBASE"), _g(10, 0), _g(20, 0), _g(30, 0),
        _g(9, "$EXTMIN"), _g(10, n(x0)), _g(20, n(y0)), _g(30, 0),
        _g(9, "$EXTMAX"), _g(10, n(x1)), _g(20, n(y1)), _g(30, 0),
        _g(9, "$INSUNITS"), _g(70, 4 if unit == "mm" else 0),
        _g(9, "$MEASUREMENT"), _g(70, 1),
        _g(9, "$LUNITS"), _g(70, 2),
        _g(9, "$LUPREC"), _g(70, 4),
        _g(9, "$PDMODE"), _g(70, 3),
        _g(9, "$PDSIZE"), _g(40, n(point_size)),
        _g(9, "$HANDSEED"), _g(5, "%X" % seed[0]),
        _g(0, "ENDSEC"),
    ]
    return "\n".join([*header, *_tables(layers), *BLOCKS, _g(0, "SECTION"), _g(2, "ENTITIES"), *ents, _g(0, "ENDSEC"), *OBJECTS, _g(0, "EOF")]) + "\n"


def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def build_svg(r):
    """The sheet as SVG at true scale: one user unit per millimetre (pixel
    unscaled), y down, the top-left of the sheet the origin."""
    mn, mx = r["bounds"]["min"], r["bounds"]["max"]
    x0, x1, y0, y1 = mn[0], mx[0], mn[1], mx[1]
    w, h = x1 - x0, y1 - y0
    dec = 3 if r["unit"] == "mm" else 2

    def n(v):
        return num(v, dec)

    def at(p):
        return [p[0] - x0, y1 - p[1]]

    diag = math.hypot(w, h) or 1
    hair = 10 ** -dec
    edge_w, el_w, font = max(diag * 0.0003, hair), max(diag * 0.0008, hair), max(diag * 0.011, hair)

    def line(a, b):
        (ax, ay), (bx, by) = at(a), at(b)
        return f'<line x1="{n(ax)}" y1="{n(ay)}" x2="{n(bx)}" y2="{n(by)}"/>'

    def circle(c, rad):
        cx, cy = at(c)
        return f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(rad)}"/>'

    def shapes(fit):
        k = fit["kind"]
        if k == "point":
            s = diag * 0.006
            x, y = fit["at"]
            return [line([x - s, y], [x + s, y]), line([x, y - s], [x, y + s])]
        if k == "line":
            (cx, cy), (dx, dy), half = fit["center"], fit["dir"], fit["length"] / 2
            return [line([cx - dx * half, cy - dy * half], [cx + dx * half, cy + dy * half])]
        if k == "circle" or fit["sweep"] >= 2 * math.pi - 1e-6:
            return [circle(fit["center"], fit["radius"])]
        cx, cy = fit["center"]
        fr = at([cx + fit["radius"] * math.cos(fit["start"]), cy + fit["radius"] * math.sin(fit["start"])])
        e = fit["start"] + fit["sweep"]
        to = at([cx + fit["radius"] * math.cos(e), cy + fit["radius"] * math.sin(e)])
        large = 1 if fit["sweep"] > math.pi else 0
        return [f'<path d="M {n(fr[0])} {n(fr[1])} A {n(fit["radius"])} {n(fit["radius"])} 0 {large} 0 {n(to[0])} {n(to[1])}"/>']

    out = ['<?xml version="1.0" encoding="UTF-8"?>']
    size = f'width="{n(w)}mm" height="{n(h)}mm"' if r["unit"] == "mm" else f'width="{n(w)}" height="{n(h)}"'
    out.append(f'<svg xmlns="http://www.w3.org/2000/svg" {size} viewBox="0 0 {n(w)} {n(h)}">')
    out.append(f"  <title>{_esc(r['title'])}</title>")
    out.append(f"  <desc>{_esc(r['scaleNote'] + '. One unit is one ' + ('millimetre' if r['unit'] == 'mm' else 'image pixel') + '; y runs down and the origin is the top-left corner of the sheet as shown. Layers: edges (the detected edge chains), elements (the fitted geometry), labels (names, readings and notes).')}</desc>")
    out.append(f'  <g id="edges" fill="none" stroke="{DRAWING_EDGE_COLOR}" stroke-width="{n(edge_w)}" stroke-linecap="round" stroke-linejoin="round">')
    ux, uy = r["chainUnit"]["x"], r["chainUnit"]["y"]
    for c in r.get("chains") or []:
        if len(c) < 2:
            continue
        pts = " ".join(f"{n(at([p[0] * ux, p[1] * uy])[0])},{n(at([p[0] * ux, p[1] * uy])[1])}" for p in c)
        out.append(f'    <polyline points="{pts}"/>')
    out.append("  </g>")
    out.append(f'  <g id="elements" fill="none" stroke-width="{n(el_w)}" stroke-linecap="round">')
    for i, el in enumerate(r["elements"]):
        out.append(f'    <g id="element-{i + 1}" data-name="{_esc(el["name"])}" stroke="{_esc(el["color"])}">')
        out.append(f"      <title>{_esc(el['name'])} — {_esc(el['value'])}</title>")
        out += [f"      {s}" for s in shapes(el["fit"])]
        out.append("    </g>")
    out.append("  </g>")
    out.append(f"  <g id=\"labels\" font-family=\"system-ui, -apple-system, 'Segoe UI', sans-serif\" font-size=\"{n(font)}\">")
    for el in r["elements"]:
        lx, ly = at(label_spot(el["fit"], diag))
        out.append(f'    <text x="{n(lx)}" y="{n(ly)}" fill="{_esc(el["color"])}"><tspan x="{n(lx)}" dy="-1.2em">{_esc(el["name"])}</tspan><tspan x="{n(lx)}" dy="1.2em">{_esc(el["value"])}</tspan></text>')
    for note in r.get("notes") or []:
        nx, ny = at(note["at"])
        out.append(f'    <text x="{n(nx)}" y="{n(ny)}" fill="#333333">{_esc(note["text"])}</text>')
    out.append("  </g>")
    out.append("</svg>")
    return "\n".join(out) + "\n"
