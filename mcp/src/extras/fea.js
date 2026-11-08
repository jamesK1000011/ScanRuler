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
// from the in-layer and the between-layer checks.
//
// The job and the answer are plain JSON (FeaJob, FeaAnswer below), so
// another solver can stand behind the same exchange.

import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir, totalmem } from 'node:os'
import { dirname, join } from 'node:path'

// ---- the programs ---------------------------------------------------------------

const BUNDLES = ['/Applications/FreeCAD.app/Contents/Resources/bin', join(homedir(), 'Applications/FreeCAD.app/Contents/Resources/bin')]
const SYSTEM = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

const cancelled = () => Object.assign(new Error('Cancelled.'), { cancelled: true })

/** A program run to its end: its output (capped), exit code and signal,
 *  and whether it ran out of time. Cancel or a timeout kills it and
 *  anything it started (its process group, where the system has them). */
function run(cmd, args, { cwd, env, timeoutMs = 600_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const group = process.platform !== 'win32'
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: group })
    let out = ''
    let err = ''
    let timedOut = false
    const kill = () => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {}
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    signal?.addEventListener('abort', kill, { once: true })
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', kill)
    }
    child.stdout.on('data', (d) => {
      out += d
      if (out.length > 4e6) out = out.slice(-2e6)
    })
    child.stderr.on('data', (d) => {
      err += d
      if (err.length > 1e6) err = err.slice(-5e5)
    })
    child.on('error', (e) => {
      done()
      reject(new Error(`${cmd} could not be started: ${e.message}`))
    })
    child.on('close', (code, sig) => {
      done()
      if (signal?.aborted) return reject(cancelled())
      resolve({ code, signal: sig, timedOut, out, err })
    })
  })
}

/** How a program's run ended, in words, when it did not end well. */
function ending(name, r) {
  if (r.timedOut) return `${name} ran out of time`
  if (r.signal) return `${name} was killed (${r.signal}) — most often out of memory: try a coarser mesh`
  return `${name} stopped (exit ${r.code})`
}

/** The environment a bundled program runs in: a Linux FreeCAD keeps its
 *  libraries beside its programs (usr/lib), which the Mac app finds itself. */
