// SPDX-License-Identifier: AGPL-3.0-only
// The chips that follow a click on the part in the Reverse engineer
// workspace when no editor is open: what the thing under the click can
// become. A sketch's region offers Extrude and Revolve, an element with an
// axis offers a revolve about it, a plane and a flat body face a sketch on
// it. Object first, verb second — the way Fusion's marking menu
// and Onshape's context toolbar work — so a beginner never has to find the
// panel's feature keys to get from a closed profile to a body. The bar
// stands near the click and goes away on the next press or scroll in the
// viewport, since either moves the camera or picks something else. A pick
// on the bodies heads its readings with the part it is on — its name, the
// components it is in — and keys to hide it or every other part.

import { useLayoutEffect, useRef, useState } from 'react'
import { frameOnFace, movableFace, partialRound } from '../core/features'
import { worldPlaneName } from '../../../src/core/section/frame'
import { projectFaceOutline } from '../core/project'
import { snapFitKind } from '../core/snapFace'
import { selectionInfo } from '../core/selectionInfo'
import { KeyIcon, type KeyIconName } from './reIcons'
import { bodyColor, openFeatureEditor, roundFaceLength, selectionItems, useReverse, type ReSelection } from '../state/reStore'
import { useStore } from '../../../src/state/store'
import { useUnits } from '../../../src/app/useUnits'
import { ThreadIcon } from './ThreadIcon'
import { reverseSession } from '../app/reSession'
import { usePrefs } from '../../../src/state/prefsStore'
import { commonFolder, folderOf } from '../core/bodyFolders'
import type { FaceInfo } from '../core/build'
import { folderPathText, isolateBodies, othersHidden } from './BodyList'
import { pinNoteOnItems, useNotesOn } from '../app/useNotePins'

/** What the status line says as a sketch opens on a plane — from a chip or
 *  from the panel's Sketch on list. */
export const SKETCH_STARTED = 'Fit the slice chains, or draw the profile with the tools, then create the sketch.'

/** The picture a chip carries — the feature key's own. */
const CHIP_ICON: Record<string, KeyIconName> = { note: 'note', 'move-body': 'moveBody', edit: 'edit', 'extrude-face': 'extrude', 'move-face': 'moveFace', 'delete-face': 'deleteFace', snap: 'moveFace', draft: 'draft', extrude: 'extrude', revolve: 'revolve', 'revolve-about': 'revolve', hole: 'hole', extract: 'extract', 'sketch-here': 'sketch', 'sketch-on': 'sketch', shell: 'shell', mirror: 'mirror', fillet: 'fillet', chamfer: 'chamfer', 'hide-plane': 'eyeOff', clearance: 'dimDistance' }

/** The chip that moves the bodies picked — or copies them, the box's
 *  tick — by the gizmo or by numbers. */
function moveChip(bodies: number[]): { key: string; label: string; title: string; run: () => void } {
  const one = bodies.length === 1
  return {
    key: 'move-body',
    label: one ? 'Move body' : 'Move bodies',
    title: `Move or turn ${one ? 'this body' : 'these bodies'}`,
    run: () => useReverse.getState().startFeature('moveBody', { bodies }),
  }
}

/** The faces a Delete face opened on a face starts with: the whole round,
 *  hole or boss it is part of, as a click in the box takes it — or the
 *  face alone. */
function deleteGroup(bodyId: number, face: FaceInfo): FaceInfo[] {
  const group = reverseSession()?.deleteFacesAt(bodyId, face.hash, true) ?? []
  return group.length > 0 ? group : [face]
}

