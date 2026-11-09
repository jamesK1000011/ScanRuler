// SPDX-License-Identifier: AGPL-3.0-only
// The white-cell scenarios A–D as scripted call sequences: the calls an
// agent following the guides makes today, in order, by tool name (a
// command's name with its dots as underscores: reverse.body.check →
// reverse_body_check). Each step:
//
//   id       a short name, unique in its scenario
//   tool     the tool called
//   args     its arguments, or (ctx) => arguments
//   why      what the step is for, in the report
//   when     (ctx) => boolean — run only then; skipped otherwise
//   needs    ctx keys that must be set (else skipped, naming the missing one)
//   save     (json, ctx) => void — take what later steps need
//   expect   (json, ctx) => string | null — a failure no refusal reports
//            (a silent failure): the string says what was wrong
//   flags    (json, ctx) => string[] — findings to note, not failures
//   probe    true: the call is a cost measurement, not a step the agent
//            strictly needs (a guide, an unfiltered describe)
//   fallback another step, run when this one is refused (headless: the
//            page-only command's headless stand-in, where there is one)
//
// Nothing here imports the app or a plugin: the scenarios only name tools.

import { join } from 'node:path'

/** The first string anywhere in `v` that `test` accepts. */
export function deepFind(v, test, depth = 0) {
  if (depth > 8 || v == null) return null
  if (typeof v === 'string') return test(v) ? v : null
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = deepFind(x, test, depth + 1)
      if (f) return f
    }
    return null
  }
  if (typeof v === 'object') {
    for (const x of Object.values(v)) {
      const f = deepFind(x, test, depth + 1)
      if (f) return f
    }
  }
  return null
}

/** A body describe's bodies, as reverse.body.describe answers them. */
const bodiesOf = (json) => (Array.isArray(json?.bodies) ? json.bodies : [])
const facesOf = (json) => bodiesOf(json)[0]?.faceList ?? []
/** A where query for flat faces facing `n`. */
const facing = (n, deg = 3) => ({ kind: 'plane', between: [n], withinDeg: deg })
const sketchCircle = (name, z, c, r) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z', offset: z }, sketch: { shapes: [{ kind: 'circle', center: c, radius: r }] } })
const extrude = (name, sketchId, from, to, op, target) => ({ kind: 'extrude', name, sketchId, extent: { kind: 'distance', from, to }, op, ...(target ? { target } : {}) })
const add = (feature) => ({ tool: 'reverse_feature_add', arguments: { feature, detail: 'none' } })
const stringify = (json) => JSON.stringify(json ?? '')

/** Take the body names from a describe without body. */
const saveBodies = (keys) => (json, ctx) => {
  const names = bodiesOf(json).map((b) => b.name)
  keys.forEach((k, i) => {
    if (names[i] !== undefined && ctx[k] === undefined) ctx[k] = names[i]
  })
  ctx.bodyCount = names.length
}

/** The first face of a describe as { index, centroid, normal, area }. */
const saveFace = (key) => (json, ctx) => {
  const f = facesOf(json)[0]
  if (f) ctx[key] = { index: f.index, centroid: f.centroid, normal: f.normal, area: f.area }
}

const checkSound = (json) => {
  if (!json || typeof json !== 'object') return 'no JSON answer from reverse_body_check'
  const rows = Array.isArray(json.bodies) ? json.bodies : [json]
  const bad = rows.filter((b) => b && (b.valid === false || b.closed === false))
  return bad.length ? `body check reports invalid/open: ${bad.map((b) => b.name ?? b.body ?? '?').join(', ')}` : null
}

const verifyOk = (json) => {
  const v = json?.verify ?? json?.status?.verify
  if (!v) return 'export answered without verify — the read-back was not reported'
  return v.ok === false ? `STEP read-back not ok: ${stringify(v.problems).slice(0, 200)}` : null
}

const BIN = { x: 2, y: 1, units: 3, magnets: true, floor: 5 }

