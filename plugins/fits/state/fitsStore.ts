// SPDX-License-Identifier: AGPL-3.0-only
// The Fits workspace's state: the printer's tolerance, the material and
// the fit classes as tested (settings); what the printer does to holes and
// shafts (calibration); the last values each tool was given and what it
// answered; the part planned for fit.apply and what was last made.

import { create } from 'zustand'
import type { FitsPart } from '../core/build'
import { DEFAULT_CALIBRATION, DEFAULT_TOLERANCE, type Calibration, type PairOut, type StackOut } from '../core/fits'
import type { HingePlan, PinPlan, Settings, SnapPlan, TestPlan } from '../core/plans'

export const DEFAULT_SETTINGS: Settings = { tolerance: DEFAULT_TOLERANCE, material: 'petg', classes: {} }

export const TOOLS = ['pair', 'snap', 'hinge', 'pin', 'test', 'stack'] as const
export type Tool = (typeof TOOLS)[number]

/** The values each tool was last given — what the panel shows. */
export type Inputs = Partial<Record<Tool, Record<string, unknown>>>

export interface Answers {
  pair?: PairOut & { tolerance: number }
  snap?: SnapPlan
  hinge?: HingePlan
  pin?: PinPlan
  test?: TestPlan
  stack?: StackOut
}

/** What fit.apply builds: a part and the values it was planned with. */
export interface Planned {
  part: 'coupon' | 'snap' | 'hinge' | 'pin'
  input: Record<string, unknown>
  label: string
  /** The settings or calibration changed since: fit.apply plans it again. */
  stale?: boolean
}

export interface Made {
  part: string
  label: string
  bodies: string[]
  parts: FitsPart[]
}

export interface FitsSaved {
  settings: Settings
  calibration: Calibration
  tool: Tool
  inputs: Inputs
}

interface FitsState extends FitsSaved {
  answers: Answers
  planned: Planned | null
  made: Made | null
  busy: boolean
  status: string
  /** Settings and calibration: one undo step each. */
  set(p: Partial<Pick<FitsSaved, 'settings' | 'calibration'>>): void
  reset(): void
}

export const useFits = create<FitsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  calibration: { ...DEFAULT_CALIBRATION },
  tool: 'pair',
  inputs: {},
  answers: {},
  planned: null,
  made: null,
  busy: false,
  status: '',
  set: (p) => set((s) => ({ ...p, ...(s.planned ? { planned: { ...s.planned, stale: true } } : {}) })),
  reset: () => set({ settings: { ...DEFAULT_SETTINGS }, calibration: { ...DEFAULT_CALIBRATION }, tool: 'pair', inputs: {}, answers: {}, planned: null, made: null, busy: false, status: '' }),
}))

export const savedOf = (s: FitsSaved): FitsSaved => ({ settings: s.settings, calibration: s.calibration, tool: s.tool, inputs: s.inputs })
export const historyOf = (s: FitsSaved) => ({ settings: s.settings, calibration: s.calibration })