/** What the chips say for each kind of thing picked. */
function chipsFor(sel: ReSelection): { key: string; label: string; title: string; run: () => void }[] {
  const re = useReverse.getState
  switch (sel.kind) {
    case 'region':
      return [
        { key: 'extrude', label: 'Extrude', title: 'Extrude this profile', run: () => re().startExtrude(sel.sketchId, [sel.key]) },
        { key: 'revolve', label: 'Revolve', title: 'Revolve this profile about an axis picked next', run: () => re().startRevolve(sel.sketchId, [sel.key]) },
      ]
    case 'element': {
      const fit = useStore.getState().elements.find((e) => e.id === sel.id)?.fit
      const hasBody = re().bodies.length > 0
      const chips: { key: string; label: string; title: string; run: () => void }[] = []
      if (fit && (fit.kind === 'line' || fit.kind === 'cylinder' || fit.kind === 'cone' || fit.kind === 'circle')) {
        chips.push({ key: 'revolve-about', label: 'Revolve about this', title: `Revolve the last sketch's profile about ${sel.name}`, run: () => re().startRevolve(null, null, { kind: 'element', id: sel.id }) })
      }
      if (fit && hasBody && (fit.kind === 'cylinder' || fit.kind === 'circle')) {
        chips.push({ key: 'hole', label: 'Hole', title: `Drill a hole through the body along ${sel.name}`, run: () => re().startFeature('hole', { axis: { kind: 'element', id: sel.id }, radius: fit.radius }) })
      }
      // A plane is sketched on as it is from the panel's Sketch on list.
      if (fit?.kind === 'plane') {
        chips.push({
          key: 'sketch-on',
          label: 'Sketch',
          title: `Start a sketch on ${sel.name}`,
          run: () => {
            if (!re().startSketchOn({ kind: 'plane', id: sel.id })) useStore.getState().setError('That plane is not available any more.')
            else useStore.getState().setStatus(SKETCH_STARTED)
          },
        })
      }
      if (fit && (fit.kind === 'plane' || fit.kind === 'cylinder' || fit.kind === 'cone' || fit.kind === 'sphere' || fit.kind === 'torus')) {
        chips.push({ key: 'extract', label: 'Extract as body', title: `Make ${sel.name} a solid body`, run: () => re().startFeature('extract', { element: sel.id }) })
      }
      return chips
    }
    case 'coordinatePlane': {
      const name = worldPlaneName(sel.axis)
      return [
        {
          key: 'sketch-on',
          label: 'Sketch',
          title: `Start a sketch on the ${name}`,
          run: () => {
            if (!re().startSketchOn({ kind: 'world', axis: sel.axis, offset: 0 })) useStore.getState().setError('That plane is not available any more.')
            else useStore.getState().setStatus(SKETCH_STARTED)
          },
        },
        { key: 'hide-plane', label: 'Hide', title: `Hide the ${name}`, run: () => re().setPlaneShown(sel.axis, false) },
      ]
    }
    case 'sketchLine':
      return [{ key: 'revolve-about', label: 'Revolve about this', title: 'Revolve the sketch about this line', run: () => re().startRevolve(sel.sketchId, null, { kind: 'sketchLine', entity: sel.entity }) }]
    case 'bodyFace': {
      const frame = frameOnFace(sel.face.fingerprint)
      const chips: { key: string; label: string; title: string; run: () => void }[] = []
      // The feature that made the face, opened as its row in the list opens
      // it: a fillet's face goes back to the fillet, a wall to its extrude.
      const maker = re().features.find((f) => f.id === sel.face.fingerprint.origin)
      if (maker) chips.push({ key: 'edit', label: `Edit ${maker.name}`, title: `Open ${maker.name}, the feature that made this face, to change it`, run: () => openFeatureEditor(maker.id) })
      // A round face short of a full turn — a fillet's — is neither resized
      // nor threaded: both need the whole way round.
      const partial = partialRound(sel.face)
      // A flat face is pulled as it stands — outward it joins the body,
      // inward it cuts — or sketched on, the sketch opening with the face's
      // own outline projected into it, as a CAD sketch on a face does.
      if (frame) {
        chips.push({
          key: 'extrude-face',
          label: 'Extrude',
          title: 'Drag to add to the body or cut into it',
          run: () => {
            const why = re().extrudeFace(sel.bodyId, sel.face)
            if (why) useStore.getState().setError(why)
          },
        })
        chips.push({
          key: 'sketch-here',
          label: 'Sketch here',
          title: 'Sketch on this face, its outline brought in',
          run: () => {
            const { entities, skipped } = projectFaceOutline(sel.edges, frame, sel.bodyId)
            re().startSketch({ kind: 'bodyFace', body: sel.bodyId, face: sel.face.fingerprint, frame }, frame, entities)
            useStore.getState().setStatus(`Sketch on the face — its outline is projected in${skipped > 0 ? `, all but ${skipped} curved edge${skipped === 1 ? '' : 's'} the sketcher has no piece for` : ''}. Draw on it, or Finish and extrude the outline itself.`)
          },
        })
      }
      // A face moved by a distance — a round one in radius — or laid on the
      // scan: the scan is clicked next, where the face should be.
      if (movableFace(sel.face.fingerprint) && !partial) {
        chips.push({
          key: 'move-face',
          label: 'Move face',
          title: sel.face.fingerprint.kind === 'cylinder' ? 'Grow or shrink this round face’s radius' : 'Move this face by a distance (Ctrl+click for more)',
          run: () => re().startFeature('moveFace', { body: sel.bodyId, faces: [sel.face] }),
        })
      }
      if (snapFitKind(sel.face.fingerprint) && !partial) {
        chips.push({
          key: 'snap',
          label: 'Snap to scan',
          title: 'Click the scan where this face should lie',
          run: () => {
            re().startFeature('moveFace', { body: sel.bodyId, faces: [sel.face], snap: true })
            useStore.getState().setStatus('Now click the scan where this face should lie.')
          },
        })
      }
      chips.push({ key: 'shell', label: 'Shell', title: 'Hollow the body, this face taken away to open it', run: () => re().startFeature('shell', { body: sel.bodyId, faces: [sel.face] }) })
      chips.push({
        key: 'delete-face',
        label: 'Delete face',
        title: 'Remove this face’s feature and heal the gap',
        run: () => re().startFeature('deleteFace', { body: sel.bodyId, faces: deleteGroup(sel.bodyId, sel.face) }),
      })
      if (sel.face.fingerprint.kind === 'cylinder' && sel.face.fingerprint.center) {
        chips.push({ key: 'hole', label: 'Hole', title: 'A hole along this face’s axis', run: () => re().startFeature('hole', { body: sel.bodyId, axis: { kind: 'face', face: sel.face.fingerprint }, radius: sel.face.fingerprint.radius ?? 3 }) })
        if (!partial) chips.push({ key: 'thread', label: 'Thread', title: 'Model a screw thread on this round face', run: () => re().startFeature('thread', { body: sel.bodyId, face: sel.face, length: roundFaceLength(sel.face.fingerprint) }) })
      }
      if (frame) chips.push({ key: 'mirror', label: 'Mirror', title: 'Mirror the body about this face', run: () => re().startFeature('mirror', { body: sel.bodyId, plane: { kind: 'face', face: sel.face.fingerprint } }) })
      if (frame) chips.push({ key: 'draft', label: 'Draft', title: 'Draft faces about this one; click faces to tilt', run: () => re().startFeature('draft', { body: sel.bodyId, neutral: { kind: 'face', face: sel.face.fingerprint } }) })
      chips.push(moveChip([sel.bodyId]))
      return chips
    }
    case 'bodyEdge':
      return [
        { key: 'fillet', label: 'Fillet', title: 'Round this edge — the radius is read off the scan', run: () => re().startFeature('fillet', { body: sel.bodyId, edges: [sel.edge] }) },
        { key: 'chamfer', label: 'Chamfer', title: 'Chamfer this edge', run: () => re().startFeature('chamfer', { body: sel.bodyId, edges: [sel.edge] }) },
        moveChip([sel.bodyId]),
      ]
    case 'bodyVertex':
      // A corner is read, not built on.
      return []
    case 'bodyItems': {
      // Several edges of one body are rounded or chamfered together, several
      // of its faces opened by one shell; a mixed pick is there to be read.
      const edges = sel.items.filter((i) => i.type === 'edge')
      const faces = sel.items.filter((i) => i.type === 'face')
      const oneBody = sel.items.every((i) => i.bodyId === sel.items[0].bodyId)
      const body = sel.items[0].bodyId
      if (oneBody && edges.length === sel.items.length) {
        const picked = edges.map((i) => i.edge)
        return [
          { key: 'fillet', label: 'Fillet', title: `Round these ${picked.length} edges`, run: () => re().startFeature('fillet', { body, edges: picked }) },
          { key: 'chamfer', label: 'Chamfer', title: `Chamfer these ${picked.length} edges`, run: () => re().startFeature('chamfer', { body, edges: picked }) },
        ]
      }
      // Picks on two bodies: how they stand to each other — and, on two or
      // more, the bodies moved together.
      const two = [...new Set(sel.items.map((i) => i.bodyId))]
      if (two.length > 2) return [moveChip(two)]
      if (two.length === 2) {
        return [
          moveChip(two),
          {
            key: 'clearance',
            label: 'Clearance',
            title: 'Closest gap, or overlap, between the two bodies',
            run: () => {
              const s = reverseSession()
              if (!s) return
              s.clearance(two[0], two[1], usePrefs.getState().units).then(
                (r) => useStore.getState().setStatus(r.text),
                (e: unknown) => useStore.getState().setError(`The clearance could not be measured: ${e instanceof Error ? e.message : String(e)}`),
              )
            },
          },
        ]
      }
      if (oneBody && faces.length === sel.items.length) {
        const picked = faces.map((i) => i.face)
        const chips = [
          { key: 'shell', label: 'Shell', title: `Hollow the body, open at these ${picked.length} faces`, run: () => re().startFeature('shell', { body, faces: picked }) },
          { key: 'delete-face', label: 'Delete faces', title: `Take these ${picked.length} faces off the body and heal the gap`, run: () => re().startFeature('deleteFace', { body, faces: picked }) },
        ]
        if (picked.every((f) => movableFace(f.fingerprint) && !partialRound(f))) {
          chips.unshift({ key: 'move-face', label: 'Move faces', title: `Move these ${picked.length} faces together by one distance`, run: () => re().startFeature('moveFace', { body, faces: picked }) })
        }
        return chips
      }
      return []
    }
  }
}

