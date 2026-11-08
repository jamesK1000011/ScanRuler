// SPDX-License-Identifier: AGPL-3.0-only
// Strength of a printed part, by finite elements, with the tools FreeCAD
// ships: Gmsh meshes the part's STEP into quadratic tetrahedra, CalculiX
// solves it, and this reads the answer back — each run as its own program
// on this computer, nothing linked in. The material is print-aware: as
// stiff and strong in each layer, softer and weaker across them, the
// layers' normal the build direction. Loads and fixtures come as the
// triangles of the CAD faces they act on, matched to the mesh's surface
// here, so no face numbering has to agree between programs. The answer:
// displacement, stress, the stress across the layers, and a safety factor
// from the in-layer (Hill) and the between-layer checks.
//
// The job and the answer are plain JSON (FeaJob, FeaAnswer below), so
// another solver can stand behind the same exchange.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// ---- the programs ---------------------------------------------------------------

const BUNDLES = ['/Applications/FreeCAD.app/Contents/Resources/bin', join(homedir(), 'Applications/FreeCAD.app/Contents/Resources/bin')]
const SYSTEM = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function run(cmd, args, { cwd, env, timeoutMs = 600_000, signal, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let rest = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const stop = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (d) => {
      out += d
      if (out.length > 4e6) out = out.slice(-2e6)
      if (onLine) {
        const lines = (rest + d).split('\n')
        rest = lines.pop()
        for (const l of lines) onLine(l)
      }
    })
    child.stderr.on('data', (d) => {
      err += d
      if (err.length > 1e6) err = err.slice(-5e5)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`${cmd} could not be started: ${e.message}`))
    })
    child.on('close', (code, sig) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      if (signal?.aborted) return reject(Object.assign(new Error('Cancelled.'), { cancelled: true }))
      resolve({ code, signal: sig, out, err })
    })
  })
}

/** The environment a bundled program runs in: a Linux FreeCAD keeps its
 *  libraries beside its programs (usr/lib), which the Mac app finds itself. */
