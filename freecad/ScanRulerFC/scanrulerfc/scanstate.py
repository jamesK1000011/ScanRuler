# SPDX-License-Identifier: AGPL-3.0-only
# The scan held by the session, as arrays: what every measuring tool reads.
# The part of ScanRuler's session that holds the scan (src/core/types.ts,
# src/core/meshUnits.ts), ported to numpy.

import os

import numpy as np

KEY = "scanruler"
UNITS = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4}


class Scan:
    def __init__(self, name, verts, faces, units="mm", path=None):
        self.name = name
        self.path = path
        self.units = units
        self.V = np.asarray(verts, dtype=float)
        self.F = np.asarray(faces, dtype=np.int64)
        self._normals = None
        self._areas = None

    @property
    def tri(self):
        return self.V[self.F]

    def face_normals(self):
        if self._normals is None:
            t = self.tri
            n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
            a = np.linalg.norm(n, axis=1)
            self._areas = a / 2
            with np.errstate(invalid="ignore", divide="ignore"):
                self._normals = np.where(a[:, None] > 0, n / a[:, None], 0.0)
        return self._normals

    def face_areas(self):
        self.face_normals()
        return self._areas

    def summary(self):
        lo, hi = self.V.min(axis=0), self.V.max(axis=0)
        return {
            "file": self.name,
            "units": self.units,
            "vertices": int(len(self.V)),
            "triangles": int(len(self.F)),
            "box": {"min": [round(float(x), 3) for x in lo], "max": [round(float(x), 3) for x in hi], "size": [round(float(x), 3) for x in hi - lo]},
            "centre": [round(float(x), 3) for x in (lo + hi) / 2],
            "area": round(float(self.face_areas().sum()), 2),
        }


def state(session):
    return session.family_state.setdefault(KEY, {"scan": None, "elements": [], "dimensions": [], "next": 1})


def scan_of(session):
    from agentlink.protocol import ToolError

    s = state(session)["scan"]
    if s is None:
        raise ToolError("invalid_state", "No scan open: scan_open { path } opens one.")
    return s


def load(path, units="mm"):
    """A scan from STL, PLY, OBJ, OFF or 3MF through FreeCAD's Mesh module,
    scaled to millimetres."""
    import Mesh

    if units not in UNITS:
        raise ValueError(f"units: one of {', '.join(UNITS)}.")
    m = Mesh.Mesh(path)
    pts, tris = m.Topology
    V = np.array([[p.x, p.y, p.z] for p in pts], dtype=float) * UNITS[units]
    F = np.array(tris, dtype=np.int64)
    if len(F) == 0:
        raise ValueError(f"{os.path.basename(path)}: no triangles read.")
    return Scan(os.path.basename(path), V, F, units, path)