/** The part — or parts — a pick on the bodies is on: named, with the
 *  components it is in, and its eye: hide it, or every other body — a key
 *  that shows them all again once they are — and, for picks on several,
 *  a component made of them. */
function BodyLine({ ids }: { ids: number[] }) {
  const bodies = useReverse((s) => s.bodies)
  const folders = useReverse((s) => s.bodyFolders)
  const these = bodies.filter((b) => ids.includes(b.id))
  if (these.length === 0) return null
  const one = these.length === 1 ? these[0] : null
  const path = one ? folderPathText(folders, folderOf(folders, one.id)?.id ?? null) : ''
  const names = these.map((b) => b.name).join(', ')
  const re = useReverse.getState
  const alone = othersHidden(ids, bodies)
  return (
    <div className="chipbody" data-test="chip-body">
      {one && <span className="dot" style={{ background: one.color ?? bodyColor(one.id) }} />}
      <span className="chipbody-name" title={one ? (path ? `${one.name}, in ${path}` : one.name) : names}>
        <span data-test="chip-body-name">{one ? one.name : `${these.length} bodies`}</span>
        {path && <small data-test="chip-body-path">in {path}</small>}
      </span>
      <span className="chipbody-keys">
        <button
          data-test="chip-hide-body"
          title={one ? `Hide ${one.name} — its eye in the body list brings it back` : `Hide these bodies — ${names}`}
          onClick={() => {
            re().setSelection(null)
            re().setBodiesVisible(ids, false)
          }}
        >
          Hide
        </button>
        {bodies.length > these.length && (
          <button data-test="chip-hide-others" title={alone ? 'Show every body again' : `Hide every body but ${one ? one.name : 'these'}`} onClick={() => (alone ? re().setAllBodiesVisible(true) : isolateBodies(ids))}>
            {alone ? 'Show all' : 'Hide others'}
          </button>
        )}
        {these.length > 1 && (
          <button
            data-test="chip-make-component"
            title={`Put ${names} into a new component in the body list`}
            onClick={() => {
              const id = re().addBodyFolder(commonFolder(re().bodyFolders, { bodies: ids }), { bodies: ids })
              useStore.getState().setStatus(`${re().bodyFolders.find((f) => f.id === id)?.name ?? 'A component'} holds them now — double-click its name in the body list to name it.`)
            }}
          >
            Make component
          </button>
        )}
      </span>
    </div>
  )
}

