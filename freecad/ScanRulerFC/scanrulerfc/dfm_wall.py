# SPDX-License-Identifier: AGPL-3.0-only
# ScanRuler's wall thickness for Agent Link's printability check: points are
# laid evenly over the part's surface, and from each a ray goes in along the
# surface normal, with a cone of rays round it and hits facing away skipped,
# as ScanRuler's Wall Thickness reads a scan. Points near an edge are
# skipped: a ray there reads the corner, not a wall.
#
# The surface the rays hit is FreeCAD's standard tessellation, which is
# closed for a sound solid. Mefisto's even triangles were used before, but
# Mefisto leaves a face with small holes (the top of a screw boss with its
# pilot) half-meshed, and the rays then read 0.05 mm "walls" that are not
# there. Evenness now comes from the points, not the triangles.
import math

import numpy as np

from .dev_surface import NominalSurface
from .wall_thickness import DEFAULT_CONE_ANGLE_DEG, DEFAULT_NORMAL_DEVIATION_DEG, compute_thickness

BY = "ScanRuler wall thickness (ScanRulerFC)"


def even_points(A, B, C, N, area, good, spacing):
    """About one point per 0.43 spacing^2 of surface (one per triangle of
    side spacing), laid by area so long thin triangles get their share:
    systematic along the summed area, each point placed inside its triangle
    by a fixed low-discrepancy pair, so a part reads the same every time."""
    w = np.where(good, area, 0.0)
    total = float(w.sum())
    if total <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0, dtype=np.int64)
    n = max(1, int(round(total / (0.433 * spacing * spacing))))
    cum = np.cumsum(w)
    u = (np.arange(n) + 0.5) * (total / n)
    k = np.minimum(np.searchsorted(cum, u), len(w) - 1)
    i = np.arange(n, dtype=float)
    r1 = np.mod(0.5 + i * 0.7548776662466927, 1.0)
    r2 = np.mod(0.5 + i * 0.5698402909980532, 1.0)
    flip = r1 + r2 > 1
    r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
    P = A[k] + r1[:, None] * (B[k] - A[k]) + r2[:, None] * (C[k] - A[k])
    return P, N[k], k


def read(shape, spacing=1.5, reach=12.0, cap=2500, cone_rays=8):
    import MeshPart

    if not shape.Solids:
        return None
    # About cap points, evenly: every one read, so a thin place's readings
    # join into one run.
    spacing = max(spacing, math.sqrt(2.3 * shape.Area / cap))
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=min(0.05, spacing / 20), AngularDeflection=math.radians(12), Relative=False)
    m.harmonizeNormals()
    if m.Volume < 0:
        m.flipNormals()
    pts, tris = m.Topology
    V = np.array([[p.x, p.y, p.z] for p in pts], dtype=float)
    F = np.array(tris, dtype=np.int64)
    if len(F) == 0:
        return None
    A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    Nf = np.cross(B - A, C - A)
    area2 = np.linalg.norm(Nf, axis=1)
    good = area2 > 1e-12
    Nf[good] /= area2[good, None]
    centre, N, _ = even_points(A, B, C, Nf, area2 * 0.5, good, spacing)
    ok = np.ones(len(centre), dtype=bool)
    # Away from the edges, by the edges' own points.
    edge = [np.array([[p.x, p.y, p.z] for p in e.discretize(Distance=spacing / 2)]) for e in shape.Edges if e.Length > 1e-6]
    E = np.vstack(edge) if edge else np.zeros((0, 3))
    skip = min(spacing / 2, 0.75)
    if len(E):
        near = np.zeros(len(centre), dtype=bool)
        for i in range(0, len(centre), 512):
            d = np.linalg.norm(centre[i:i + 512, None, :] - E[None, :, :], axis=2).min(axis=1)
            near[i:i + 512] = d < skip
        ok &= ~near
    idx = np.nonzero(ok)[0]
    if len(idx) > 2 * cap:
        idx = idx[:: int(math.ceil(len(idx) / (2 * cap)))]
    if not len(idx):
        return None
    diag = float(np.linalg.norm(V.max(0) - V.min(0)))
    t = compute_thickness(NominalSurface(V, F), centre[idx], N[idx], cone_rays=cone_rays, cone_angle=math.radians(DEFAULT_CONE_ANGLE_DEG),
                          max_normal_deviation=math.radians(DEFAULT_NORMAL_DEVIATION_DEG), max_thickness=reach, epsilon=max(1e-6, diag * 1e-5))
    # How far apart the readings land: thin_runs joins a thin place's
    # readings by it, so a lip thin all the way round is one run.
    step = spacing
    got = np.isfinite(t)
    if not got.any():
        return None
    readings = [(float(t[k]), [round(float(x), 3) for x in centre[i]], step) for k, i in enumerate(idx) if got[k]]
    normals = [tuple(float(x) for x in N[i]) for k, i in enumerate(idx) if got[k]]
    j = int(np.nanargmin(t))
    return {"least": round(float(t[j]), 3), "at": [round(float(x), 3) for x in centre[idx[j]]], "samples": int(len(idx)), "read": len(readings),
            "readings": readings, "normals": normals, "spacing": step, "by": BY}


def register():
    try:
        from agentlink import printability
    except ImportError:
        return
    hook = getattr(printability, "WALL_READERS", None)
    if hook is not None and read not in hook:
        hook.append(read)
