// SPDX-License-Identifier: AGPL-3.0-only
// import-plus driven by an agent, end to end: an MCP client starts
// scanruler-mcp (with blender_convert switched on, and a stand-in Blender),
// the app in headless Chrome is paired with it, and the same 30 × 20 × 10 mm
// block is opened from a GLB (metres, Y up, with a floor part beside it),
// a .blend (through blender_convert), an FBX (centimetres, Y up), a 3DS
// (millimetres), a Collada file (millimetres, Z up, said in the file), an
// AMF and a VRML file (metres, Y up) — and must come out 30 × 20 × 10 mm,
// Z up, every time. A unit taken wrong must be flagged; a part must be
// picked out; the block must open as the reference part too.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/import-plus/scripts/e2e-agent-import.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const dir = mkdtempSync(join(tmpdir(), 'scanruler-import-'))

// ---- the block, in each format's own units and axes -----------------------------------------
// Z up, mm: X 0–30, Y 0–20, Z 0–10.
const corners = (sx, sy, sz) => [[0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0], [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz]]
const QUADS = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
const TRIS = QUADS.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
// Y up: the same block with its height along Y — (x, y, z) Z-up is (x, z, -y) Y-up.
const yUp = (pts) => pts.map(([x, y, z]) => [x, z, -y])
const zUp = corners(30, 20, 10)

function glb(parts) {
  const bins = []
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: parts.map((_, i) => i) }], nodes: [], meshes: [], buffers: [], bufferViews: [], accessors: [] }
  let offset = 0
  parts.forEach(({ name, pts, tris }, i) => {
    const pos = new Float32Array(pts.flat())
    const idx = new Uint16Array(tris.flat())
    const posBytes = Buffer.from(pos.buffer), idxBytes = Buffer.from(idx.buffer)
    const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)])
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: posBytes.length })
    bins.push(pad(posBytes))
    offset += pad(posBytes).length
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: idxBytes.length })
    bins.push(pad(idxBytes))
    offset += pad(idxBytes).length
    const min = [0, 1, 2].map((a) => Math.min(...pts.map((p) => p[a]))), max = [0, 1, 2].map((a) => Math.max(...pts.map((p) => p[a])))
    json.accessors.push({ bufferView: 2 * i, componentType: 5126, count: pts.length, type: 'VEC3', min, max })
    json.accessors.push({ bufferView: 2 * i + 1, componentType: 5123, count: idx.length, type: 'SCALAR' })
    json.meshes.push({ primitives: [{ attributes: { POSITION: 2 * i }, indices: 2 * i + 1 }] })
    json.nodes.push({ name, mesh: i })
  })
  const bin = Buffer.concat(bins)
  json.buffers.push({ byteLength: bin.length })
  let jsonBytes = Buffer.from(JSON.stringify(json))
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(12)
  header.write('glTF', 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8)
  const chunk = (type, data) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(data.length, 0)
    h.write(type, 4)
    return Buffer.concat([h, data])
  }
  return Buffer.concat([header, chunk('JSON', jsonBytes), chunk('BIN\0', bin)])
}

const metresYUp = yUp(zUp).map((p) => p.map((v) => v / 1000))
const floor = [[-0.05, -0.001, -0.05], [0.08, -0.001, -0.05], [0.08, -0.001, 0.05], [-0.05, -0.001, 0.05]]
const GLB = join(dir, 'block.glb')
writeFileSync(GLB, glb([{ name: 'Block', pts: metresYUp, tris: TRIS }, { name: 'Floor', pts: floor, tris: [[0, 2, 1], [0, 3, 2]] }]))

function fbx() {
  const pts = yUp(zUp).map((p) => p.map((v) => v / 10))
  const poly = TRIS.flatMap(([a, b, c]) => [a, b, -c - 1])
  return [
    '; FBX 7.4.0 project file',
    'FBXHeaderExtension:  {',
    '\tFBXHeaderVersion: 1003',
    '\tFBXVersion: 7400',
    '}',
    'GlobalSettings:  {',
    '\tVersion: 1000',
    '\tProperties70:  {',
    '\t\tP: "UpAxis", "int", "Integer", "",1',
    '\t\tP: "UnitScaleFactor", "double", "Number", "",1',
    '\t}',
    '}',
    'Objects:  {',
    '\tGeometry: 1000, "Geometry::Block", "Mesh" {',
    `\t\tVertices: *${pts.length * 3} {`,
    `\t\t\ta: ${pts.flat().join(',')}`,
    '\t\t} ',
    `\t\tPolygonVertexIndex: *${poly.length} {`,
    `\t\t\ta: ${poly.join(',')}`,
    '\t\t} ',
    '\t\tGeometryVersion: 124',
    '\t}',
    '\tModel: 2000, "Model::Block", "Mesh" {',
    '\t\tVersion: 232',
    '\t\tProperties70:  {',
    '\t\t}',
    '\t}',
    '}',
    'Connections:  {',
    '\tC: "OO",1000,2000',
    '\tC: "OO",2000,0',
    '}',
    '',
  ].join('\n')
}
const FBX = join(dir, 'block.fbx')
writeFileSync(FBX, fbx())