function envFor(path, env) {
  const lib = join(dirname(path), '..', 'lib')
  if (process.platform === 'linux' && existsSync(lib)) return { ...env, LD_LIBRARY_PATH: [lib, env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  return env
}

async function which(name, env) {
  for (const d of String(env.PATH ?? '').split(':').filter(Boolean)) if (existsSync(join(d, name))) return join(d, name)
  return null
}

async function find(name, envKey, env) {
  if (env[envKey]) return existsSync(env[envKey]) ? env[envKey] : null
  for (const d of [...BUNDLES, ...SYSTEM]) if (existsSync(join(d, name))) return join(d, name)
  return which(name, env)
}

/** Where Gmsh and CalculiX are, and their versions: FreeCAD's own copies
 *  first, then Homebrew's, then the PATH; SCANRULER_GMSH and SCANRULER_CCX
 *  name others. */
export async function feaTools(env = process.env) {
  const gmsh = await find('gmsh', 'SCANRULER_GMSH', env)
  const ccx = (await find('ccx', 'SCANRULER_CCX', env)) ?? (await find('ccx_2.22', 'SCANRULER_CCX', env))
  const version = async (path, args, re) => {
    if (!path) return null
    try {
      const r = await run(path, args, { env: envFor(path, env), timeoutMs: 20_000 })
      return (`${r.out}\n${r.err}`.match(re)?.[1] ?? null)
    } catch {
      return null
    }
  }
  const tools = {
    gmsh: gmsh ? { path: gmsh, version: await version(gmsh, ['--version'], /(\d+\.\d+\.\d+)/) } : null,
    ccx: ccx ? { path: ccx, version: await version(ccx, ['-v'], /Version\s+([\d.]+)/i) } : null,
  }
  const missing = [!tools.gmsh && 'Gmsh', !tools.ccx && 'CalculiX'].filter(Boolean)
  return {
    ...tools,
    ready: missing.length === 0,
    ...(missing.length
      ? { howTo: `${missing.join(' and ')} not found. Installing FreeCAD (freecad.org) brings both; or Homebrew: brew install gmsh, and brew tap costerwi/calculix && brew install calculix-ccx. Elsewhere, set SCANRULER_GMSH / SCANRULER_CCX to the programs.` }
      : {}),
  }
}

// ---- materials -------------------------------------------------------------------

/** Printed materials, transversely isotropic about the build direction:
 *  in-layer (xy) and across-layer (z) stiffness and strength, MPa. Tensile
 *  figures from Bambu Lab's datasheets (ISO 527, 100 % infill, X-Y and Z
 *  specimens); compression, shear and Poisson's ratios are typical values,
 *  and the between-layer shear strength an estimate (little is published:
 *  0.6 × the across-layer tensile strength). A start, not a datasheet:
 *  the person's own figures go in overrides. */
export const MATERIALS = {
  pla: { label: 'PLA', Exy: 2680, Ez: 2160, nuXY: 0.35, nuZ: 0.33, Xt: 39, Xc: 60, Zt: 35, Zc: 55, S: 25 },
  petg: { label: 'PETG', Exy: 2000, Ez: 1700, nuXY: 0.38, nuZ: 0.36, Xt: 42, Xc: 55, Zt: 30, Zc: 50, S: 26 },
  abs: { label: 'ABS', Exy: 2000, Ez: 1650, nuXY: 0.35, nuZ: 0.33, Xt: 33, Xc: 50, Zt: 20, Zc: 40, S: 22 },
  asa: { label: 'ASA', Exy: 1950, Ez: 1600, nuXY: 0.35, nuZ: 0.33, Xt: 35, Xc: 50, Zt: 22, Zc: 40, S: 22 },
  'petg-cf': { label: 'PETG-CF', Exy: 2460, Ez: 1340, nuXY: 0.34, nuZ: 0.32, Xt: 35, Xc: 50, Zt: 29, Zc: 45, S: 22 },
  'pa6-cf': { label: 'PA6-CF', Exy: 4430, Ez: 2170, nuXY: 0.33, nuZ: 0.30, Xt: 102, Xc: 90, Zt: 48, Zc: 70, S: 45 },
  'tpu-95a': { label: 'TPU 95A (linear only near small strain)', Exy: 26, Ez: 22, nuXY: 0.45, nuZ: 0.45, Xt: 30, Xc: 30, Zt: 20, Zc: 30, S: 15 },
}

/** A material whole: a preset, with the person's figures over it, and what
 *  follows from them — the shear moduli and the between-layer shear
 *  strength — where not given. */
export function materialOf(id = 'pla', overrides = {}) {
  const base = MATERIALS[id]
  if (!base) throw new Error(`No material "${id}" — ${Object.keys(MATERIALS).join(', ')}, with overrides for your own figures.`)
  const m = { id, ...base, ...Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) }
  m.Gxy ??= m.Exy / (2 * (1 + m.nuXY))
  // Across the layers the shear stiffness follows the softer direction.
  m.Gz ??= Math.min(m.Exy, m.Ez) / (2 * (1 + m.nuZ))
  m.Sz ??= 0.6 * m.Zt
  for (const k of ['Exy', 'Ez', 'Gxy', 'Gz', 'Xt', 'Xc', 'Zt', 'Zc', 'S', 'Sz']) if (!(m[k] > 0)) throw new Error(`The material's ${k} must be more than 0 MPa.`)
  // Stable: the compliance matrix positive definite.
  const n21 = m.nuXY, n31 = (m.nuZ * m.Ez) / m.Exy
  if (!(m.nuXY > -1 && m.nuXY < 1) || 1 - n21 * n21 - 2 * m.nuZ * n31 - 2 * n21 * m.nuZ * n31 <= 0) throw new Error("The material's Poisson's ratios make it unstable: keep them nearer 0.3.")
  return m
}

// ---- the mesh ------------------------------------------------------------------

/** Gmsh's mesh file (format 2.2, ASCII): the nodes, and the quadratic
 *  tetrahedra with their mid-side nodes put in CalculiX's order (C3D10:
 *  corners, then edges 1-2, 2-3, 3-1, 1-4, 2-4, 3-4) by where they lie, not
 *  by trusting either program's numbering. */
export function readMsh(text) {
  const lines = text.split(/\r?\n/)
  let i = 0
  const nodes = new Map()
  const tets = []
  while (i < lines.length) {
    const l = lines[i++].trim()
    if (l === '$Nodes') {
      const n = Number(lines[i++])
      for (let k = 0; k < n; k++) {
        const p = lines[i++].trim().split(/\s+/)
        nodes.set(Number(p[0]), [Number(p[1]), Number(p[2]), Number(p[3])])
      }
    } else if (l === '$Elements') {
      const n = Number(lines[i++])
      for (let k = 0; k < n; k++) {
        const p = lines[i++].trim().split(/\s+/).map(Number)
        if (p[1] !== 11) continue
        const tags = p[2]
        tets.push(p.slice(3 + tags, 3 + tags + 10))
      }
    }
  }
  if (!tets.length) throw new Error('Gmsh made no solid elements: is the part one closed solid?')
  // Renumber 1.. in the order used, and order each element's mid-side nodes.
  const id = new Map()
  const xyz = []
  const use = (n) => {
    if (!id.has(n)) {
      const p = nodes.get(n)
      if (!p) throw new Error(`The mesh names node ${n}, which it does not hold.`)
      id.set(n, xyz.length / 3 + 1)
      xyz.push(p[0], p[1], p[2])
    }
    return id.get(n)
  }
  const EDGES = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]]
  const elements = new Int32Array(tets.length * 10)
  tets.forEach((t, e) => {
    const c = t.slice(0, 4).map(use)
    const mids = t.slice(4).map(use)
    const at = (n) => [xyz[(n - 1) * 3], xyz[(n - 1) * 3 + 1], xyz[(n - 1) * 3 + 2]]
    const pc = c.map(at)
    // Volume sign: CalculiX wants corners 1-2-3 seen anticlockwise from 4's side opposite.
    const v = det(sub(pc[1], pc[0]), sub(pc[2], pc[0]), sub(pc[3], pc[0]))
    let order = [0, 1, 2, 3]
    if (v < 0) order = [0, 2, 1, 3]
    const cc = order.map((k) => c[k])
    const pp = order.map((k) => pc[k])
    for (let k = 0; k < 4; k++) elements[e * 10 + k] = cc[k]
    const left = [...mids]
    EDGES.forEach(([a, b], k) => {
      const m = mid(pp[a], pp[b])
      let best = 0
      let d = Infinity
      left.forEach((n, j) => {
        const q = at(n)
        const dd = (q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2 + (q[2] - m[2]) ** 2
        if (dd < d) {
          d = dd
          best = j
        }
      })
      elements[e * 10 + 4 + k] = left.splice(best, 1)[0]
    })
  })
  return { xyz: Float64Array.from(xyz), elements }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const det = (a, b, c) => dot(a, cross(b, c))
const norm = (a) => Math.hypot(a[0], a[1], a[2])
const unit = (a) => {
  const l = norm(a)
  if (!(l > 0)) throw new Error('A direction must not be zero.')
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** The tetrahedra's faces on the outside: each a face of one element only,
 *  with its six nodes (corners, then mid-sides 1-2, 2-3, 3-1), outward
 *  normal, area and centre. */
export function surfaceOf(mesh) {
  const { xyz, elements } = mesh
  // C3D10 faces as corner and mid-side local indices, wound outward.
  const FACES = [
    [0, 2, 1, 6, 5, 4],
    [0, 1, 3, 4, 8, 7],
    [1, 2, 3, 5, 9, 8],
    [2, 0, 3, 6, 7, 9],
  ]
  const seen = new Map()
  const n = elements.length / 10
  for (let e = 0; e < n; e++)
    for (const f of FACES) {
      const k = [elements[e * 10 + f[0]], elements[e * 10 + f[1]], elements[e * 10 + f[2]]].sort((a, b) => a - b).join(',')
      if (seen.has(k)) seen.set(k, null)
      else seen.set(k, f.map((j) => elements[e * 10 + j]))
    }
  const at = (n) => [xyz[(n - 1) * 3], xyz[(n - 1) * 3 + 1], xyz[(n - 1) * 3 + 2]]
  const faces = []
  for (const nodes of seen.values()) {
    if (!nodes) continue
    const [a, b, c] = nodes.slice(0, 3).map(at)
    const cr = cross(sub(b, a), sub(c, a))
    const area = norm(cr) / 2
    if (!(area > 0)) continue
    // The centre on the curved face: the quadratic triangle at its middle
    // (corners −1/9 each, mid-sides 4/9) — on a hole's wall, not inside it
    // as the flat triangle's centre would be.
    const m = nodes.slice(3).map(at)
    const centre = [0, 1, 2].map((k) => (-(a[k] + b[k] + c[k]) + 4 * (m[0][k] + m[1][k] + m[2][k])) / 9)
    faces.push({ nodes, normal: [cr[0] / (2 * area), cr[1] / (2 * area), cr[2] / (2 * area)], area, centre })
  }
  return faces
}

/** Squared distance from point q to triangle t (nine numbers at t*9). */
function toTriangle(p, t, q) {
  const o = t * 9
  const a = [p[o], p[o + 1], p[o + 2]], b = [p[o + 3], p[o + 4], p[o + 5]], c = [p[o + 6], p[o + 7], p[o + 8]]
  const ab = sub(b, a), ac = sub(c, a), ap = sub(q, a)
  const d1 = dot(ab, ap), d2 = dot(ac, ap)
  const at = (u, v) => {
    const x = a[0] + ab[0] * u + ac[0] * v - q[0], y = a[1] + ab[1] * u + ac[1] * v - q[1], z = a[2] + ab[2] * u + ac[2] * v - q[2]
    return x * x + y * y + z * z
  }
  if (d1 <= 0 && d2 <= 0) return at(0, 0)
  const bp = sub(q, b)
  const d3 = dot(ab, bp), d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return at(1, 0)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0)
  const cp = sub(q, c)
  const d5 = dot(ab, cp), d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return at(0, 1)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6))
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return at(1 - w, w)
  }
  const den = 1 / (va + vb + vc)
  return at(vb * den, vc * den)
}

