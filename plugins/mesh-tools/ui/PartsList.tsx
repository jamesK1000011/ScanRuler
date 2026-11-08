// SPDX-License-Identifier: AGPL-3.0-only
// The parts of the scan as a list: each piece with its size and an eye, the
// small ones that a removal would take marked.

import { offeredSolids, useSolids } from '../../../src/app/solids'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { Icon } from '../../../src/ui/icons'
import { ExportMeshButton } from '../../../src/ui/ExportMeshButton'
import type { MeshFormat } from '../../../src/core/exportMesh'
import { TRIM_MARK_COLOR, useMeshTools } from '../state/meshStore'
import { count } from './meshFormat'

/**
 * What is in the viewport with no tool in hand, as CAD's browser lists it:
 * the scan — or the edited copy shown in its place — what the tools made
 * beside it, the reduced mesh and the piece Trim to scan cut, and the bodies
 * other workspaces lend. Each is shown or hidden by its eye; a tool in hand
 * shows what it works on instead, and putting it away brings back what the
 * list shows.
 */
export function PartsList({ busy, onExportReduced, onExportTrimmed }: { busy: boolean; onExportReduced: (format: MeshFormat) => void; onExportTrimmed: (format: MeshFormat) => void }) {
  const scanName = useStore((s) => s.fileName)
  const scanTriangles = useStore((s) => s.triangleCount)
  const copyTriangles = useMeshTools((s) => s.copyTriangles)
  const report = useMeshTools((s) => s.report)
  const made = useMeshTools((s) => s.trimMade)
  const shownScan = useMeshTools((s) => s.shownScan)
  const shownReduced = useMeshTools((s) => s.shownReduced)
  const shownPiece = useMeshTools((s) => s.shownPiece)
  const shownBodies = useMeshTools((s) => s.shownBodies)
  const setPartShown = useMeshTools((s) => s.setPartShown)
  const toggleBodyShown = useMeshTools((s) => s.toggleBodyShown)
  const bodies = offeredSolids(useSolids((s) => s.bySource))
  const len = useLength()
  if (!scanName) return null
  return (
    <div className="group" data-test="mesh-parts">
      <div className="g-label">
        <span>Parts</span>
        <b>{1 + (report ? 1 : 0) + (made ? 1 : 0) + bodies.length}</b>
      </div>
      <PartRow
        part="scan"
        name={scanName}
        dot="#8b9099"
        reading={`${count(copyTriangles ?? scanTriangles)} triangles${copyTriangles !== null ? ' · edited' : ''}`}
        title={copyTriangles !== null ? 'The edited copy of the scan, shown in its place' : 'The scan'}
        shown={shownScan}
        what="the scan"
        onToggle={() => setPartShown('scan', !shownScan)}
      />
      {report && (
        <PartRow
          part="reduced"
          name="Reduced mesh"
          dot="#7f8ba0"
          reading={`${count(report.triangles)} triangles`}
          title="The scan reduced for CAD, shown in its place"
          shown={shownReduced}
          what="the reduced mesh"
          onToggle={() => setPartShown('reduced', !shownReduced)}
        />
      )}
      {made && (
        <PartRow
          part="piece"
          name={`${made.name}, trimmed`}
          dot={TRIM_MARK_COLOR}
          reading={len.vol(made.report.volume, 1)}
          title={`Repair piece cut from ${made.name}, mating face in teal`}
          shown={shownPiece}
          what="the piece"
          onToggle={() => setPartShown('piece', !shownPiece)}
        />
      )}
      {bodies.map((b) => {
        const shown = shownBodies.includes(b.key)
        return (
          <PartRow
            key={b.key}
            part="body"
            name={b.name}
            dot="#8b95a3"
            reading={b.source}
            title={`${b.name}, a body from ${b.source}`}
            shown={shown}
            what={b.name}
            onToggle={() => toggleBodyShown(b.key)}
          />
        )
      })}
      <p className="hint">
        What the viewport shows with no tool in hand. The scan and the reduced mesh lie on one
        surface and are shown one at a time; with the piece shown, the scan is a veil over it.
      </p>
      {(report || made) && (
        <div className="toolrow">
          {report && (
            <ExportMeshButton
              label="Export reduced mesh"
              testId="parts-export-reduced"
              disabled={busy}
              onExport={onExportReduced}
              title="Save the reduced mesh as STL or 3MF"
            />
          )}
          {made && (
            <ExportMeshButton
              label="Export piece mesh"
              testId="parts-export-trimmed"
              disabled={busy}
              onExport={onExportTrimmed}
              title="Save the piece as STL or 3MF, alignment included"
            />
          )}
        </div>
      )}
    </div>
  )
}

/** A row of the parts list — a dot of the colour it is drawn in, its name, a
 *  figure, and its eye — as a body's row in Reverse engineer is. */
function PartRow({
  part,
  name,
  dot,
  reading,
  title,
  shown,
  what,
  onToggle,
}: {
  part: string
  name: string
  dot: string
  reading: string
  title: string
  shown: boolean
  /** What the eye shows or hides, for its tooltip: "the scan". */
  what: string
  onToggle: () => void
}) {
  return (
    <div className={'kv' + (shown ? '' : ' ghost')} data-test={`part-${part}`} title={title}>
      <span className="dot" style={{ background: dot }} />
      <span className="name">{name}</span>
      <b>{reading}</b>
      <button className={'x eye' + (shown ? '' : ' off')} data-test={`part-${part}-visible`} title={shown ? `Hide ${what}` : `Show ${what}`} onClick={onToggle}>
        <Icon name={shown ? 'eye' : 'eyeOff'} size={14} />
      </button>
    </div>
  )
}
