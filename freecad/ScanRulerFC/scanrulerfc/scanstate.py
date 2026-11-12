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
        # The scan as read, the factor it was scaled by and the alignment
        # applied after it: V = R·(k·V0) + t.
        self.V0 = self.V.copy()
        self.k = 1.0
        self.R = np.eye(3)
        self.t = np.zeros(3)
        self.version = 0
        self._graph = None

    def set_pose(self, k, R, t):
        self.k, self.R, self.t = float(k), np.asarray(R, dtype=float), np.asarray(t, dtype=float)
        self.V = (self.k * self.V0) @ self.R.T + self.t
        self._normals = self._areas = self._graph = None
        self.version += 1

    def graph(self):
        """The scan's mesh graph (adjacency, vertex normals) in its current
        pose."""
        if self._graph is None:
            from .meshgraph import MeshGraph

            self._graph = MeshGraph(self.V, self.F)
        return self._graph

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


def fresh():
    return {"scan": None, "elements": [], "dimensions": [], "next": 1, "dimNext": 1, "counters": {}, "marked": None, "scaled": None}


def state(session):
    st = session.family_state.setdefault(KEY, fresh())
    for k, v in fresh().items():
        st.setdefault(k, v)
    return st


def scan_of(session):
    from agentlink.protocol import ToolError

    s = state(session)["scan"]
    if s is None:
        raise ToolError("invalid_state", "No scan open: scan_open { path } opens one.")
    return s


def more_formats():
    """Agent Link's readers for glTF/GLB, Collada, VRML and 3DS, where this
    Agent Link has them."""
    try:
        from agentlink import meshformats

        return meshformats
    except ImportError:
        return None


def load(path, units="mm", given=True):
    """A scan from STL, PLY, OBJ, OFF or 3MF through FreeCAD's Mesh module,
    scaled to millimetres; glTF/GLB, Collada, VRML and 3DS through Agent
    Link's readers, in the units their format says unless given."""
    import Mesh

    if units not in UNITS:
        raise ValueError(f"units: one of {', '.join(UNITS)}.")
    mf = more_formats()
    if mf and os.path.splitext(path)[1].lower().lstrip(".") in mf.FORMATS:
        V, F, _info = mf.read(path, units if given else None)
        return Scan(os.path.basename(path), V, F, units if given else "mm", path)
    m = Mesh.Mesh(path)
    pts, tris = m.Topology
    V = np.array([[p.x, p.y, p.z] for p in pts], dtype=float) * UNITS[units]
    F = np.array(tris, dtype=np.int64)
    if len(F) == 0:
        raise ValueError(f"{os.path.basename(path)}: no triangles read.")
    return Scan(os.path.basename(path), V, F, units, path)


def from_mesh(m, name):
    """A scan from a FreeCAD mesh already in millimetres — a document's mesh object."""
    pts, tris = m.Topology
    V = np.array([[p.x, p.y, p.z] for p in pts], dtype=float)
    F = np.array(tris, dtype=np.int64)
    if len(F) == 0:
        raise ValueError(f"{name}: the mesh has no triangles.")
    return Scan(name, V, F, "mm", None)