function tds() {
  const chunk = (id, body) => {
    const h = Buffer.alloc(6)
    h.writeUInt16LE(id, 0)
    h.writeUInt32LE(6 + body.length, 2)
    return Buffer.concat([h, body])
  }
  const verts = Buffer.alloc(2 + 12 * zUp.length)
  verts.writeUInt16LE(zUp.length, 0)
  zUp.forEach((p, i) => p.forEach((v, a) => verts.writeFloatLE(v, 2 + 12 * i + 4 * a)))
  const faces = Buffer.alloc(2 + 8 * TRIS.length)
  faces.writeUInt16LE(TRIS.length, 0)
  TRIS.forEach((t, i) => {
    t.forEach((v, a) => faces.writeUInt16LE(v, 2 + 8 * i + 2 * a))
    faces.writeUInt16LE(0, 2 + 8 * i + 6)
  })
  const mesh = chunk(0x4100, Buffer.concat([chunk(0x4110, verts), chunk(0x4120, faces)]))
  const object = chunk(0x4000, Buffer.concat([Buffer.from('Block\0'), mesh]))
  const version = Buffer.alloc(4)
  version.writeUInt32LE(3, 0)
  return chunk(0x4d4d, Buffer.concat([chunk(0x0002, version), chunk(0x3d3d, object)]))
}
const TDS = join(dir, 'block.3ds')
writeFileSync(TDS, tds())

const DAE = join(dir, 'block.dae')
writeFileSync(
  DAE,
  `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="millimeter" meter="0.001"/><up_axis>Z_UP</up_axis></asset>
  <library_geometries><geometry id="block" name="Block"><mesh>
    <source id="block-pos"><float_array id="block-pos-array" count="${zUp.length * 3}">${zUp.flat().join(' ')}</float_array>
      <technique_common><accessor source="#block-pos-array" count="${zUp.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="block-vtx"><input semantic="POSITION" source="#block-pos"/></vertices>
    <triangles count="${TRIS.length}"><input semantic="VERTEX" source="#block-vtx" offset="0"/><p>${TRIS.flat().join(' ')}</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="scene"><node id="Block" name="Block"><instance_geometry url="#block"/></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`,
)

const AMF = join(dir, 'block.amf')
writeFileSync(
  AMF,
  `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter"><object id="0"><mesh><vertices>${zUp.map(([x, y, z]) => `<vertex><coordinates><x>${x}</x><y>${y}</y><z>${z}</z></coordinates></vertex>`).join('')}</vertices>
<volume>${TRIS.map(([a, b, c]) => `<triangle><v1>${a}</v1><v2>${b}</v2><v3>${c}</v3></triangle>`).join('')}</volume></mesh></object></amf>
`,
)

const WRL = join(dir, 'block.wrl')
writeFileSync(
  WRL,
  `#VRML V2.0 utf8
Shape { geometry IndexedFaceSet { coord Coordinate { point [ ${metresYUp.map((p) => p.join(' ')).join(', ')} ] } coordIndex [ ${TRIS.map((t) => `${t.join(', ')}, -1`).join(', ')} ] } }
`,
)

// A stand-in Blender: checks it is started safely, then writes the GLB.
const BLEND = join(dir, 'block.blend')
writeFileSync(BLEND, 'BLENDER-v400 stand-in')
const FAKE = join(dir, 'blender')
writeFileSync(
  FAKE,
  [
    '#!/usr/bin/env node',
    "const fs = require('fs')",
    'const args = process.argv.slice(2)',
    "if (!args.includes('--disable-autoexec') || !args.includes('--background')) process.exit(3)",
    `fs.copyFileSync(${JSON.stringify(GLB)}, process.env.SCANRULER_GLB_OUT)`,
  ].join('\n'),
)
chmodSync(FAKE, 0o755)
process.env.SCANRULER_MCP_BLENDER = FAKE

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const sized = (s, want = [30, 20, 10]) => Array.isArray(s) && s.every((v, i) => Math.abs(v - want[i]) < 1e-3)