/** The surface faces that lie on a group's CAD triangles: centre within
 *  tol of one, facing within 30° of it either way (a CAD mesh's winding is
 *  not trusted). */
export function facesOn(surface, tris, tol) {
  const n = tris.length / 9
  if (!n) return []
  const nrm = []
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let t = 0; t < n; t++) {
    const o = t * 9
    const c = cross([tris[o + 3] - tris[o], tris[o + 4] - tris[o + 1], tris[o + 5] - tris[o + 2]], [tris[o + 6] - tris[o], tris[o + 7] - tris[o + 1], tris[o + 8] - tris[o + 2]])
    const l = norm(c) || 1
    nrm.push([c[0] / l, c[1] / l, c[2] / l])
    for (let k = 0; k < 9; k++) {
      lo[k % 3] = Math.min(lo[k % 3], tris[o + k])
      hi[k % 3] = Math.max(hi[k % 3], tris[o + k])
    }
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  const cell = Math.max(tol * 2, diag / 64, 1e-3)
  const dims = [0, 1, 2].map((a) => Math.max(1, Math.ceil((hi[a] - lo[a] + 2 * tol) / cell)))
  const base = lo.map((x) => x - tol)
  const cellOf = (x, a) => Math.min(dims[a] - 1, Math.max(0, Math.floor((x - base[a]) / cell)))
  const grid = new Map()
  for (let t = 0; t < n; t++) {
    const o = t * 9
    const b0 = [0, 1, 2].map((a) => cellOf(Math.min(tris[o + a], tris[o + 3 + a], tris[o + 6 + a]) - tol, a))
    const b1 = [0, 1, 2].map((a) => cellOf(Math.max(tris[o + a], tris[o + 3 + a], tris[o + 6 + a]) + tol, a))
    for (let i = b0[0]; i <= b1[0]; i++)
      for (let j = b0[1]; j <= b1[1]; j++)
        for (let k = b0[2]; k <= b1[2]; k++) {
          const key = (i * dims[1] + j) * dims[2] + k
          const list = grid.get(key)
          if (list) list.push(t)
          else grid.set(key, [t])
        }
  }
  const cos = Math.cos(Math.PI / 6)
  const tol2 = tol * tol
  const out = []
  surface.forEach((f, idx) => {
    const q = f.centre
    if (q.some((x, a) => x < base[a] || x > hi[a] + tol)) return
    const list = grid.get((cellOf(q[0], 0) * dims[1] + cellOf(q[1], 1)) * dims[2] + cellOf(q[2], 2))
    if (!list) return
    for (const t of list) {
      if (Math.abs(dot(f.normal, nrm[t])) < cos) continue
      if (toTriangle(tris, t, q) > tol2) continue
      out.push(idx)
      return
    }
  })
  return out
}

