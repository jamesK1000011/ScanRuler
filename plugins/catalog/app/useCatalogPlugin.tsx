// SPDX-License-Identifier: AGPL-3.0-only
// The Catalog workspace's part in the app: its panel. The stage keeps the
// part when there is one; without one the panel works all the same.

import type { PluginRuntime } from '../../../src/plugins/api'
import { CatalogPanel } from '../ui/CatalogPanel'

export function useCatalogPlugin(): PluginRuntime {
  return { panel: <CatalogPanel />, startPane: null }
}
