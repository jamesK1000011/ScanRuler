// SPDX-License-Identifier: AGPL-3.0-only
// The scan jobs both sides run on the same fixture (scan_fixture.py): scan
// check (open the scan, what it gives), the deviation map against the part
// as made, and a section's fit (the bolt hole read off a cut through the
// foot). Each side calls its own tools the way its guides have it; what
// they read is pulled out the same way, so the scorecard compares like
// with like.

/** The first number under any key in `keys`, searched depth-first. */
export function findNum(o, keys, ok = () => true) {
  if (o == null || typeof o !== 'object') return null
  for (const [k, v] of Object.entries(o)) {
    if (keys.includes(k) && typeof v === 'number' && ok(v)) return v
  }
  for (const v of Object.values(o)) {
    const r = findNum(v, keys, ok)
    if (r !== null) return r
  }
  return null
}

const holeFrom = (json) => {
  const r = findNum(json, ['radius', 'r'], (v) => v > 2.5 && v < 4.5)
  if (r !== null) return 2 * r
  return findNum(json, ['diameter', 'd'], (v) => v > 5 && v < 9)
}
const noiseFrom = (json) => {
  const n = json?.noise
  if (typeof n === 'number') return n
  return findNum(n ?? {}, ['median', 'mm', 'value', 'p50', 'sigma'])
}
const rmsFrom = (json) => findNum(json?.deviation ?? json, ['rms', 'RMS'])

/** Agent Link (with ScanRuler for FreeCAD). */
export async function freecadScanJobs(call, fx) {
  const r = {}
  await call('tool_groups', { enable: ['scan', 'sections', 'deviation'] }, 'the scan tools listed')
  await call('doc_new', { name: 'Scan jobs' }, 'a document of its own')
  await call('scan_open', { path: fx.scan }, 'scan check: the scan')
  const qa = await call('scan_qa', {}, 'scan check: what it will give')
  r.scanCheck = { noise: noiseFrom(qa.json), ok: !qa.error }
  await call('deviation_open_reference', { path: fx.step }, 'deviation: the part as made')
  const a = await call('deviation_align', { mode: 'auto' }, 'deviation: best fit and the map')
  r.deviation = { rms: rmsFrom(a.json), ok: !a.error }
  const cut = await call('section_cut', { across: { origin: [0, 0, fx.truth.section.z], normal: [0, 0, 1] }, name: 'Foot' }, 'section: through the foot')
  const id = cut.json?.section?.id ?? cut.json?.id
  const fit = await call('section_fit', { section: id }, 'section: lines and arcs')
  r.section = { hole: holeFrom(fit.json), ok: !fit.error }
  return r
}

/** ScanRuler in the browser. */
export async function scanrulerScanJobs(call, fx) {
  const r = {}
  await call('scan_open', { path: fx.scan, discard: true }, 'scan check: the scan')
  const qa = await call('scan_qa', {}, 'scan check: what it will give')
  r.scanCheck = { noise: noiseFrom(qa.json), ok: !qa.error }
  await call('workspace_set', { workspace: 'deviation' }, 'the Deviation workspace')
  await call('deviation_open_reference', { path: fx.step }, 'deviation: the part as made')
  const a = await call('deviation_align', {}, 'deviation: best fit and the map')
  r.deviation = { rms: rmsFrom(a.json), ok: !a.error }
  await call('workspace_set', { workspace: 'reverse' }, 'Reverse engineer, for sections')
  await call('section_cut', { across: 'XY', offset: fx.truth.section.z, name: 'Foot' }, 'section: through the foot')
  const got = await call('section_get', { limit: 400 }, 'section: its chains')
  const chains = got.json?.chains ?? []
  // the hole: the shortest closed chain
  let k = -1
  chains.forEach((c, i) => {
    if ((c.closed ?? true) && (k < 0 || (c.length ?? 1e9) < (chains[k].length ?? 1e9))) k = i
  })
  const fit = k >= 0 ? await call('flat_fit', { kind: 'circle', method: 'flat-circle-edge', chains: [k] }, 'section: the hole fitted') : { json: null, error: true }
  r.section = { hole: holeFrom(fit.json), ok: !fit.error }
  return r
}