// ---- CalculiX's input ------------------------------------------------------------

const f = (x) => (Math.abs(x) < 1e-300 ? '0' : x.toPrecision(10))

/** A plane through the build direction's normal: the material's axes, with
 *  3 the build direction — the layers' normal. */
export function layerAxes(build) {
  const z = unit(build)
  const t = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const x = unit(cross(cross(z, t), z))
  const y = cross(z, x)
  return { x, y, z }
}

/** The job as CalculiX's input: nodes, quadratic tetrahedra, the material
 *  about the layers' axes, the fixed nodes, the loads as nodal forces (a
 *  uniform traction on a quadratic face goes to its mid-side nodes, a
 *  third each), a static step, and displacement and stress written out. */
export function writeInp(mesh, { material, axes, fixed, forces }) {
  const { xyz, elements } = mesh
  const L = ['*HEADING', 'ScanRuler FEA', '*NODE, NSET=NALL']
  for (let i = 0; i < xyz.length / 3; i++) L.push(`${i + 1}, ${f(xyz[i * 3])}, ${f(xyz[i * 3 + 1])}, ${f(xyz[i * 3 + 2])}`)
  L.push('*ELEMENT, TYPE=C3D10, ELSET=EALL')
  for (let e = 0; e < elements.length / 10; e++) {
    const n = Array.from(elements.subarray(e * 10, e * 10 + 10))
    L.push(`${e + 1}, ${n.slice(0, 8).join(', ')},`, `${n.slice(8).join(', ')}`)
  }
  const m = material
  L.push(
    `*ORIENTATION, NAME=LAYERS, SYSTEM=RECTANGULAR`,
    `${axes.x.map(f).join(', ')}, ${axes.y.map(f).join(', ')}`,
    '*MATERIAL, NAME=PRINTED',
    '*ELASTIC, TYPE=ENGINEERING CONSTANTS',
    // E1, E2, E3, nu12, nu13, nu23, G12, G13 / G23, temperature
    `${f(m.Exy)}, ${f(m.Exy)}, ${f(m.Ez)}, ${f(m.nuXY)}, ${f(m.nuZ)}, ${f(m.nuZ)}, ${f(m.Gxy)}, ${f(m.Gz)}`,
    `${f(m.Gz)}, 0`,
    '*SOLID SECTION, ELSET=EALL, MATERIAL=PRINTED, ORIENTATION=LAYERS',
    '*NSET, NSET=FIXED',
  )
  const fx = [...fixed].sort((a, b) => a - b)
  for (let i = 0; i < fx.length; i += 12) L.push(fx.slice(i, i + 12).join(', ') + (i + 12 < fx.length ? ',' : ''))
  L.push('*STEP', '*STATIC', '*BOUNDARY', 'FIXED, 1, 3', '*CLOAD')
  for (const [node, v] of forces) for (let d = 0; d < 3; d++) if (Math.abs(v[d]) > 0) L.push(`${node}, ${d + 1}, ${f(v[d])}`)
  L.push('*NODE FILE', 'U', '*EL FILE', 'S', '*END STEP', '')
  return L.join('\n')
}