const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('import-plus'), `the page connected with import-plus (${waited.json?.page?.plugins})`)
  const tools = (await agent.client.listTools()).tools
  const names = tools.map((t) => t.name)
  check(['import_formats', 'import_inspect', 'import_open', 'blender_convert'].every((n) => names.includes(n)), 'import_formats, import_inspect, import_open and blender_convert are listed')
  const guide = await ok('guide_read', { topic: 'import-plus' })
  check(/blender_convert/.test(guide.text) && /unitsWarning/.test(guide.text), 'guide_read serves the import-plus guide')
  const fmts = await ok('import_formats', {})
  check(fmts.json?.formats?.length === 7, `import_formats: ${fmts.json?.formats?.map((f) => f.format).join(', ')}`)

  // ---- GLB: parts, units, the block picked out -------------------------------------------------
  const ins = await ok('import_inspect', { path: GLB })
  check(ins.json?.parts?.map((p) => p.name).join() === 'Block,Floor' && ins.json.units === 'm', `import_inspect GLB: parts ${ins.json?.parts?.map((p) => `${p.name} (${p.triangles})`).join(', ')}, ${ins.json?.units}`)
  const wrong = await ok('import_inspect', { path: GLB, units: 'mm', parts: undefined })
  check(Boolean(wrong.json?.unitsWarning), `units taken wrong are flagged: ${wrong.json?.unitsWarning}`)
  const g = await ok('import_open', { path: GLB, parts: ['Block'], discard: true })
  check(sized(g.json?.read?.sizeMm) && g.json.scan?.triangles === 12, `GLB opened as the scan: ${g.json?.read?.sizeMm} mm, ${g.json?.scan?.triangles} triangles, ${g.json?.read?.up}`)

  // ---- a .blend through Blender ----------------------------------------------------------------
  const conv = await ok('blender_convert', { path: BLEND })
  check(Boolean(conv.json?.path) && existsSync(conv.json.path), `blender_convert wrote ${conv.json?.path}`)
  const b = await ok('import_open', { path: conv.json.path, parts: ['Block'], discard: true })
  check(sized(b.json?.read?.sizeMm), `the converted .blend opens: ${b.json?.read?.sizeMm} mm`)

  // ---- every other format ----------------------------------------------------------------------
  for (const [label, path] of [['FBX', FBX], ['3DS', TDS], ['Collada', DAE], ['AMF', AMF], ['VRML', WRL]]) {
    const r = await call('import_open', { path, discard: true })
    check(!r.error && sized(r.json?.read?.sizeMm) && r.json.read.min.every((v) => Math.abs(v) < 20.001), `${label}: ${r.error ? r.text : `${r.json?.read?.sizeMm} mm, ${r.json?.read?.units}, ${r.json?.read?.up}`}`)
  }

  // ---- as the reference part -------------------------------------------------------------------
  await ok('import_open', { path: TDS, discard: true })
  const ref = await ok('import_open', { path: GLB, as: 'reference', parts: ['Block'] })
  check(ref.json?.openedAs === 'reference' && Boolean(ref.json.deviation), 'the GLB opens as the reference part beside the scan')
  const state = await ok('session_state', {})
  check(state.json?.plugins?.import?.last?.as === 'reference', `session_state carries what was imported: ${JSON.stringify(state.json?.plugins?.import?.last)}`)
  // ---- dropped on the page --------------------------------------------------------------------
  const tdsBytes = [...readFileSync(TDS)]
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'dropped-block.3ds'))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, tdsBytes)
  let dropped = null
  for (let i = 0; i < 40 && !dropped; i++) {
    await new Promise((r) => setTimeout(r, 250))
    const st = await call('session_state', {})
    if (st.json?.plugins?.import?.last?.name === 'dropped-block.3ds') dropped = st.json
  }
  check(dropped?.scan?.fileName === 'dropped-block.stl' || dropped?.plugins?.import?.last?.as === 'scan', `a .3ds dropped on the page opens as the scan (${dropped?.scan?.fileName ?? 'not opened'})`)
  const bad = await call('import_open', { path: join(dir, 'block.blend') })
  check(bad.error && /blender_convert/.test(bad.text), 'a .blend handed straight to import_open points to blender_convert')
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
