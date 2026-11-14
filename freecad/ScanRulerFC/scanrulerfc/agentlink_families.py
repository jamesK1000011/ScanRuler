# SPDX-License-Identifier: AGPL-3.0-only
# What Agent Link loads from this add-on: the tool families, each a module
# with GROUP, INFO and tools(session). Agent Link finds this module by
# convention — a package on the path holding agentlink_families — and never
# names it, so the two stay apart (Agent Link LGPL, this add-on AGPL).
#
# Everything past the families hooks into Agent Link where this Agent Link
# has the hook. An older Agent Link lacks some (render.register_layer, the
# printability wall readers, thread scan readers, add-on guides): each is
# tried on its own and skipped when missing or failing, so importing this
# module never raises because of the Agent Link it runs in.

import importlib
import os
import sys

NAMES = ["fam_scan", "fam_elements", "fam_align", "fam_dimensions", "fam_sections", "fam_meshtools", "fam_flat", "fam_deviation", "fam_thickness", "fam_noise", "fam_thread", "fam_wear", "fam_catalog", "fam_manual", "fam_pack", "fam_fitcomp", "fam_cad"]

# Shown wherever these tools load (Agent Link's panel and tool groups): whose
# work they are and under which licence.
CREDIT = "ScanRuler tools by Stefan Hermann (CNC Kitchen), ported to FreeCAD — github.com/CNCKitchen/ScanRuler"
LICENSE = "AGPL-3.0-only"

# The families and hooks skipped on this Agent Link, and why: for diagnosis.
SKIPPED = []


def _family(n):
    try:
        return importlib.import_module(f"{__package__}.{n}")
    except Exception as e:  # noqa: BLE001 — one family that cannot load must not take the others down
        SKIPPED.append((n, f"{type(e).__name__}: {e}"))
        print(f"ScanRulerFC: the {n} tools are not loaded ({type(e).__name__}: {e}).", file=sys.stderr)
        return None


FAMILIES = [f for f in (_family(n) for n in NAMES) if f is not None]


def _hook(name, call):
    try:
        call()
    except Exception as e:  # noqa: BLE001 — an older or different Agent Link: skip the hook, keep the tools
        SKIPPED.append((name, f"{type(e).__name__}: {e}"))
        print(f"ScanRulerFC: {name} not hooked into this Agent Link ({type(e).__name__}: {e}).", file=sys.stderr)


def _render():
    # The scan, the reference and their maps in Agent Link's pictures.
    from .render_layers import register

    register()


def _wall():
    # ScanRuler's wall thickness in Agent Link's printability check
    # (dfm_check, part_review), where this Agent Link takes wall readers.
    from .dfm_wall import register

    register()


def _thread():
    # A scanned thread named through Agent Link's thread_identify { scan }.
    from .fam_thread import register

    register()


def _guides():
    # The scan guides beside Agent Link's own (guide_read: measure-scan,
    # mesh-tools), where this Agent Link takes guides from add-ons.
    try:
        from agentlink import tools as al_tools
    except ImportError:
        return
    register_guides = getattr(al_tools, "register_guides", None)
    if register_guides is not None:
        register_guides(os.path.join(os.path.dirname(os.path.abspath(__file__)), "guides"))


for _name, _call in (("pictures", _render), ("wall readers", _wall), ("thread scan readers", _thread), ("guides", _guides)):
    _hook(_name, _call)