export function ContextChips() {
  const selection = useReverse((s) => s.selection)
  const notesOn = useNotesOn()
  const units = useUnits()
  const barRef = useRef<HTMLDivElement>(null)

  // The selection is put away as CAD puts it away: by a click on nothing
  // (the viewer's onClickAway), by Escape, or by the feature or sketch it
  // is turned into. Turning, panning or zooming the camera leaves it — a
  // press anywhere used to clear it, and a selection gathered with Ctrl was
  // lost to the orbit that meant to look at it. The bar stays where the
  // last click put it.

  // The bar stands by the click, and wholly on the screen: with readings
  // in it, it is a card, and a click near the window's edge would hang it
  // over the side.
  const [shift, setShift] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || !selection) {
      setShift((s) => (s.x === 0 && s.y === 0 ? s : { x: 0, y: 0 }))
      return
    }
    const r = bar.getBoundingClientRect()
    const left = selection.at.x + 12
    const top = selection.at.y + 12
    const x = Math.min(0, window.innerWidth - 8 - (left + r.width))
    // Past the bottom it stands above the click instead.
    const y = top + r.height > window.innerHeight - 8 ? -(r.height + 24) : 0
    setShift((s) => (s.x === x && s.y === y ? s : { x, y }))
  }, [selection])

  if (!selection) return null
  const items = selectionItems(selection)
  const chips = chipsFor(selection)
  // A note for the agent on what is picked, while the agent connection is
  // on: several edges to round, faces to move, in one note.
  if (notesOn && items.length > 0) {
    chips.push({
      key: 'note',
      label: 'Note',
      title: `Pin a note on ${items.length === 1 ? `this ${items[0].type === 'vertex' ? 'corner' : items[0].type}` : 'these'}`,
      run: () => pinNoteOnItems(items, selection.at),
    })
  }
  // What the part says about a face, an edge or a corner picked on it — and
  // about two of them, what lies between.
  const info = selectionInfo(items, units)
  if (chips.length === 0 && !info) return null
  return (
    <div ref={barRef} className={'chipbar' + (info ? ' withinfo' : '')} data-test="context-chips" style={{ left: Math.max(8, selection.at.x + 12 + shift.x), top: Math.max(8, selection.at.y + 12 + shift.y) }}>
      {info && (
        <div className="chipinfo" data-test="chip-info">
          {items.length > 0 && <BodyLine ids={[...new Set(items.map((i) => i.bodyId))]} />}
          <b>{info.title}</b>
          {info.rows.map((r) => (
            <div key={r.label} className="chipinfo-row">
              <span>{r.label}</span>
              <span className="chipinfo-value">{r.value}</span>
            </div>
          ))}
          {selection.kind !== 'bodyItems' && <div className="chipinfo-tip">Ctrl+click adds · Shift+drag a window</div>}
        </div>
      )}
      {chips.map((c) => (
        <button
          key={c.key}
          data-test={`chip-${c.key}`}
          title={c.title}
          onClick={() => {
            useReverse.getState().setSelection(null)
            c.run()
          }}
        >
          {c.key === 'thread' ? <ThreadIcon size={16} /> : CHIP_ICON[c.key] && <KeyIcon name={CHIP_ICON[c.key]} size={16} />}
          {c.label}
        </button>
      ))}
    </div>
  )
}
