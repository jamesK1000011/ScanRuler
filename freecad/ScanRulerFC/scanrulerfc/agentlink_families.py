# SPDX-License-Identifier: AGPL-3.0-only
# What Agent Link loads from this add-on: the tool families, each a module
# with GROUP, INFO and tools(session).

import importlib

NAMES = ["fam_scan", "fam_elements", "fam_align", "fam_dimensions"]

FAMILIES = [importlib.import_module(f"{__package__}.{n}") for n in NAMES]
