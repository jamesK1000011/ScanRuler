// SPDX-License-Identifier: AGPL-3.0-only
// The printed materials the workspaces share: one id, one label and one
// density each, so Mass and Strength name and weigh a part alike. Densities
// are g/cm³, solid, typical figures from makers' datasheets. The agent's
// server keeps its own copy, with the stiffness and strength (mcp/src/
// extras/fea.js MATERIALS); plugins/fea/tests/fea.test.ts holds it to this
// one, reading the server's file as text.

export const MATERIALS = {
  pla: { label: 'PLA', density: 1.24 },
  petg: { label: 'PETG', density: 1.27 },
  abs: { label: 'ABS', density: 1.04 },
  asa: { label: 'ASA', density: 1.07 },
  'petg-cf': { label: 'PETG-CF', density: 1.3 },
  'pa6-cf': { label: 'PA6-CF', density: 1.17 },
  'tpu-95a': { label: 'TPU 95A', density: 1.21 },
} as const satisfies Record<string, { label: string; density: number }>

export type MaterialId = keyof typeof MATERIALS

/** Every material's id, in the order the lists show them. */
export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[]

/** Older names still taken: a project or command from before the lists
 *  were one. */
export const MATERIAL_ALIASES: Readonly<Record<string, MaterialId>> = {
  tpu: 'tpu-95a',
}

/** Every name a command takes for a material: the ids and the aliases. */
export const MATERIAL_NAMES: string[] = [...MATERIAL_IDS, ...Object.keys(MATERIAL_ALIASES)]

/** A material's id from its id or an alias; undefined for neither. */
export function materialId(name: unknown): MaterialId | undefined {
  if (typeof name !== 'string') return undefined
  if (Object.hasOwn(MATERIALS, name)) return name as MaterialId
  return Object.hasOwn(MATERIAL_ALIASES, name) ? MATERIAL_ALIASES[name] : undefined
}

/** A material's solid density, g/cm³, by id or alias. */
export const densityOf = (name: unknown): number | undefined => {
  const id = materialId(name)
  return id ? MATERIALS[id].density : undefined
}
