// SPDX-License-Identifier: AGPL-3.0-only
// Model formats ScanRuler's own readers don't take — glTF and GLB, FBX,
// 3DS, Collada, AMF, VRML — read with three.js's loaders and flattened into
// one triangle mesh in millimetres, Z up, every node's transform applied,
// each triangle keeping which part (mesh node) it came from. What comes out
// is handed to the app's own scan and reference readers as STL, so nothing
// past this file knows the model came from anywhere else.
//
// Units and up: each format says, or has a habit. glTF is metres and Y up
// by its specification; Collada says its unit and the loader applies it,
// Y up after the loader; FBX is centimetres and Y up unless the file says
// otherwise (the habit of nearly every exporter — the answer says it was
// assumed); VRML is metres by its specification, Y up; 3DS and AMF are
// taken as millimetres and Z up. The caller can override either.

import * as THREE from 'three'

export type Format = 'glb' | 'gltf' | 'fbx' | '3ds' | 'dae' | 'amf' | 'wrl'
export type Units = 'mm' | 'cm' | 'm' | 'in'
export type Up = 'y' | 'z'

export interface FormatInfo {
  id: Format
  extensions: string[]
  label: string
  units: Units
  up: Up
  /** Why the default: the specification, or a habit. */
  basis: string
  needsDom: boolean
}

export const FORMATS: readonly FormatInfo[] = [
  { id: 'glb', extensions: ['glb'], label: 'glTF binary', units: 'm', up: 'y', basis: 'glTF 2.0 specification', needsDom: false },
  { id: 'gltf', extensions: ['gltf'], label: 'glTF (embedded buffers)', units: 'm', up: 'y', basis: 'glTF 2.0 specification', needsDom: false },
  { id: 'fbx', extensions: ['fbx'], label: 'FBX (binary or ASCII)', units: 'cm', up: 'y', basis: 'the habit of most exporters (FBX’s own default unit is the centimetre)', needsDom: false },
  { id: '3ds', extensions: ['3ds'], label: '3D Studio', units: 'mm', up: 'z', basis: 'no units in the file; taken as millimetres', needsDom: false },
  { id: 'dae', extensions: ['dae'], label: 'Collada', units: 'm', up: 'y', basis: 'the file’s <unit>, applied by the loader', needsDom: true },
  { id: 'amf', extensions: ['amf'], label: 'Additive Manufacturing Format', units: 'mm', up: 'z', basis: 'the AMF default unit', needsDom: true },
  { id: 'wrl', extensions: ['wrl', 'vrml'], label: 'VRML 2.0', units: 'm', up: 'y', basis: 'VRML 97 specification', needsDom: false },
]

export const formatOf = (name: string): FormatInfo | null => {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null
}

const MM_PER: Record<Units, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 }

export interface Part {
  name: string
  triangles: number
}

export interface Flat {
  format: Format
  /** Triangle soup, x y z per corner, mm, Z up. */
  positions: Float32Array
  /** The part of each triangle, an index into parts. */
  partOf: Uint16Array
  parts: Part[]
  units: Units
  unitsAssumed: boolean
  up: Up
  scale: number
  min: [number, number, number]
  max: [number, number, number]
  /** Said when the size looks wrong for the units taken. */
  unitsWarning?: string
}

/** Read a model file into a three.js scene. */
export async function loadScene(bytes: Uint8Array, name: string): Promise<THREE.Object3D> {
  const f = formatOf(name)
  if (!f) throw new Error(`${name}: not a format import-plus reads (${FORMATS.flatMap((x) => x.extensions).join(', ')}).`)
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const text = () => new TextDecoder().decode(bytes)
  switch (f.id) {
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const loader = new GLTFLoader()
      const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => loader.parse(f.id === 'glb' ? buf : text(), '', resolve as never, reject))
      return gltf.scene
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
      return new FBXLoader().parse(buf, '')
    }
    case '3ds': {
      const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js')
      return new TDSLoader().parse(buf, '')
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js')
      const r = new ColladaLoader().parse(text(), '')
      if (!r?.scene) throw new Error(`${name}: not a Collada file the loader reads.`)
      return r.scene
    }
    case 'amf': {
      const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js')
      return new AMFLoader().parse(buf)
    }
    case 'wrl': {
      const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js')
      return new VRMLLoader().parse(text(), '')
    }
  }
}