function envFor(path, env) {
  const lib = join(dirname(path), '..', 'lib')
  if (process.platform === 'linux' && existsSync(lib)) return { ...env, LD_LIBRARY_PATH: [lib, env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  return env
}

async function which(name, env) {
  for (const d of String(env.PATH ?? '').split(':').filter(Boolean)) if (runnable(join(d, name))) return join(d, name)
  return null
}

const runnable = (p) => {
  try {
    if (!statSync(p).isFile()) return false
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function find(name, envKey, env) {
  if (env[envKey]) return runnable(env[envKey]) ? env[envKey] : null
  for (const d of [...BUNDLES, ...SYSTEM]) if (runnable(join(d, name))) return join(d, name)
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
  // Found but not answering for its version: there, but it does not run.
  const broken = [tools.gmsh && !tools.gmsh.version && `Gmsh (${tools.gmsh.path})`, tools.ccx && !tools.ccx.version && `CalculiX (${tools.ccx.path})`].filter(Boolean)
  return {
    ...tools,
    ready: missing.length === 0 && broken.length === 0,
    ...(missing.length || broken.length
      ? { howTo: `${[missing.length ? `${missing.join(' and ')} not found.` : '', broken.length ? `${broken.join(' and ')} found but did not run.` : ''].filter(Boolean).join(' ')} Installing FreeCAD (freecad.org) brings both; or Homebrew: brew install gmsh, and brew tap costerwi/calculix && brew install calculix-ccx. Elsewhere, set SCANRULER_GMSH / SCANRULER_CCX to the programs.` }
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
 *  the person's own figures go in overrides. Ids, labels and densities
 *  (g/cm³, solid) are the page's shared table's (plugins/_shared/
 *  materials.ts); plugins/fea/tests/fea.test.ts holds the two to each
 *  other. */
export const MATERIALS = {
  pla: { label: 'PLA', density: 1.24, Exy: 2680, Ez: 2160, nuXY: 0.35, nuZ: 0.33, Xt: 39, Xc: 60, Zt: 35, Zc: 55, S: 25 },
  petg: { label: 'PETG', density: 1.27, Exy: 2000, Ez: 1700, nuXY: 0.38, nuZ: 0.36, Xt: 42, Xc: 55, Zt: 30, Zc: 50, S: 26 },
  abs: { label: 'ABS', density: 1.04, Exy: 2000, Ez: 1650, nuXY: 0.35, nuZ: 0.33, Xt: 33, Xc: 50, Zt: 20, Zc: 40, S: 22 },
  asa: { label: 'ASA', density: 1.07, Exy: 1950, Ez: 1600, nuXY: 0.35, nuZ: 0.33, Xt: 35, Xc: 50, Zt: 22, Zc: 40, S: 22 },
  'petg-cf': { label: 'PETG-CF', density: 1.3, Exy: 2460, Ez: 1340, nuXY: 0.34, nuZ: 0.32, Xt: 35, Xc: 50, Zt: 29, Zc: 45, S: 22 },
  'pa6-cf': { label: 'PA6-CF', density: 1.17, Exy: 4430, Ez: 2170, nuXY: 0.33, nuZ: 0.30, Xt: 102, Xc: 90, Zt: 48, Zc: 70, S: 45 },
  'tpu-95a': { label: 'TPU 95A', density: 1.21, note: 'Linear only near small strain.', Exy: 26, Ez: 22, nuXY: 0.45, nuZ: 0.45, Xt: 30, Xc: 30, Zt: 20, Zc: 30, S: 15 },
}

/** Older names still taken (the page's MATERIAL_ALIASES). */
export const MATERIAL_ALIASES = { tpu: 'tpu-95a' }

/** A material whole: a preset, with the person's figures over it, and what
 *  follows from them — the shear moduli and the between-layer shear
 *  strength — where not given. */
const FIGURES = { Exy: 'MPa', Ez: 'MPa', Gxy: 'MPa', Gz: 'MPa', nuXY: '', nuZ: '', Xt: 'MPa', Xc: 'MPa', Zt: 'MPa', Zc: 'MPa', S: 'MPa', Sz: 'MPa' }

export function materialOf(name = 'pla', overrides = {}) {
  const id = typeof name === 'string' && Object.hasOwn(MATERIAL_ALIASES, name) ? MATERIAL_ALIASES[name] : name
  const base = typeof id === 'string' && Object.hasOwn(MATERIALS, id) ? MATERIALS[id] : null
  if (!base) throw new Error(`No material "${id}" — ${Object.keys(MATERIALS).join(', ')}, with overrides for your own figures.`)
  const given = {}
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v === undefined || v === null) continue
    if (!Object.hasOwn(FIGURES, k)) throw new Error(`The material has no figure "${k}" — ${Object.keys(FIGURES).join(', ')}.`)
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`The material's ${k} must be a number.`)
    given[k] = v
  }
  const m = { id, ...base, ...given }
  m.Gxy ??= m.Exy / (2 * (1 + m.nuXY))
  // Across the layers the shear stiffness follows the softer direction.
  m.Gz ??= Math.min(m.Exy, m.Ez) / (2 * (1 + m.nuZ))
  m.Sz ??= 0.6 * m.Zt
  for (const k of ['Exy', 'Ez', 'Gxy', 'Gz', 'Xt', 'Xc', 'Zt', 'Zc', 'S', 'Sz']) if (!(m[k] > 0)) throw new Error(`The material's ${k} must be more than 0 MPa.`)
  // Plausible for a solid: stiffness 1 MPa to 1000 GPa, strength under it.
  for (const k of ['Exy', 'Ez', 'Gxy', 'Gz']) if (m[k] < 1 || m[k] > 1e6) throw new Error(`The material's ${k} (${m[k]} MPa) is not a stiffness a printed part has: 1 to 1,000,000 MPa.`)
  for (const k of ['Xt', 'Xc', 'Zt', 'Zc', 'S', 'Sz']) if (m[k] > 1e4) throw new Error(`The material's ${k} (${m[k]} MPa) is not a strength a printed part has — is it in MPa?`)
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
export function readMsh(text, { linear = false } = {}) {
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
        if (p[1] !== (linear ? 4 : 11)) continue
        const tags = p[2]
        tets.push(p.slice(3 + tags, 3 + tags + (linear ? 4 : 10)))
      }
    }
  }
  if (!tets.length) throw new Error('Gmsh made no solid elements: is the part one closed solid?')
  if (linear) {
    // Just where the part is and how much of it: its nodes and volume.
    const xyz = Float64Array.from([...nodes.values()].flat())
    let volume = 0
    for (const t of tets) {
      const q = t.map((n) => nodes.get(n))
      if (q.some((x) => !x)) throw new Error('The mesh names a node it does not hold.')
      volume += Math.abs(det(sub(q[1], q[0]), sub(q[2], q[0]), sub(q[3], q[0]))) / 6
    }
    return { xyz, volume }
  }
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
  const GMSH_EDGES = [[0, 1], [1, 2], [0, 2], [0, 3], [2, 3], [1, 3]]
  const edgeKey = (x, y) => (x < y ? `${x} ${y}` : `${y} ${x}`)
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
    for (let k = 0; k < 4; k++) elements[e * 10 + k] = cc[k]
    // Gmsh writes a TET10's mid-side nodes on the edges 0-1, 1-2, 0-2, 0-3,
    // 2-3, 1-3 of its corners (read off a straight-edged mesh, every node
    // at its edge's midpoint); each goes to its edge by the corners it joins,
    // not by where it lies — a curved element's mid node can sit nearer
    // another edge's midpoint.
    const onEdge = new Map()
    GMSH_EDGES.forEach(([a, b], k) => onEdge.set(edgeKey(c[a], c[b]), mids[k]))
    EDGES.forEach(([a, b], k) => {
      const m = onEdge.get(edgeKey(cc[a], cc[b]))
      if (m === undefined) throw new Error('The mesh has an element whose mid-side nodes do not match its edges.')
      elements[e * 10 + 4 + k] = m
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
    faces.push({ nodes, normal: [cr[0] / (2 * area), cr[1] / (2 * area), cr[2] / (2 * area)], area, centre, corners: [...a, ...b, ...c] })
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

/** The surface faces that lie on a group's CAD triangles (nine numbers
 *  each, the part's frame): a face's centre within tolerance of one and
 *  facing within 30° of it. The tolerance grows where the display mesh is
 *  coarse on a curve (a hole drawn with few sides lies off the true wall by
 *  its sagitta), estimated from the angle to the triangle's neighbours.
 *  Each triangle faces one way: where both walls of a slit thinner than
 *  the tolerance come within reach, the wall it lies on wins (each
 *  triangle's side voted by its nearest faces, the closest counting most).
 *  A group smaller than one mesh face takes the face under it. */
export function facesOn(surface, tris, tol) {
  const n = Math.floor(tris.length / 9)
  if (!n) return []
  const nrm = []
  const len = new Float64Array(n)
  for (let t = 0; t < n; t++) {
    const o = t * 9
    const e1 = [tris[o + 3] - tris[o], tris[o + 4] - tris[o + 1], tris[o + 5] - tris[o + 2]]
    const e2 = [tris[o + 6] - tris[o], tris[o + 7] - tris[o + 1], tris[o + 8] - tris[o + 2]]
    const e3 = [tris[o + 6] - tris[o + 3], tris[o + 7] - tris[o + 4], tris[o + 8] - tris[o + 5]]
    const c = cross(e1, e2)
    const l = norm(c)
    nrm.push(l > 0 ? [c[0] / l, c[1] / l, c[2] / l] : null)
    len[t] = Math.max(norm(e1), norm(e2), norm(e3))
  }
  // The bend to each neighbour across a shared edge (a smooth one: under 61°).
  const key = (o) => `${Math.round(tris[o] * 1e4)},${Math.round(tris[o + 1] * 1e4)},${Math.round(tris[o + 2] * 1e4)}`
  const edges = new Map()
  for (let t = 0; t < n; t++) {
    const v = [key(t * 9), key(t * 9 + 3), key(t * 9 + 6)]
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3]
      const e = a < b ? `${a}|${b}` : `${b}|${a}`
      const list = edges.get(e)
      if (list) list.push(t)
      else edges.set(e, [t])
    }
  }
  const bend = new Float64Array(n)
  for (const list of edges.values())
    for (const t of list)
      for (const u of list) {
        if (t === u || !nrm[t] || !nrm[u]) continue
        const th = Math.acos(Math.min(1, Math.abs(dot(nrm[t], nrm[u]))))
        if (th < (61 * Math.PI) / 180 && th > bend[t]) bend[t] = th
      }
  const tolOf = new Float64Array(n)
  const cosOf = new Float64Array(n)
  let tolMax = tol
  for (let t = 0; t < n; t++) {
    tolOf[t] = Math.max(tol, (1.5 * len[t] * bend[t]) / 8)
    cosOf[t] = Math.cos(Math.max(Math.PI / 6, bend[t] / 2 + Math.PI / 9))
    tolMax = Math.max(tolMax, tolOf[t])
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < n * 9; k++) {
    lo[k % 3] = Math.min(lo[k % 3], tris[k])
    hi[k % 3] = Math.max(hi[k % 3], tris[k])
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  const cell = Math.max(tolMax * 2, diag / 64, 1e-3)
  const dims = [0, 1, 2].map((a) => Math.max(1, Math.ceil((hi[a] - lo[a] + 2 * tolMax) / cell)))
  const base = lo.map((x) => x - tolMax)
  const cellOf = (x, a) => Math.min(dims[a] - 1, Math.max(0, Math.floor((x - base[a]) / cell)))
  const grid = new Map()
  for (let t = 0; t < n; t++) {
    if (!nrm[t]) continue
    const o = t * 9
    const b0 = [0, 1, 2].map((a) => cellOf(Math.min(tris[o + a], tris[o + 3 + a], tris[o + 6 + a]) - tolOf[t], a))
    const b1 = [0, 1, 2].map((a) => cellOf(Math.max(tris[o + a], tris[o + 3 + a], tris[o + 6 + a]) + tolOf[t], a))
    for (let i = b0[0]; i <= b1[0]; i++)
      for (let j = b0[1]; j <= b1[1]; j++)
        for (let k = b0[2]; k <= b1[2]; k++) {
          const g = (i * dims[1] + j) * dims[2] + k
          const list = grid.get(g)
          if (list) list.push(t)
          else grid.set(g, [t])
        }
  }
  // Each face's nearest triangle (as a share of that triangle's tolerance).
  const hits = []
  surface.forEach((f, idx) => {
    const q = f.centre
    if (q.some((x, a) => x < base[a] || x > hi[a] + tolMax)) return
    const list = grid.get((cellOf(q[0], 0) * dims[1] + cellOf(q[1], 1)) * dims[2] + cellOf(q[2], 2))
    if (!list) return
    let best = -1, r = Infinity, side = 0
    for (const t of list) {
      const d = dot(f.normal, nrm[t])
      if (Math.abs(d) < cosOf[t]) continue
      const rr = Math.sqrt(toTriangle(tris, t, q)) / tolOf[t]
      if (rr <= 1 && rr < r) {
        best = t
        r = rr
        side = Math.sign(d)
      }
    }
    if (best >= 0) hits.push({ idx, t: best, r, side })
  })
  const vote = new Float64Array(n)
  for (const h of hits) vote[h.t] += h.side * (1 - h.r + 1e-6)
  const out = hits.filter((h) => vote[h.t] === 0 || Math.sign(vote[h.t]) === h.side).map((h) => h.idx)
  if (out.length || n > 2000) return out
  // Smaller than a mesh face: the face each triangle's middle lies on.
  const got = new Set()
  for (let t = 0; t < n; t++) {
    if (!nrm[t]) continue
    const o = t * 9
    const c = [0, 1, 2].map((a) => (tris[o + a] + tris[o + 3 + a] + tris[o + 6 + a]) / 3)
    let best = -1, d2 = tolOf[t] ** 2
    surface.forEach((f, idx) => {
      if (Math.abs(dot(f.normal, nrm[t])) < cosOf[t]) return
      const reach = 2 * Math.sqrt(2 * f.area) + tolOf[t]
      if ((f.centre[0] - c[0]) ** 2 + (f.centre[1] - c[1]) ** 2 + (f.centre[2] - c[2]) ** 2 > reach * reach) return
      const corners = f.corners
      const d = toTriangle(corners, 0, c)
      if (d <= d2) {
        d2 = d
        best = idx
      }
    })
    if (best >= 0) got.add(best)
  }
  return [...got]
}

// ---- CalculiX's input ------------------------------------------------------------

const f = (x) => (Math.abs(x) < 1e-300 ? '0' : x.toPrecision(10))

/** Standard gravity, mm/s². */
export const G = 9806.65

/** The part's own weight as a job gives it, checked: the direction it
 *  pulls (made a unit), how many g (1 for standing still; more for a
 *  shake or a drop), and the density it weighs at, g/cm³ — the solid
 *  material's, or the part's mass over its volume as printed. */
export function gravityOf(gr, material) {
  if (gr === undefined || gr === null || gr === false) return null
  if (typeof gr !== 'object') throw new Error('gravity is { direction: [x, y, z], g, density } or left out.')
  const dir = gr.direction ?? [0, 0, -1]
  if (!isVec(dir) || !(Math.hypot(...dir) > 0)) throw new Error('The gravity direction is three numbers [x, y, z], not all zero.')
  const g = gr.g ?? 1
  if (typeof g !== 'number' || !Number.isFinite(g) || g <= 0 || g > 1000) throw new Error('gravity.g is how many g: more than 0, at most 1000.')
  const density = gr.density ?? material.density
  if (typeof density !== 'number' || !Number.isFinite(density) || density < 0.01 || density > 25) throw new Error('gravity.density is g/cm³: 0.01 to 25.')
  const l = Math.hypot(...dir)
  return { direction: dir.map((x) => x / l), g, density }
}

/** A quadratic mesh's volume, mm³, from its elements' corners. */
export function meshVolume(mesh) {
  const E = mesh.elements
  const p = (n) => [mesh.xyz[(n - 1) * 3], mesh.xyz[(n - 1) * 3 + 1], mesh.xyz[(n - 1) * 3 + 2]]
  let v = 0
  for (let e = 0; e < E.length; e += 10) {
    const q = [p(E[e]), p(E[e + 1]), p(E[e + 2]), p(E[e + 3])]
    v += Math.abs(det(sub(q[1], q[0]), sub(q[2], q[0]), sub(q[3], q[0]))) / 6
  }
  return v
}

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
export function writeInp(mesh, { material, axes, fixed, forces, gravity = null }) {
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
    // Units N, mm, s: mass in tonnes, so density in t/mm³ (1 g/cm³ = 1e-9).
    ...(gravity ? ['*DENSITY', f(gravity.density * 1e-9)] : []),
    '*SOLID SECTION, ELSET=EALL, MATERIAL=PRINTED, ORIENTATION=LAYERS',
    '*NSET, NSET=FIXED',
  )
  const fx = [...fixed].sort((a, b) => a - b)
  for (let i = 0; i < fx.length; i += 12) L.push(fx.slice(i, i + 12).join(', ') + (i + 12 < fx.length ? ',' : ''))
  L.push('*STEP', '*STATIC', '*BOUNDARY', 'FIXED, 1, 3')
  const cload = []
  for (const [node, v] of forces) for (let d = 0; d < 3; d++) if (Math.abs(v[d]) > 0) cload.push(`${node}, ${d + 1}, ${f(v[d])}`)
  if (cload.length) L.push('*CLOAD', ...cload)
  // The part's own weight: g in mm/s² along the direction, on every element.
  if (gravity) L.push('*DLOAD', `EALL, GRAV, ${f(G * gravity.g)}, ${gravity.direction.map(f).join(', ')}`)
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
const num = (t) => {
  const x = Number(t)
  if (!Number.isNaN(x)) return x
  // CalculiX writes overflowed values as INF (or NAN): kept as such, not as 0.
  if (/INF/i.test(t)) return t.includes('-') ? -Infinity : Infinity
  return NaN
}

export function readFrd(text) {
  const lines = text.split(/\r?\n/)
  const disp = new Map()
  const stress = new Map()
  let into = null
  for (const l of lines) {
    if (/^\s+-4\s+DISP\b/.test(l)) {
      // A step's displacement comes before its stress: a new step's
      // displacement starts both afresh.
      into = disp
      disp.clear()
      stress.clear()
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
    for (let k = 13; k + 12 <= l.length; k += 12) vals.push(num(l.slice(k, k + 12)))
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
 *  across the layers and the shear between them; and the safety factor, the
 *  least of three checks, its mode the one that sets it:
 *  - in the layers: a quadratic check on the in-layer principal stresses
 *    (so it does not depend on which way in the layer is "x"), tension or
 *    compression strength as each has it, through the in-layer shear
 *    strength S where they differ in sign;
 *  - layers pulled apart or sheared: the pull across them and the shear
 *    between them together, √((σ₃₃⁺/Zt)² + (τ/Sz)²);
 *  - layers crushed: compression across them on its own, −σ₃₃/Zc. */
export function judge(s, m, ax) {
  const vm = Math.sqrt(0.5 * ((s[0] - s[1]) ** 2 + (s[1] - s[2]) ** 2 + (s[2] - s[0]) ** 2) + 3 * (s[3] ** 2 + s[4] ** 2 + s[5] ** 2))
  const a = inAxes(s, ax)
  // In-layer principal stresses.
  const c = (a.s11 + a.s22) / 2
  const r = Math.hypot((a.s11 - a.s22) / 2, a.t12)
  const p1 = c + r, p2 = c - r
  const X1 = p1 >= 0 ? m.Xt : m.Xc
  const X2 = p2 >= 0 ? m.Xt : m.Xc
  // Same sign: Tsai–Hill's cross term. Opposite: set by S (pure shear,
  // p1 = −p2, fails at S), held short of making the check indefinite.
  const k = p1 * p2 >= 0 ? 1 / (X1 * X2) : Math.max(1 / m.S ** 2 - 1 / X1 ** 2 - 1 / X2 ** 2, -1.9 / (X1 * X2))
  const inLayer = (p1 / X1) ** 2 + (p2 / X2) ** 2 - k * p1 * p2
  const shear = Math.hypot(a.t13, a.t23)
  const pull = Math.max(a.s33, 0) / m.Zt
  const between = Math.hypot(pull, shear / m.Sz)
  const crush = Math.max(-a.s33, 0) / m.Zc
  const checks = [
    [inLayer > 0 ? 1 / Math.sqrt(inLayer) : Infinity, 'in the layers'],
    [between > 0 ? 1 / between : Infinity, pull >= shear / m.Sz ? 'layers pulled apart' : 'layers sheared'],
    [crush > 0 ? 1 / crush : Infinity, 'layers crushed'],
  ]
  let [sf, mode] = checks[0]
  for (const [x, w] of checks.slice(1)) if (x < sf * (1 - 1e-9)) [sf, mode] = [x, w]
  return { vm, across: a.s33, shear, sf, mode: Number.isFinite(sf) ? mode : null }
}

// ---- the run ---------------------------------------------------------------------

/**
 * @typedef {object} FeaJob
 * @property {string} step          The part as STEP text (read in mm whatever its units).
 * @property {number[]} build        The build direction (the layers' normal), part frame.
 * @property {{ id?: string, overrides?: object }} material
 * @property {{ name?: string, triangles: number[] }[]} fixtures  Faces held still.
 * @property {{ name?: string, triangles: number[], force?: number[], pressure?: number }[]} loads  N, or MPa.
 * @property {{ size?: number, fineness?: 'coarse' | 'medium' | 'fine' }} [mesh]
 * @property {{ direction?: number[], g?: number, density?: number }} [gravity]  The part's own weight: g/cm³, the material's when not given.
 */

const FINENESS = { coarse: 12, medium: 24, fine: 40 }

/** About how many elements this computer solves: CalculiX's direct solver
 *  needs about 40 kB per quadratic element; half the memory is left for
 *  everything else. */
export function elementCap(bytes = totalmem()) {
  return Math.max(30_000, Math.min(400_000, Math.floor(bytes / 2 / 40_000)))
}

const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))

/** A group's triangles checked: nine finite numbers each. */
function trianglesOf(g, what, i) {
  const t = g?.triangles
  const name = `${what} ${g?.name ?? i + 1}`
  if (!Array.isArray(t) && !ArrayBuffer.isView(t)) throw new Error(`${name} needs its faces as triangles (nine numbers each).`)
  if (!t.length || t.length % 9) throw new Error(`${name}'s triangles must be nine numbers each (x, y, z of three corners); it has ${t.length} numbers.`)
  for (let k = 0; k < t.length; k++) if (typeof t[k] !== 'number' || !Number.isFinite(t[k])) throw new Error(`${name}'s triangle ${Math.floor(k / 9) + 1} has a coordinate that is not a number.`)
  return Float64Array.from(t)
}

/** The mesh's connected pieces: each element's nodes joined. */
function piecesOf(mesh) {
  const nodes = mesh.xyz.length / 3
  const up = new Int32Array(nodes + 1).map((_, i) => i)
  const root = (x) => {
    while (up[x] !== x) x = up[x] = up[up[x]]
    return x
  }
  const E = mesh.elements
  for (let e = 0; e < E.length; e += 10) for (let k = 1; k < 10; k++) up[root(E[e + k])] = root(E[e])
  const piece = new Int32Array(nodes + 1)
  const ids = new Map()
  for (let n = 1; n <= nodes; n++) {
    const r = root(n)
    if (!ids.has(r)) ids.set(r, ids.size)
    piece[n] = ids.get(r)
  }
  return { count: ids.size, piece }
}

/** Mesh, solve and judge a part. progress(phase, detail) says how far. */
/**
 * How many quadratic tetrahedra are turned inside out somewhere CalculiX
 * looks: the Jacobian's determinant at its four integration points (C3D10,
 * ccx's order of nodes), not above zero. Gmsh's own count comes before its
 * optimiser has run, so it can't be taken as the mesh's.
 */
export function invertedElements(mesh) {
  const { xyz, elements } = mesh
  const a = 0.1381966011250105
  const b = 0.5854101966249685
  const points = [[a, a, a], [b, a, a], [a, b, a], [a, a, b]]
  let bad = 0
  for (let e = 0; e < elements.length; e += 10) {
    const P = (k) => (elements[e + k] - 1) * 3
    let worst = Infinity
    for (const [r, s2, t] of points) {
      const L = [1 - r - s2 - t, r, s2, t]
      // dL/d(r, s, t) for the four corners.
      const dL = [[-1, -1, -1], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
      const add = (k, g) => {
        const o = P(k)
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) J[i][j] += xyz[o + i] * g[j]
      }
      for (let k = 0; k < 4; k++) add(k, dL[k].map((d) => (4 * L[k] - 1) * d))
      const MIDS = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]]
      MIDS.forEach(([p, q], k) => add(4 + k, dL[p].map((d, j) => 4 * (d * L[q] + L[p] * dL[q][j]))))
      const d = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0])
      worst = Math.min(worst, d)
    }
    if (!(worst > 0)) bad++
  }
  return bad
}

export async function solve(job, env = process.env, { signal, progress = () => {} } = {}) {
  const check = () => {
    if (signal?.aborted) throw cancelled()
  }
  const tools = await feaTools(env)
  if (!tools.ready) throw new Error(tools.howTo)
  check()
  if (typeof job?.step !== 'string' || !/ISO-10303-21/.test(job.step.slice(0, 400))) throw new Error('The part must come as STEP.')
  const material = materialOf(job.material?.id ?? 'pla', job.material?.overrides)
  if (job.build !== undefined && !isVec(job.build)) throw new Error('The build direction is three numbers [x, y, z].')
  const axes = layerAxes(job.build ?? [0, 0, 1])
  const fixtures = Array.isArray(job.fixtures) ? job.fixtures : []
  const loads0 = Array.isArray(job.loads) ? job.loads : []
  if (!fixtures.length) throw new Error('Hold the part somewhere: at least one fixed face.')
  const gravity = gravityOf(job.gravity, material)
  if (!loads0.length && !gravity) throw new Error('Load the part: at least one face with a force or a pressure, or its own weight.')
  const loads = loads0.map((L, i) => {
    const hasForce = isVec(L?.force) && L.force.some((x) => x !== 0)
    const hasPressure = typeof L?.pressure === 'number' && Number.isFinite(L.pressure) && L.pressure !== 0
    if (hasForce === hasPressure) throw new Error(`Each load is a force [x, y, z] in N or a pressure in MPa, one of them (${L?.name ?? `load ${i + 1}`}).`)
    const { force: _f, pressure: _p, ...rest } = L
    return hasForce ? { ...rest, force: L.force.map(Number) } : { ...rest, pressure: L.pressure }
  })
  const fixTris = fixtures.map((g, i) => trianglesOf(g, 'Fixture', i))
  const loadTris = loads.map((g, i) => trianglesOf(g, 'Load', i))
  const fineness = job.mesh?.fineness ?? 'medium'
  if (!Object.hasOwn(FINENESS, fineness)) throw new Error(`The mesh's fineness is coarse, medium or fine, not "${fineness}".`)
  let asked = null
  if (job.mesh?.size !== undefined && job.mesh?.size !== null) {
    asked = Number(job.mesh.size)
    if (!Number.isFinite(asked) || asked <= 0) throw new Error('The mesh size is a length in mm, more than 0.')
  }
  const dir = await mkdtemp(join(tmpdir(), 'scanruler-fea-'))
  try {
    await writeFile(join(dir, 'part.step'), job.step)
    // Read as millimetres whatever the STEP's units, and touching solids
    // joined so they share their faces' nodes.
    await writeFile(join(dir, 'part.geo'), 'SetFactory("OpenCASCADE");\nGeometry.OCCTargetUnit = "MM";\nMerge "part.step";\nCoherence;\n')
    const gEnv = envFor(tools.gmsh.path, env)
    // The part's size and volume from a mesh as coarse as Gmsh makes it.
    progress('meshing', 'measuring the part')
    const p = await run(tools.gmsh.path, ['part.geo', '-3', '-clmax', '1e9', '-format', 'msh22', '-o', 'probe.msh'], { cwd: dir, env: gEnv, signal, timeoutMs: 120_000 })
    if (p.code !== 0 || p.signal || !existsSync(join(dir, 'probe.msh'))) throw new Error(`Gmsh could not read the part: ${gmshSaid(p) || ending('Gmsh', p)}`)
    const probe = readMsh(await readFile(join(dir, 'probe.msh'), 'utf8'), { linear: true })
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let k = 0; k < probe.xyz.length; k++) {
      lo[k % 3] = Math.min(lo[k % 3], probe.xyz[k])
      hi[k % 3] = Math.max(hi[k % 3], probe.xyz[k])
    }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    const volume = probe.volume
    const want = asked ?? diag / FINENESS[fineness]
    const size = Math.min(Math.max(want, diag / 200), diag / 4)
    const cap = elementCap(Number(env.SCANRULER_FEA_MEMORY) > 0 ? Number(env.SCANRULER_FEA_MEMORY) : undefined)
    // A regular tetrahedron of edge a holds a³/(6√2); curves refine it further.
    const guess = Math.round((volume * 6 * Math.SQRT2) / size ** 3)
    if (guess > cap * 1.5) throw new Error(`Elements of ${size.toPrecision(2)} mm come to about ${guess.toLocaleString('en')} — more than this computer solves (about ${cap.toLocaleString('en')}). Ask for a coarser mesh (fineness: "coarse", or a size of ${((volume * 6 * Math.SQRT2) / cap) ** (1 / 3) > 0 ? (((volume * 6 * Math.SQRT2) / cap) ** (1 / 3)).toPrecision(2) : '—'} mm or more).`)
    check()
    progress('meshing', `elements about ${size.toPrecision(2)} mm`)
    // Second-order elements curved onto small round faces can come out
    // turned inside out, which CalculiX refuses ("nonpositive jacobian").
    // Gmsh's high-order optimiser untangles them; where it can't, the mesh
    // is made again with straight-edged elements, which never are.
    const gmshArgs = (extra) => ['part.geo', '-3', '-order', '2', '-clmax', String(size), '-clmin', String(size / 4), '-setnumber', 'Mesh.MeshSizeFromCurvature', '12', ...extra, '-format', 'msh22', '-o', 'part.msh', '-nt', '4']
    const meshWith = async (extra) => {
      const g = await run(tools.gmsh.path, gmshArgs(extra), { cwd: dir, env: gEnv, signal, timeoutMs: 600_000 })
      if (g.code !== 0 || g.signal || !existsSync(join(dir, 'part.msh'))) throw new Error(`Gmsh could not mesh the part: ${gmshSaid(g) || ending('Gmsh', g)}`)
      check()
      return readMsh(await readFile(join(dir, 'part.msh'), 'utf8'))
    }
    let mesh = await meshWith(['-setnumber', 'Mesh.HighOrderOptimize', '2'])
    let straightened = false
    if (invertedElements(mesh) > 0) {
      progress('meshing', 'again with straight-edged elements')
      mesh = await meshWith(['-setnumber', 'Mesh.SecondOrderLinear', '1'])
      const still = invertedElements(mesh)
      if (still > 0) throw new Error(`Gmsh made ${still} element${still === 1 ? '' : 's'} turned inside out even with straight edges: a face of the part is too thin or too small for this mesh size. Try a finer mesh, or mend the part (reverse.body.check).`)
      straightened = true
    }
    check()
    const elements = mesh.elements.length / 10
    if (elements > cap) throw new Error(`The mesh came to ${elements.toLocaleString('en')} elements — more than this computer solves (about ${cap.toLocaleString('en')}). Ask for a coarser mesh (fineness: "coarse", or a larger size).`)
    check()
    const surface = surfaceOf(mesh)
    const tol = Math.max(0.05, diag * 2e-3)
    const warnings = []
    if (straightened) warnings.push('Some curved elements came out turned inside out, so the mesh was made with straight-edged elements instead: a touch stiffer on curved faces. Solve finer to check.')
    const groups = (list, tris, what) =>
      list.map((g, i) => {
        const faces = facesOn(surface, tris[i], tol)
        const name = g.name ?? `${what.toLowerCase()} ${i + 1}`
        if (!faces.length) throw new Error(`${what} ${g.name ?? i + 1} lies on none of the part's surface — are its faces from this body, in its frame?`)
        const got = faces.reduce((s, k) => s + surface[k].area, 0)
        let cad = 0
        const t = tris[i]
        for (let o = 0; o < t.length; o += 9) cad += norm(cross([t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]])) / 2
        if (got < 0.9 * cad) warnings.push(`${name} met the mesh on ${Math.round((100 * got) / cad)} % of its area — some of its faces were not found.`)
        return { ...g, faces }
      })
    const fix = groups(fixtures, fixTris, 'Fixture')
    const ld0 = groups(loads, loadTris, 'Load')
    check()
    const fixed = new Set(fix.flatMap((g) => g.faces.flatMap((i) => surface[i].nodes)))
    // A load on a hold goes straight into it: those faces dropped, and said.
    const ld = ld0.map((g, i) => {
      const faces = g.faces.filter((k) => !surface[k].nodes.every((n) => fixed.has(n)))
      const name = g.name ?? `load ${i + 1}`
      if (!faces.length) throw new Error(`${name} lies on a hold, so it would go straight into it: load another face, or hold this one less.`)
      if (faces.length < g.faces.length) warnings.push(`${name}: ${g.faces.length - faces.length} of its ${g.faces.length} faces are on a hold and carry nothing.`)
      return { ...g, faces }
    })
    const seen = new Map()
    ld.forEach((g, i) => g.faces.forEach((k) => seen.set(k, (seen.get(k) ?? 0) | (1 << Math.min(i, 30)))))
    const shared = [...seen.values()].filter((b) => b & (b - 1)).length
    if (shared) warnings.push(`${shared} surface faces lie in more than one load and carry each of them.`)
    // Every piece held: one that is not would fly off (CalculiX answers
    // that with enormous numbers, not an error).
    const { count, piece } = piecesOf(mesh)
    if (count > 1) {
      const held = new Set([...fixed].map((n) => piece[n]))
      for (let k = 0; k < count; k++)
        if (!held.has(k)) {
          let n = 1
          while (piece[n] !== k) n++
          const at = [mesh.xyz[(n - 1) * 3], mesh.xyz[(n - 1) * 3 + 1], mesh.xyz[(n - 1) * 3 + 2]].map((x) => Math.round(x * 10) / 10)
          throw new Error(`The body is ${count} separate pieces, and one (near ${at.join(', ')}) is not held. Fuse the pieces into one solid, or hold each.`)
        }
      warnings.push(`The body is ${count} separate pieces, each held on its own: nothing passes between them.`)
    }
    const forces = nodalForces(surface, ld)
    check()
    progress('solving', `${elements} elements, ${mesh.xyz.length / 3} nodes`)
    await writeFile(join(dir, 'job.inp'), writeInp(mesh, { material, axes, fixed, forces, gravity }))
    check()
    const c = await run(tools.ccx.path, ['-i', 'job'], { cwd: dir, env: { ...envFor(tools.ccx.path, env), OMP_NUM_THREADS: env.OMP_NUM_THREADS ?? '4', CCX_NPROC_EQUATION_SOLVER: env.CCX_NPROC_EQUATION_SOLVER ?? '4' }, signal, timeoutMs: 1_800_000 })
    const said = `${c.out}\n${c.err}`
    const err = said.split('\n').filter((l) => /\*ERROR/i.test(l))
    if (err.length) throw new Error(`CalculiX did not solve it: ${err.slice(0, 2).join(' ').trim()}`)
    if (c.code !== 0 || c.signal || !existsSync(join(dir, 'job.frd'))) throw new Error(`CalculiX did not solve it: ${ending('CalculiX', c)}. ${said.trim().split('\n').slice(-2).join(' ')}`.trim())
    progress('reading', 'the results')
    const r = readFrd(await readFile(join(dir, 'job.frd'), 'utf8'))
    return answerOf(mesh, surface, r, { material, axes, fixed, ld, fix, tools, size, diag, warnings, gravity })
  } finally {
    if (!env.SCANRULER_FEA_KEEP) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const gmshSaid = (r) => (r.err || r.out).split('\n').filter((l) => /error/i.test(l)).slice(-3).join(' ')

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64')

/** The answer: the worst of it, where, and the outside as triangles over
 *  the surface's nodes with a value at each, to colour the part by — as
 *  little-endian Float32 / Uint32 arrays in base64 (surface.encoding). */
function answerOf(mesh, surface, r, { material, axes, fixed, ld, fix, tools, size, diag, warnings, gravity = null }) {
  const nodes = mesh.xyz.length / 3
  const vm = new Float32Array(nodes + 1)
  const sf = new Float32Array(nodes + 1).fill(Infinity)
  const across = new Float32Array(nodes + 1)
  const shear = new Float32Array(nodes + 1)
  const disp = new Float32Array(nodes + 1)
  const mode = new Array(nodes + 1)
  const overflow = () => new Error("CalculiX's answer overflowed — a piece of the part is free to move (not held), or the load is far too large for it.")
  let worst = { sf: Infinity, node: 0, mode: null }
  let maxVm = 0, maxDisp = 0, maxDispNode = 0
  for (let n = 1; n <= nodes; n++) {
    const u = r.disp.get(n) ?? [0, 0, 0]
    if (!u.every(Number.isFinite)) throw overflow()
    disp[n] = Math.hypot(u[0], u[1], u[2])
    if (disp[n] > maxDisp) {
      maxDisp = disp[n]
      maxDispNode = n
    }
    const s = r.stress.get(n)
    if (!s) continue
    if (!s.every(Number.isFinite)) throw overflow()
    const j = judge(s, material, axes)
    vm[n] = j.vm
    sf[n] = j.sf
    mode[n] = j.mode
    across[n] = j.across
    shear[n] = j.shear
    if (j.vm > maxVm) maxVm = j.vm
    if (j.sf < worst.sf) worst = { sf: j.sf, node: n, mode: j.mode }
  }
  if (maxDisp > 0.5 * diag) throw new Error(`The part moved ${maxDisp.toPrecision(3)} mm, more than half its size: a piece of it is not held, or the load is far beyond what a linear answer means.`)
  const strain = maxVm / Math.min(material.Exy, material.Ez)
  if (strain > 0.02) warnings.push(`The strain reaches about ${(100 * strain).toFixed(1)} % — past where this linear answer holds; read it as a rough guide.`)
  if (maxDisp > 0.05 * diag) warnings.push(`The part moves ${maxDisp.toPrecision(3)} mm, a large share of its size: a linear answer understates what really happens.`)
  if (!Number.isFinite(worst.sf)) warnings.push('No stress anywhere: the loads go straight into the holds.')
  const at = (n) => [mesh.xyz[(n - 1) * 3], mesh.xyz[(n - 1) * 3 + 1], mesh.xyz[(n - 1) * 3 + 2]].map((x) => Math.round(x * 1000) / 1000)
  // A rigid hold, or a load on a sharp spot, makes stress no part sees.
  // The worst clear of both (by two elements, or a fortieth of the part) is said too.
  const loaded = new Set(ld.flatMap((g) => g.faces.flatMap((i) => surface[i].nodes)))
  const reach = Math.max(2 * size, diag / 40)
  const near = new Map()
  const cellKey = (x, y, z) => `${Math.floor(x / reach)},${Math.floor(y / reach)},${Math.floor(z / reach)}`
  for (const n of [...fixed, ...loaded]) {
    const p = at(n)
    const k = cellKey(p[0], p[1], p[2])
    if (near.has(k)) near.get(k).push(p)
    else near.set(k, [p])
  }
  const isNear = (n) => {
    const p = at(n)
    const i = Math.floor(p[0] / reach), j = Math.floor(p[1] / reach), k = Math.floor(p[2] / reach)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++)
          for (const q of near.get(`${i + a},${j + b},${k + c}`) ?? []) if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 <= reach * reach) return true
    return false
  }
  const atAHold = fixed.has(worst.node)
  const atALoad = loaded.has(worst.node)
  let away = { sf: Infinity, node: 0, mode: null }
  if (worst.node && isNear(worst.node))
    for (let n = 1; n <= nodes; n++) {
      if (!(sf[n] < away.sf) || isNear(n)) continue
      away = { sf: sf[n], node: n, mode: mode[n] }
    }
  // The outside: the surface's nodes, each quadratic face as four triangles.
  const vid = new Map()
  const order = []
  const index = []
  const SPLIT = [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]]
  for (const face of surface)
    for (const tri of SPLIT)
      for (const k of tri) {
        const n = face.nodes[k]
        if (!vid.has(n)) {
          vid.set(n, order.length)
          order.push(n)
        }
        index.push(vid.get(n))
      }
  const V = order.length
  const positions = new Float32Array(V * 3)
  const field = () => new Float32Array(V)
  const fields = { vonMises: field(), safety: field(), displacement: field(), across: field(), shear: field() }
  order.forEach((n, v) => {
    positions[v * 3] = mesh.xyz[(n - 1) * 3]
    positions[v * 3 + 1] = mesh.xyz[(n - 1) * 3 + 1]
    positions[v * 3 + 2] = mesh.xyz[(n - 1) * 3 + 2]
    fields.vonMises[v] = vm[n]
    fields.safety[v] = Number.isFinite(sf[n]) ? Math.min(sf[n], 1e6) : 1e6
    fields.displacement[v] = disp[n]
    fields.across[v] = across[n]
    fields.shear[v] = shear[n]
  })
  const r3 = (x) => Math.round(x * 1000) / 1000
  return {
    solver: { gmsh: tools.gmsh.version, calculix: tools.ccx.version },
    mesh: { elements: mesh.elements.length / 10, nodes, size: r3(size) },
    material: { id: material.id, label: material.label, density: material.density, Exy: material.Exy, Ez: material.Ez, Xt: material.Xt, Zt: material.Zt, Sz: r3(material.Sz) },
    build: axes.z.map(r3),
    ...(gravity ? { gravity: (() => {
      const grams = (gravity.density * meshVolume(mesh)) / 1000
      return { direction: gravity.direction.map(r3), g: gravity.g, density: r3(gravity.density), mass: r3(grams), weight: r3((grams / 1000) * 9.80665 * gravity.g) }
    })() } : {}),
    groups: { fixtures: fix.map((g, i) => ({ name: g.name ?? `fixture ${i + 1}`, faces: g.faces.length })), loads: ld.map((g, i) => ({ name: g.name ?? `load ${i + 1}`, faces: g.faces.length, ...(g.force ? { force: g.force } : { pressure: g.pressure }) })) },
    worst: {
      safety: Number.isFinite(worst.sf) ? r3(worst.sf) : null,
      at: worst.node ? at(worst.node) : null,
      mode: worst.mode || null,
      atAHold,
      atALoad,
      ...(Number.isFinite(away.sf) ? { awayFromHolds: { safety: r3(away.sf), at: at(away.node), mode: away.mode } } : {}),
      vonMises: r3(maxVm),
      displacement: Math.round(maxDisp * 1e6) / 1e6,
      displacementAt: maxDispNode ? at(maxDispNode) : null,
    },
    ...(warnings.length ? { warnings } : {}),
    surface: {
      encoding: 'base64-le',
      vertices: V,
      triangles: index.length / 3,
      positions: b64(positions),
      index: b64(Uint32Array.from(index)),
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, b64(v)])),
    },
  }
}

/** A surface field of an answer read back (for tests and other readers). */
export function decodeSurface(surface) {
  const f32 = (s) => {
    const b = Buffer.from(s, 'base64')
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  }
  const b = Buffer.from(surface.index, 'base64')
  return {
    positions: f32(surface.positions),
    index: new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
    fields: Object.fromEntries(Object.entries(surface.fields).map(([k, v]) => [k, f32(v)])),
  }
}