/** Nodal forces for loads on groups of surface faces: a total force spread
 *  by area, or a pressure pushing on the faces. */
export function nodalForces(surface, loads) {
  const out = new Map()
  const add = (n, v, s) => {
    const was = out.get(n) ?? [0, 0, 0]
    out.set(n, [was[0] + v[0] * s, was[1] + v[1] * s, was[2] + v[2] * s])
  }
  for (const L of loads) {
    const fs = L.faces.map((i) => surface[i])
    const area = fs.reduce((s, x) => s + x.area, 0)
    if (!(area > 0)) continue
    for (const x of fs) {
      // Traction on the face: a share of the force, or the pressure inward.
      const tr = L.force ? L.force.map((c) => c / area) : x.normal.map((c) => -c * L.pressure)
      // Quadratic triangle, uniform traction: corners 0, mid-sides A/3 each.
      for (const n of x.nodes.slice(3)) add(n, tr, x.area / 3)
    }
  }
  return out
}

// ---- CalculiX's answer -----------------------------------------------------------

/** CalculiX's result file (.frd, ASCII): the last step's nodal
 *  displacement and stress, by node. */
export function readFrd(text) {
  const lines = text.split(/\r?\n/)
  const disp = new Map()
  const stress = new Map()
  let into = null
  for (const l of lines) {
    if (/^\s+-4\s+DISP\b/.test(l)) {
      into = disp
      disp.clear()
      continue
    }
    if (/^\s+-4\s+STRESS\b/.test(l)) {
      into = stress
      stress.clear()
      continue
    }
    if (/^\s+-4\s+/.test(l)) {
      into = null
      continue
    }
    if (/^\s+-3\b/.test(l)) {
      into = null
      continue
    }
    if (!into || !l.startsWith(' -1')) continue
    const node = Number(l.slice(3, 13))
    const vals = []
    for (let k = 13; k + 12 <= l.length; k += 12) vals.push(Number(l.slice(k, k + 12)))
    into.set(node, vals)
  }
  if (!disp.size) throw new Error('CalculiX wrote no displacements.')
  return { disp, stress }
}

