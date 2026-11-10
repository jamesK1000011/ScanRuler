# SPDX-License-Identifier: AGPL-3.0-only
# What Agent Link loads from this add-on: the tool families, each a module
# with GROUP, INFO and tools(session).

import importlib

NAMES = ["fam_scan", "fam_elements", "fam_align", "fam_dimensions", "fam_sections", "fam_meshtools", "fam_flat", "fam_deviation", "fam_thickness", "fam_noise", "fam_thread", "fam_wear", "fam_catalog", "fam_manual", "fam_pack", "fam_fitcomp", "fam_cad"]

FAMILIES = [importlib.import_module(f"{__package__}.{n}") for n in NAMES]

# The scan, the reference and their maps in Agent Link's pictures.
from .render_layers import register  # noqa: E402

register()

# The scan guides beside Agent Link's own (guide_read: measure-scan,
# mesh-tools).
try:
    import os as _os

    from agentlink.tools import register_guides as _register_guides

    _register_guides(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "guides"))
except ImportError:  # an Agent Link without guides from add-ons
    pass
