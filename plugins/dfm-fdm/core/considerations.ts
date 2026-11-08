// SPDX-License-Identifier: AGPL-3.0-only
// A design review for a printed part: the questions to ask besides the
// numbers, written here in this plugin's words. ISO/ASTM 52910 is the
// standard on design for additive manufacturing; it is paid, and nothing
// here is taken from its text — the list follows the kinds of
// consideration it is known to cover. Each says whether dfm.check looks at
// it, and which rule does.

export interface Consideration {
  id: string
  topic: string
  ask: string
  /** The rules that check it, if any; none means it is the person's call. */
  checkedBy: string[]
}

export const CONSIDERATIONS: Consideration[] = [
  { id: 'function', topic: 'What the part must do', ask: 'Loads, fits, temperatures, chemicals and how long it must last — written down before the shape is fixed.', checkedBy: [] },
  { id: 'orientation', topic: 'Build orientation and strength', ask: 'Layers are weakest pulled apart: is the part stood up so its main loads run along the layers, not across them?', checkedBy: ['bed-contact', 'tall-thin'] },
  { id: 'supports', topic: 'Supports and where they leave marks', ask: 'Which faces need support, can it be reached and removed, and is it on a face where its marks do not matter?', checkedBy: ['overhang', 'bridge'] },
  { id: 'feature-size', topic: 'Smallest features', ask: 'Walls, pins, holes and lettering no finer than the process makes reliably.', checkedBy: ['thin-wall', 'small-hole'] },
  { id: 'accuracy', topic: 'Accuracy and fits', ask: 'Which dimensions matter, the clearance mating parts get, and which holes are drilled or reamed after printing.', checkedBy: [] },
  { id: 'distortion', topic: 'Warping and shrinkage', ask: 'Large flat areas, sharp corners on the bed and uneven walls warp; material that shrinks needs a chamber or a brim.', checkedBy: ['bed-contact'] },
  { id: 'surface', topic: 'Surface finish', ask: 'Which faces are seen or slide: stair-stepping on shallow slopes, seams and support marks where they show.', checkedBy: [] },
  { id: 'closed-volumes', topic: 'Closed volumes and the mesh', ask: 'No cavities the slicer cannot reach, and a watertight mesh with nothing open or doubled.', checkedBy: ['trapped-volume', 'mesh-health'] },
  { id: 'size', topic: 'Size against the machine', ask: 'Fits the build volume, or is split where joints can carry the load.', checkedBy: ['build-volume'] },
  { id: 'assembly', topic: 'Consolidation and assembly', ask: 'Parts that could print as one, and the ones that must not: inserts, fasteners, parts that move or wear out.', checkedBy: [] },
  { id: 'post', topic: 'After printing', ask: 'Stock left for machining, heat-set inserts and their wall, sanding, painting or annealing.', checkedBy: [] },
  { id: 'material', topic: 'Material', ask: 'Strength, heat, UV, creep under load, and whether it is safe for its use (food, skin).', checkedBy: [] },
  { id: 'cost', topic: 'Time and cost', ask: 'Height drives time; support and solid volume drive material. Is there a lighter infill or a lower stance?', checkedBy: [] },
  { id: 'inspection', topic: 'How it will be checked', ask: 'Which dimensions are measured on the printed part, and how — a scan against the CAD (Print fit) or calipers.', checkedBy: [] },
]

export const CONSIDERATIONS_CITE = 'ISO/ASTM 52910, Additive manufacturing — Design — Requirements, guidelines and recommendations. Named, not reproduced: this list is written in the plugin’s own words.'
