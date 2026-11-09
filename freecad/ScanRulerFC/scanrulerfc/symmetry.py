# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/symmetry.ts
#
# The plane the scan is mirror-symmetric about.

from .model import Refusal


def find_symmetry(scan, vertices=None, seed=None):
    raise Refusal("not_implemented", "plane-symmetry is not ported to ScanRuler for FreeCAD yet.")
