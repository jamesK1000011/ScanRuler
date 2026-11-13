# SPDX-License-Identifier: AGPL-3.0-only
# The sweep and the scan-to-print table, tried before the bake-off runs them.
import os, subprocess, sys
for s in ("scripts/freecad/audit/tool_sweep.py", "scripts/freecad/e2e_scan_to_print.py"):
    subprocess.run([sys.executable, s], timeout=600)