/** A stress tensor [xx, yy, zz, xy, yz, zx] in the material's axes. */
function inAxes(s, ax) {
  const S = [
    [s[0], s[3], s[5]],
    [s[3], s[1], s[4]],
    [s[5], s[4], s[2]],
  ]
  const R = [ax.x, ax.y, ax.z]
  const T = (i, j) => {
    let v = 0
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += R[i][a] * S[a][b] * R[j][b]
    return v
  }
  return { s11: T(0, 0), s22: T(1, 1), s33: T(2, 2), t12: T(0, 1), t13: T(0, 2), t23: T(1, 2) }
}

/** What a node's stress comes to for a printed part: von Mises; the stress
 *  across the layers and the shear between them; and the safety factor —
 *  the lesser of Hill's quadratic check in the layers (tension or
 *  compression strengths as the stress has it) and the between-layer check
 *  (pulled apart, or sheared). */
export function judge(s, m, ax) {
  const vm = Math.sqrt(0.5 * ((s[0] - s[1]) ** 2 + (s[1] - s[2]) ** 2 + (s[2] - s[0]) ** 2) + 3 * (s[3] ** 2 + s[4] ** 2 + s[5] ** 2))
  const a = inAxes(s, ax)
  const X1 = a.s11 >= 0 ? m.Xt : m.Xc
  const X2 = a.s22 >= 0 ? m.Xt : m.Xc
  const Z = a.s33 >= 0 ? m.Zt : m.Zc
  // Hill (1948) for transverse isotropy: 1, 2 in the layer, 3 across.
  const F = 0.5 * (1 / X2 ** 2 + 1 / Z ** 2 - 1 / X1 ** 2)
  const G = 0.5 * (1 / Z ** 2 + 1 / X1 ** 2 - 1 / X2 ** 2)
  const H = 0.5 * (1 / X1 ** 2 + 1 / X2 ** 2 - 1 / Z ** 2)
  const hill = F * (a.s22 - a.s33) ** 2 + G * (a.s33 - a.s11) ** 2 + H * (a.s11 - a.s22) ** 2 + (a.t23 ** 2 + a.t13 ** 2) / m.Sz ** 2 + a.t12 ** 2 / m.S ** 2
  const shear = Math.hypot(a.t13, a.t23)
  const apart = Math.max(a.s33 > 0 ? a.s33 / m.Zt : 0, shear / m.Sz)
  const sfHill = hill > 0 ? 1 / Math.sqrt(hill) : Infinity
  const sfLayers = apart > 0 ? 1 / apart : Infinity
  return { vm, across: a.s33, shear, sf: Math.min(sfHill, sfLayers), mode: sfLayers <= sfHill * (1 + 1e-9) ? (a.s33 > 0 && a.s33 / m.Zt >= shear / m.Sz ? 'layers pulled apart' : 'layers sheared') : 'in the layers' }
}

// ---- the run ---------------------------------------------------------------------

/**
 * @typedef {object} FeaJob
 * @property {string} step          The part as STEP text, in mm.
 * @property {number[]} build        The build direction (the layers' normal), part frame.
 * @property {{ id?: string, overrides?: object }} material
 * @property {{ name?: string, triangles: number[] }[]} fixtures  Faces held still.
 * @property {{ name?: string, triangles: number[], force?: number[], pressure?: number }[]} loads  N, or MPa.
 * @property {{ size?: number, fineness?: 'coarse' | 'medium' | 'fine' }} [mesh]
 */

const FINENESS = { coarse: 12, medium: 24, fine: 40 }

