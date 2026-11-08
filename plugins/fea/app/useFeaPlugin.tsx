// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace's part in the app for one render: its panel, and the
// answer drawn on the stage in place of the scan while it is shown here.

import { useEffect, useRef } from 'react'
import type { PluginHost, PluginRuntime } from '../../../src/plugins/api'
import { useShell } from '../../../src/state/shellStore'
import { usePrefs } from '../../../src/state/prefsStore'
import { useFea } from '../state/feaStore'
import { FeaPanel } from '../ui/FeaPanel'
import { FeaResultLayer } from '../viewer/resultLayer'

export function useFeaPlugin(host: PluginHost): PluginRuntime {
  const onScreen = useShell((s) => s.workspace === 'fea')
  const result = useFea((s) => s.result)
  const field = useFea((s) => s.field)
  const shown = useFea((s) => s.shown)
  const target = useFea((s) => s.target)
  const colormap = usePrefs((s) => s.colormap)
  const layer = useRef<FeaResultLayer | null>(null)
  const drawn = onScreen && shown && result !== null

  useEffect(
    () => () => {
      layer.current?.dispose()
      layer.current = null
    },
    [],
  )
  useEffect(() => {
    const scene = host.sceneRef.current
    if (!scene) return
    if (!drawn) {
      layer.current?.clear()
      return
    }
    layer.current ??= new FeaResultLayer(scene)
    layer.current.show(result.surface.positions, result.surface.index, result.surface.fields[field], field, colormap, target)
  }, [host, drawn, result, field, colormap, target])

  return {
    // The panel's frame: the column the app's own panels stand in.
    panel: (
      <aside className="panel">
        <FeaPanel />
      </aside>
    ),
    hideScan: drawn,
    startPane: { title: 'Strength of a printed part', blurb: 'Build or import the part in Reverse Engineer, then come here: choose how it is printed and in what, hold it by some faces, load others, and solve. Gmsh and CalculiX — FreeCAD’s own — run on your computer.' },
  }
}