/** @param {{ repo: string, files: string, stamp: string, scan?: string }} env */
export function scenarios(env) {
  const fx = (name) => join(env.repo, 'mcp', 'tests', name)
  const out = (name) => join(env.files, name)
  const common = (guides) => [
    { id: 'status', tool: 'scanruler_status', args: {}, why: 'The session, backend and jobs — the guides say first.' },
    { id: 'state', tool: 'session_state', args: {}, why: 'What the session holds, notes included.' },
    ...guides.map((topic, i) => ({ id: `guide${i + 1}`, tool: 'guide_read', args: { topic }, probe: true, why: `Read the guide(s) ${[].concat(topic).join(', ')} — bytes the agent must take in.` })),
  ]

  // ---- A. Build ------------------------------------------------------------------------
  const A = {
    id: 'A',
    title: 'Build: Gridfinity bin → encased magnet → check → strength → mass → pauses → export',
    steps: [
      ...common([['gen', 'hw'], ['dfm-fdm', 'fea', 'mass']]),
      { id: 'gen_list', tool: 'gen_list', args: {}, why: 'Generators and parameters.' },
      { id: 'gen_measure', tool: 'gen_measure', args: { generator: 'gridfinity_bin', params: BIN }, why: 'Size and volume before making.' },
      {
        id: 'gen_make',
        tool: 'gen_make',
        args: { generator: 'gridfinity_bin', params: BIN, name: 'WC Bin' },
        why: 'The bin into Reverse Engineer as a body.',
        fallback: { id: 'import_bin', tool: 'reverse_import_step', args: { path: fx('fea-gridbin.step') }, why: 'Headless stand-in: the gridbin STEP fixture (a gen-made 2x1x3 bin).' },
      },
      { id: 'bodies', tool: 'reverse_body_describe', args: { edges: false, limit: 1 }, save: saveBodies(['body']), why: 'The body’s name.' },
      { id: 'describe_full', tool: 'reverse_body_describe', needs: ['body'], args: (c) => ({ body: c.body }), probe: true, why: 'Unfiltered describe — what an agent reading the guide’s step 1 literally pays.' },
      { id: 'floor', tool: 'reverse_body_describe', needs: ['body'], args: (c) => ({ body: c.body, edges: false, where: facing([0, 0, 1]), sort: 'largest', limit: 1 }), save: saveFace('floor'), why: 'The largest up-facing flat face (the bin floor) to drill into.' },
      { id: 'hw_set', tool: 'hw_set', args: { layerHeight: 0.2, firstLayer: 0.2 }, why: 'The slicer’s layers, for the pause.' },
      {
        id: 'hw_embed',
        tool: 'hw_embed',
        needs: ['body', 'floor'],
        args: (c) => ({ kind: 'magnet', size: '6x2', at: { body: c.body, face: c.floor.index }, what: '6x2 magnet' }),
        save: (j, c) => {
          c.embedPlanned = true
        },
        why: 'Plan an encased magnet pocket under a roof.',
      },
      { id: 'hw_apply', tool: 'hw_apply', args: {}, save: (j, c) => (c.embedded = Boolean(c.embedPlanned)), why: 'Cut it (E1).' },
      {
        id: 'check',
        tool: 'reverse_body_check',
        needs: ['body'],
        args: (c) => ({ body: c.body }),
        expect: (j, c) => checkSound(j) ?? (c.embedded && !/void/i.test(stringify(j)) ? 'an encased pocket was cut but the check names no void' : null),
        why: 'Valid, closed, the sealed pocket reported as a void.',
      },
      { id: 'dfm_settings', tool: 'dfm_settings', needs: ['body'], args: (c) => ({ target: 'body', body: c.body }), why: 'Check the body as it is: no STL round trip, no stale copy.' },
      {
        id: 'dfm_check',
        tool: 'dfm_check',
        args: {},
        flags: (j, c) => (c.embedded && /trapped-volume/.test(stringify(j)) ? ['the encased magnet pocket is flagged trapped-volume: dfm does not know hw recorded it (needs a waive)'] : []),
        why: 'FDM rules.',
      },
      { id: 'fea_tools', tool: 'fea_tools', args: {}, why: 'Gmsh and CalculiX found? (server extra, SCANRULER_MCP_EXTRAS=fea)' },
      { id: 'fea_setup', tool: 'fea_setup', needs: ['body'], args: (c) => ({ body: c.body, build: '+z', material: 'pla' }), why: 'Study: body, build direction, material.' },
      { id: 'fea_hold', tool: 'fea_hold', args: { where: facing([0, 0, -1]) }, why: 'Hold the underside.' },
      { id: 'fea_load', tool: 'fea_load', args: { where: facing([0, 0, 1]), force: [0, 0, -50] }, why: '50 N down on the up-facing faces.' },
      { id: 'fea_solve', tool: 'fea_solve', args: {}, why: 'Safety factor and mode.' },
      { id: 'mass_setup', tool: 'mass_setup', args: { material: 'pla', infill: 15, walls: 2, lineMm: 0.42 }, why: 'Print settings for weighing.' },
      {
        id: 'mass_properties',
        tool: 'mass_properties',
        needs: ['body'],
        args: (c) => ({ bodies: [c.body] }),
        flags: (j, c) => (c.embedded && !/magnet|encased|embed/i.test(stringify(j)) ? ['mass answers without the encased magnet: the printed mass is short by the magnet (silent)'] : []),
        why: 'Mass and centre of mass.',
      },
      {
        id: 'hw_pauses',
        tool: 'hw_pauses',
        args: { layerHeight: 0.2, firstLayer: 0.2 },
        expect: (j, c) => (c.embedded && !(Array.isArray(j?.pauses) ? j.pauses.length : /layer/i.test(stringify(j))) ? 'a magnet was encased but no pause came back' : null),
        why: 'The layer to pause at, for slicer_slice { pauses }.',
      },
      { id: 'export_step', tool: 'reverse_export_step', needs: ['body'], args: (c) => ({ bodies: [c.body], verify: true, path: out('A-bin.step') }), expect: verifyOk, why: 'STEP, read back.' },
    ],
  }

  // ---- B. Modify -----------------------------------------------------------------------
  const B = {
    id: 'B',
    title: 'Modify: import STEP → insert boss + hole → clearance vs another body → re-check → export',
    steps: [
      ...common(['model', 'hw']),
      { id: 'import_part', tool: 'reverse_import_step', args: { path: fx('fea-plate.step') }, why: 'The part to modify.' },
      { id: 'import_other', tool: 'reverse_import_step', args: { path: fx('fea-beam.step') }, why: 'The mating body.' },
      { id: 'bodies', tool: 'reverse_body_describe', args: { edges: false, limit: 1 }, save: saveBodies(['part', 'other']), why: 'Body names, in import order.' },
      { id: 'top', tool: 'reverse_body_describe', needs: ['part'], args: (c) => ({ body: c.part, edges: false, where: facing([0, 0, 1]), sort: 'largest', limit: 1 }), save: saveFace('top'), why: 'Top face to put the boss on.' },
      { id: 'top_any', tool: 'reverse_body_describe', needs: ['part'], when: (c) => !c.top, args: (c) => ({ body: c.part, edges: false, where: { kind: 'plane' }, sort: 'largest', limit: 1 }), save: saveFace('top'), why: 'No +Z face: the largest flat face instead.' },
      {
        id: 'boss',
        tool: 'scanruler_batch',
        needs: ['part', 'top'],
        args: (c) => ({
          calls: [add(sketchCircle('WC boss sketch', c.top.centroid[2], [c.top.centroid[0], c.top.centroid[1]], 4)), add(extrude('WC boss', 'WC boss sketch', 0, 5, 'join', c.part))],
        }),
        expect: (j) => (Array.isArray(j?.results) && j.results.some((r) => r.ok === false) ? `batch entry refused: ${stringify(j.failed ?? j.results.find((r) => !r.ok)).slice(0, 300)}` : null),
        why: 'The boss: sketch + join extrude in one batch.',
      },
      {
        id: 'hw_plan',
        tool: 'hw_plan',
        needs: ['part', 'top'],
        args: (c) => ({ kind: 'insert', size: 'M3', at: { body: c.part, point: [c.top.centroid[0], c.top.centroid[1], c.top.centroid[2] + 5], direction: [0, 0, -1] } }),
        why: 'Heat-set insert hole down the boss.',
        fallback: {
          id: 'hole_by_hand',
          tool: 'scanruler_batch',
          needs: ['part', 'top'],
          args: (c) => ({ calls: [add(sketchCircle('WC hole sketch', c.top.centroid[2] + 5, [c.top.centroid[0], c.top.centroid[1]], 2.0)), add(extrude('WC hole', 'WC hole sketch', -6, 0.5, 'cut', c.part))] }),
          why: 'Headless stand-in: an Ø4.0 × 6 hole cut by hand (the insert table’s figure, typed in — no hw sizing).',
        },
      },
      { id: 'hw_apply', tool: 'hw_apply', args: {}, why: 'Cut the planned insert hole.' },
      {
        id: 'clearance',
        tool: 'reverse_body_clearance',
        needs: ['part', 'other'],
        args: (c) => ({ body: c.part, against: [c.other] }),
        flags: (j) => (/overlap/.test(stringify(j)) && /"overlap":\s*[1-9]/.test(stringify(j)) ? ['the bodies overlap (interference)'] : []),
        why: 'Gap or overlap against the mating body.',
      },
      { id: 'check', tool: 'reverse_body_check', needs: ['part'], args: (c) => ({ body: c.part }), expect: checkSound, why: 'Re-check after the change.' },
      { id: 'export_step', tool: 'reverse_export_step', needs: ['part'], args: (c) => ({ bodies: [c.part], verify: true, path: out('B-part.step') }), expect: verifyOk, why: 'STEP, read back.' },
    ],
  }

  // ---- C. Reverse-engineer --------------------------------------------------------------
  const C = {
    id: 'C',
    title: 'Reverse-engineer: scan → QA/scale → align → fit → build → deviation to target → STEP',
    steps: [
      { id: 'status', tool: 'scanruler_status', args: {}, why: 'Session and backend.' },
      { id: 'guide_model', tool: 'guide_read', args: { topic: ['model', 'scan-to-cad'] }, probe: true, why: 'The model guide (scan-to-cad named in next).' },
      { id: 'guide_s2c', tool: 'guide_read', args: { topic: 'scan-to-cad' }, probe: true, why: 'The scan-to-cad guide’s first read.' },
      { id: 'guide_ref', tool: 'guide_read', args: { topic: 'model-reference', section: 'Reply cost' }, probe: true, why: 'One reference section, as the guides send the agent.' },
      // Without a scan given, the "scan" is a CAD STL of a fixture, made here.
      { id: 'src_import', tool: 'reverse_import_step', when: (c) => !c.scan, args: { path: fx('fea-slit.step') }, why: 'No scan given: make one from the slit fixture.' },
      { id: 'src_box', tool: 'reverse_body_describe', when: (c) => !c.scan, args: { edges: false }, save: (j, c) => {
        const cs = facesOf(j).map((f) => f.centroid).filter(Array.isArray)
        if (cs.length) c.box = { min: [0, 1, 2].map((i) => Math.min(...cs.map((p) => p[i]))), max: [0, 1, 2].map((i) => Math.max(...cs.map((p) => p[i]))) }
      }, why: 'Its extent, for the stand-in build.' },
      { id: 'src_stl', tool: 'reverse_export_stl', when: (c) => !c.scan, args: { path: out('C-scan.stl') }, save: (j, c) => (c.scan = out('C-scan.stl')), why: 'Write it as the scan.' },
      { id: 'src_clear', tool: 'reverse_feature_clear', when: (c) => c.scan === out('C-scan.stl'), args: {}, why: 'Start the model empty.' },
      { id: 'scan_open', tool: 'scan_open', needs: ['scan'], args: (c) => ({ path: c.scan, discard: true }), why: 'Open the scan.' },
      { id: 'scan_qa', tool: 'scan_qa', args: {}, why: 'Rims, noise, tessellation, size warning.' },
      { id: 'align_auto', tool: 'align_auto', args: {}, why: 'Coarse pose.' },
      { id: 'symmetry', tool: 'element_construct', args: { kind: 'plane', method: 'plane-symmetry', seed: 'YZ', name: 'WC mirror' }, why: 'Mirror plane, asymmetry rms.' },
      { id: 'plan', tool: 'reverse_plan_set', args: { archetype: 'plate', regions: [{ name: 'body', at: [0, 0, 0] }], target: { withinT: 90, tolerance: 0.1 } }, why: 'The plan and its target.' },
      { id: 'fit_plane', tool: 'element_fit', args: { kind: 'plane', at: { point: [0, 0, 0] }, name: 'WC top' }, why: 'A datum fit.' },
      { id: 'section', tool: 'section_cut', args: { across: 'XY', offset: 1, name: 'WC S1' }, why: 'A section to fit a sketch on.' },
      {
        id: 'build',
        tool: 'scanruler_batch',
        args: (c) => {
          const b = c.box ?? { min: [-10, -10, 0], max: [10, 10, 5] }
          const w = Math.max(1, b.max[0] - b.min[0])
          const d = Math.max(1, b.max[1] - b.min[1])
          const h = Math.max(1, b.max[2] - b.min[2])
          const cx = (b.max[0] + b.min[0]) / 2
          const cy = (b.max[1] + b.min[1]) / 2
          return {
            calls: [
              add({ kind: 'sketch', name: 'WC block sketch', plane: { kind: 'world', axis: 'z', offset: b.min[2] }, sketch: { shapes: [{ kind: 'rectangle', center: [cx, cy], size: [w, d] }] } }),
              add(extrude('WC block', 'WC block sketch', 0, h, 'new')),
            ],
          }
        },
        why: 'A first feature group (stand-in: the block of its extent).',
      },
      { id: 'review', tool: 'reverse_body_review', args: { tolerance: 0.1, picture: false }, why: 'The design loop’s read: score, volume, places, verdict.' },
      { id: 'volume', tool: 'reverse_body_volume_compare', args: { tolerance: 0.1 }, why: 'Volume error alone.' },
      { id: 'final_dev', tool: 'reverse_body_compare_in_deviation', args: { tolerance: 0.1, range: 0.3 }, why: 'The final both-sides compare.' },
      { id: 'export_step', tool: 'reverse_export_step', args: { verify: true, path: out('C-model.step') }, expect: verifyOk, why: 'STEP, read back.' },
    ],
  }

  // ---- D. Electronics ------------------------------------------------------------------
  const D = {
    id: 'D',
    title: 'Electronics: tscircuit board → import → enclosure → clearances',
    steps: [
      ...common([['circuit', 'pcb'], 'gen']),
      { id: 'circuit_tools', tool: 'circuit_tools', args: {}, why: 'tsci there? (server extra, SCANRULER_MCP_EXTRAS=circuit)' },
      { id: 'circuit_new', tool: 'circuit_new', args: { name: `wc-led-${env.stamp}`, template: 'led' }, save: (j, c) => (c.project = j?.project), why: 'A project from the led template.' },
      {
        id: 'circuit_build',
        tool: 'circuit_build',
        needs: ['project'],
        args: (c) => ({ project: c.project, outputs: ['kicad_pcb', 'step'] }),
        save: (j, c) => {
          c.boardPcb = deepFind(j?.files ?? j, (s) => /\.kicad_pcb$/i.test(s) && /[\\/]/.test(s)) ?? undefined
          c.boardStep = deepFind(j?.files ?? j, (s) => /\.(step|stp)$/i.test(s) && /[\\/]/.test(s)) ?? undefined
        },
        flags: (j) => (j?.summary?.errorCount ? [`tsci build reported ${j.summary.errorCount} errors (ok: ${j.ok})`] : []),
        why: 'tsci build + export kicad_pcb and step.',
      },
      { id: 'circuit_stats', tool: 'circuit_stats', args: {}, why: 'Trace width, clearance between nets.' },
      {
        id: 'kicad_board',
        tool: 'kicad_board',
        args: (c) => ({ path: c.boardPcb ?? fx('fixtures/tiny.kicad_pcb') }),
        save: (j, c) => {
          if (Array.isArray(j?.outline)) c.board = { outline: j.outline, thickness: j.thickness ?? 1.6, above: 12, below: 3, holes: (j.holes ?? []).map((h) => ({ x: h.x, y: h.y, d: h.d })), openings: [] }
          c.boardPath = c.boardPcb ?? fx('fixtures/tiny.kicad_pcb')
        },
        why: 'Read the board without KiCad (server extra, SCANRULER_MCP_EXTRAS=pcb).',
      },
      { id: 'pcb_open', tool: 'pcb_open', needs: ['boardPath'], args: (c) => ({ path: c.boardPath }), why: 'Electronics › KiCad reads it.' },
      { id: 'pcb_import', tool: 'pcb_import', args: {}, why: 'Board + parts as bodies, heights measured.' },
      { id: 'pcb_plan', tool: 'pcb_plan', args: {}, why: 'Standoffs and openings.' },
      { id: 'pcb_enclosure', tool: 'pcb_enclosure', args: {}, why: 'The box round it (gen board_box).' },
      { id: 'board_step', tool: 'reverse_import_step', when: (c) => Boolean(c.boardStep), args: (c) => ({ path: c.boardStep }), why: 'Headless route: the board’s STEP from tsci.' },
      { id: 'gen_board_box', tool: 'gen_make', needs: ['board'], args: (c) => ({ generator: 'board_box', board: c.board, name: 'WC enclosure' }), why: 'The enclosure from the board read (when pcb_enclosure is not run).' },
      { id: 'bodies', tool: 'reverse_body_describe', args: { edges: false, limit: 1 }, save: saveBodies(['first', 'second']), why: 'Bodies now.' },
      { id: 'clearance', tool: 'reverse_body_clearance', needs: ['first'], args: (c) => ({ body: c.first }), why: 'Board and parts against the enclosure.' },
      { id: 'check', tool: 'reverse_body_check', args: {}, expect: checkSound, why: 'Every solid sound.' },
      { id: 'export_step', tool: 'reverse_export_step', args: { verify: true, path: out('D-enclosure.step') }, expect: verifyOk, why: 'STEP, read back.' },
    ],
  }

  return { A, B, C, D }
}