/** Mesh, solve and judge a part. progress(phase, detail) says how far. */
export async function solve(job, env = process.env, { signal, progress = () => {} } = {}) {
  const tools = await feaTools(env)
  if (!tools.ready) throw new Error(tools.howTo)
  if (typeof job?.step !== 'string' || !/ISO-10303-21/.test(job.step.slice(0, 400))) throw new Error('The part must come as STEP.')
  const material = materialOf(job.material?.id ?? 'pla', job.material?.overrides)
  const axes = layerAxes(Array.isArray(job.build) && job.build.length === 3 ? job.build : [0, 0, 1])
  const fixtures = Array.isArray(job.fixtures) ? job.fixtures : []
  const loads = Array.isArray(job.loads) ? job.loads : []
  if (!fixtures.length) throw new Error('Hold the part somewhere: at least one fixed face.')
  if (!loads.length) throw new Error('Load the part: at least one face with a force or a pressure.')
  for (const L of loads) {
    const hasForce = Array.isArray(L.force) && L.force.length === 3 && L.force.every(Number.isFinite) && L.force.some((x) => x !== 0)
    const hasPressure = typeof L.pressure === 'number' && Number.isFinite(L.pressure) && L.pressure !== 0
    if (hasForce === hasPressure) throw new Error(`Each load is a force [x, y, z] in N or a pressure in MPa, one of them (${L.name ?? 'a load'}).`)
  }
  const dir = await mkdtemp(join(tmpdir(), 'scanruler-fea-'))
  try {
    await writeFile(join(dir, 'part.step'), job.step)
    // The part's size from the STEP's points, for the element size.
    const pts = [...job.step.matchAll(/CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
    const lo = [0, 1, 2].map((a) => Math.min(...pts.map((p) => p[a])))
    const hi = [0, 1, 2].map((a) => Math.max(...pts.map((p) => p[a])))
    const diag = pts.length ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 100
    const size = job.mesh?.size > 0 ? job.mesh.size : diag / (FINENESS[job.mesh?.fineness ?? 'medium'] ?? 24)
    progress('meshing', `elements about ${size.toPrecision(2)} mm`)
    const g = await run(tools.gmsh.path, ['part.step', '-3', '-order', '2', '-clmax', String(size), '-clmin', String(size / 4), '-setnumber', 'Mesh.MeshSizeFromCurvature', '12', '-format', 'msh22', '-o', 'part.msh', '-nt', '4'], { cwd: dir, env: envFor(tools.gmsh.path, env), signal, timeoutMs: 600_000 })
    if (g.code !== 0 || !existsSync(join(dir, 'part.msh'))) throw new Error(`Gmsh could not mesh the part: ${(g.err || g.out).split('\n').filter((l) => /error/i.test(l)).slice(-3).join(' ') || `exit ${g.code}`}`)
    const mesh = readMsh(await readFile(join(dir, 'part.msh'), 'utf8'))
    const elements = mesh.elements.length / 10
    if (elements > 400_000) throw new Error(`The mesh came to ${elements} elements — more than this solves on a laptop. Ask for a coarser mesh (fineness: "coarse", or a larger size).`)
    const surface = surfaceOf(mesh)
    const tol = Math.max(0.05, diag * 2e-3)
    const groups = (list, what) =>
      list.map((g, i) => {
        const faces = facesOn(surface, Float64Array.from(g.triangles ?? []), tol)
        if (!faces.length) throw new Error(`${what} ${g.name ?? i + 1} lies on none of the part's surface — are its faces from this body, in its frame?`)
        return { ...g, faces }
      })
    const fix = groups(fixtures, 'Fixture')
    const ld = groups(loads, 'Load')
    const fixed = new Set(fix.flatMap((g) => g.faces.flatMap((i) => surface[i].nodes)))
    const forces = nodalForces(surface, ld)
    progress('solving', `${elements} elements, ${mesh.xyz.length / 3} nodes`)
    await writeFile(join(dir, 'job.inp'), writeInp(mesh, { material, axes, fixed, forces }))
    const c = await run(tools.ccx.path, ['-i', 'job'], { cwd: dir, env: { ...envFor(tools.ccx.path, env), OMP_NUM_THREADS: env.OMP_NUM_THREADS ?? '4', CCX_NPROC_EQUATION_SOLVER: env.CCX_NPROC_EQUATION_SOLVER ?? '4' }, signal, timeoutMs: 1_800_000 })
    const said = `${c.out}\n${c.err}`
    const err = said.split('\n').filter((l) => /\*ERROR/i.test(l))
    if (err.length || !existsSync(join(dir, 'job.frd'))) throw new Error(`CalculiX did not solve it: ${err.slice(0, 2).join(' ').trim() || said.trim().split('\n').slice(-3).join(' ')}`)
    progress('reading', 'the results')
    const r = readFrd(await readFile(join(dir, 'job.frd'), 'utf8'))
    return answerOf(mesh, surface, r, { material, axes, fixed, ld, fix, tools, size })
  } finally {
    if (!env.SCANRULER_FEA_KEEP) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** The answer: the worst of it, where, and the outside as triangles with a
 *  value at each corner, to colour the part by. */
function answerOf(mesh, surface, r, { material, axes, fixed, ld, fix, tools, size }) {
  const nodes = mesh.xyz.length / 3
  const vm = new Float32Array(nodes + 1)
  const sf = new Float32Array(nodes + 1).fill(Infinity)
  const across = new Float32Array(nodes + 1)
  const shear = new Float32Array(nodes + 1)
  const disp = new Float32Array(nodes + 1)
  let worst = { sf: Infinity, node: 0, mode: '' }
  let maxVm = 0, maxDisp = 0, maxDispNode = 0
  for (let n = 1; n <= nodes; n++) {
    const u = r.disp.get(n) ?? [0, 0, 0]
    disp[n] = Math.hypot(u[0], u[1], u[2])
    if (disp[n] > maxDisp) {
      maxDisp = disp[n]
      maxDispNode = n
    }
    const s = r.stress.get(n)
    if (!s) continue
    const j = judge(s, material, axes)
    vm[n] = j.vm
    sf[n] = j.sf
    across[n] = j.across
    shear[n] = j.shear
    if (j.vm > maxVm) maxVm = j.vm
    if (j.sf < worst.sf) worst = { sf: j.sf, node: n, mode: j.mode }
  }
  const at = (n) => [mesh.xyz[(n - 1) * 3], mesh.xyz[(n - 1) * 3 + 1], mesh.xyz[(n - 1) * 3 + 2]].map((x) => Math.round(x * 1000) / 1000)
  // A singular spot: the worst at a fixed node, where a perfectly rigid hold
  // makes stress no part sees. The worst away from the holds is said too.
  let away = { sf: Infinity, node: 0, mode: '' }
  for (let n = 1; n <= nodes; n++) {
    if (fixed.has(n) || !(sf[n] < away.sf)) continue
    const s = r.stress.get(n)
    if (!s) continue
    away = { sf: sf[n], node: n, mode: judge(s, material, axes).mode }
  }
  // The outside: each quadratic face as four flat triangles.
  const positions = []
  const fields = { vonMises: [], safety: [], displacement: [], across: [], shear: [] }
  const SPLIT = [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]]
  for (const face of surface) {
    for (const tri of SPLIT)
      for (const k of tri) {
        const n = face.nodes[k]
        const p = at(n)
        positions.push(p[0], p[1], p[2])
        fields.vonMises.push(Math.round(vm[n] * 1000) / 1000)
        fields.safety.push(Number.isFinite(sf[n]) ? Math.round(Math.min(sf[n], 1e6) * 1000) / 1000 : 1e6)
        fields.displacement.push(Math.round(disp[n] * 1e6) / 1e6)
        fields.across.push(Math.round(across[n] * 1000) / 1000)
        fields.shear.push(Math.round(shear[n] * 1000) / 1000)
      }
  }
  const r3 = (x) => Math.round(x * 1000) / 1000
  return {
    solver: { gmsh: tools.gmsh.version, calculix: tools.ccx.version },
    mesh: { elements: mesh.elements.length / 10, nodes, size: r3(size) },
    material: { id: material.id, label: material.label, Exy: material.Exy, Ez: material.Ez, Xt: material.Xt, Zt: material.Zt, Sz: r3(material.Sz) },
    build: axes.z.map(r3),
    groups: { fixtures: fix.map((g, i) => ({ name: g.name ?? `fixture ${i + 1}`, faces: g.faces.length })), loads: ld.map((g, i) => ({ name: g.name ?? `load ${i + 1}`, faces: g.faces.length, ...(g.force ? { force: g.force } : { pressure: g.pressure }) })) },
    worst: {
      safety: Number.isFinite(worst.sf) ? r3(worst.sf) : null,
      at: worst.node ? at(worst.node) : null,
      mode: worst.mode || null,
      atAHold: fixed.has(worst.node),
      ...(fixed.has(worst.node) && Number.isFinite(away.sf) ? { awayFromHolds: { safety: r3(away.sf), at: at(away.node), mode: away.mode } } : {}),
      vonMises: r3(maxVm),
      displacement: Math.round(maxDisp * 1e6) / 1e6,
      displacementAt: maxDispNode ? at(maxDispNode) : null,
    },
    surface: { positions, fields },
  }
}
