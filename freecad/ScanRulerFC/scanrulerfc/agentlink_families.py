# SPDX-License-Identifier: AGPL-3.0-only
# What Agent Link loads from this add-on: the tool families, each a module
# with GROUP, INFO and tools(session).

import importlib

NAMES = ["fam_scan", "fam_elements", "fam_align", "fam_dimensions", "fam_sections", "fam_meshtools", "fam_flat", "fam_deviation", "fam_thickness"]

FAMILIES = [importlib.import_module(f"{__package__}.{n}") for n in NAMES]

# The scan, the reference and their maps in Agent Link's pictures.
from .render_layers import register  # noqa: E402

register()