/** Every mesh of a scene as one triangle soup in millimetres, Z up. */
export function flatten(scene: THREE.Object3D, format: Format, opts: { units?: Units; up?: Up; parts?: string[] } = {}): Flat {
  const info = FORMATS.find((f) => f.id === format)!
  const units = opts.units ?? info.units
  const up = opts.up ?? info.up
  const scale = MM_PER[units]
  scene.updateMatrixWorld(true)
  // Y up to Z up: a quarter turn about X, Y going to Z.
  const toZ = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  const chunks: Float32Array[] = []
  const owners: number[] = []
  const parts: Part[] = []
  const names = new Map<string, number>()
  const v = new THREE.Vector3()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const g = mesh.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position')
    if (!pos) return
    let name = mesh.name || mesh.parent?.name || `part ${parts.length + 1}`
    if (names.has(name)) name = `${name} (${parts.length + 1})`
    if (opts.parts && !opts.parts.includes(name)) return
    const index = g.getIndex()
    const count = index ? index.count : pos.count
    const tris = Math.floor(count / 3)
    if (tris === 0) return
    const m = new THREE.Matrix4().copy(mesh.matrixWorld)
    if (up === 'y') m.premultiply(toZ)
    const out = new Float32Array(tris * 9)
    for (let k = 0; k < tris * 3; k++) {
      const i = index ? index.getX(k) : k
      v.fromBufferAttribute(pos, i).applyMatrix4(m).multiplyScalar(scale)
      out[3 * k] = v.x
      out[3 * k + 1] = v.y
      out[3 * k + 2] = v.z
    }
    // A mirrored transform turns the triangles inside out: wind them back.
    if (m.determinant() < 0)
      for (let t = 0; t < tris; t++) {
        for (let a = 0; a < 3; a++) {
          const x = out[9 * t + 3 + a]
          out[9 * t + 3 + a] = out[9 * t + 6 + a]
          out[9 * t + 6 + a] = x
        }
      }
    names.set(name, parts.length)
    chunks.push(out)
    owners.push(parts.length)
    parts.push({ name, triangles: tris })
  })
  const total = chunks.reduce((s, c) => s + c.length, 0)
  if (total === 0) throw new Error(opts.parts ? 'None of the parts named are meshes in the file.' : 'The file holds no triangle mesh.')
  const positions = new Float32Array(total)
  const partOf = new Uint16Array(total / 9)
  let at = 0
  chunks.forEach((c, j) => {
    positions.set(c, at)
    partOf.fill(owners[j], at / 9, (at + c.length) / 9)
    at += c.length
  })
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a])
      max[a] = Math.max(max[a], positions[i + a])
    }
  const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  const unitsAssumed = opts.units === undefined
  const unitsWarning =
    size < 1 ? `It comes out ${round(size, 4)} mm across — likely bigger units than ${units}: try units m${units === 'm' ? '' : ' or cm'}.`
      : size > 5000 ? `It comes out ${round(size / 1000, 2)} m across — likely smaller units than ${units}: try units mm${units === 'mm' ? '' : ' or cm'}.`
        : undefined
  return { format, positions, partOf, parts, units, unitsAssumed, up, scale, min: min.map((x) => round(x, 4)) as never, max: max.map((x) => round(x, 4)) as never, ...(unitsWarning ? { unitsWarning } : {}) }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/** A triangle soup as binary STL. */
export function toStl(positions: Float32Array, header = 'import-plus'): Uint8Array {
  const tris = positions.length / 9
  const buf = new ArrayBuffer(84 + 50 * tris)
  const view = new DataView(buf)
  new Uint8Array(buf, 0, Math.min(80, header.length)).set(new TextEncoder().encode(header.slice(0, 80)))
  view.setUint32(80, tris, true)
  for (let t = 0; t < tris; t++) {
    const p = positions.subarray(9 * t, 9 * t + 9)
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    const o = 84 + 50 * t
    view.setFloat32(o, nx / l, true)
    view.setFloat32(o + 4, ny / l, true)
    view.setFloat32(o + 8, nz / l, true)
    for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + 4 * k, p[k], true)
  }
  return new Uint8Array(buf)
}
