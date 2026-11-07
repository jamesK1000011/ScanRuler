// SPDX-License-Identifier: AGPL-3.0-only
// Tools beyond the page's and the server's own, for the plugins that need
// this computer — a slicer to run, a printer on the network, a part
// catalogue with a key. Listed only when SCANRULER_MCP_EXTRAS names them
// ("slicer", "all"), so the server's own tools stay as they are for
// everyone who does not ask.

import { detect, job, jobs, KINDS, listProfiles, loadConfig, saveConfig, slice } from './slicer.js'

export function extrasWanted(env = process.env) {
  const v = String(env.SCANRULER_MCP_EXTRAS ?? '').toLowerCase()
  const list = v.split(/[\s,]+/).filter(Boolean)
  return (name) => list.includes('all') || list.includes(name)
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

export function extraTools({ text, failure }, env = process.env) {
  const wanted = extrasWanted(env)
  const tools = []
  const tool = (name, title, description, inputSchema, call, readOnly = true) =>
    tools.push({
      name,
      title,
      description,
      inputSchema,
      annotations: { readOnlyHint: readOnly, openWorldHint: false },
      call: async (args) => {
        try {
          return text(await call(args ?? {}))
        } catch (e) {
          return failure(e)
        }
      },
    })
  if (wanted('slicer')) {
    tool(
      'slicer_detect',
      'Find the slicers on this computer',
      `Look where OrcaSlicer, Bambu Studio and PrusaSlicer install, run each one found with --help, and say which command-line flags it has of those slicer_slice uses and where its profiles are. save: write them to slicers.json in the ScanRuler folder (SCANRULER_HOME, else ~/.scanruler) as the slicers to use — replacing that list; edit the file to add a slicer elsewhere or set default profiles (defaults: { machine, process, filament } or for PrusaSlicer { printer, print, filament }).`,
      obj({ save: { type: 'boolean', description: 'Write what was found to slicers.json.' } }),
      async ({ save }) => {
        const found = await detect(env)
        const out = { found }
        if (save) {
          const before = (await loadConfig(env)).slicers
          const merged = found.map((f) => ({ ...f, defaults: before.find((b) => b.id === f.id)?.defaults ?? {} }))
          out.saved = await saveConfig(merged, env)
        }
        if (!found.length) out.note = `None found where they install (${Object.values(KINDS).map((k) => k.label).join(', ')}). Add yours to slicers.json by hand: { "slicers": [{ "id": "orca", "kind": "orca", "path": "…", "profileDirs": ["…"] }] }.`
        return out
      },
      false,
    )
    tool('slicer_list', 'The slicers set up', 'The slicers in slicers.json: id, kind, path, version, the flags its --help showed, profile folders and default profiles. Changes nothing.', obj({}), async () => {
      const c = await loadConfig(env)
      return { file: c.file, slicers: c.slicers }
    })
    tool(
      'slicer_profiles',
      'A slicer’s profiles',
      'The profiles in a set-up slicer’s profile folders, by kind: machine, process and filament (OrcaSlicer, Bambu Studio — JSON) or printer, print and filament (PrusaSlicer — INI), each with its name and path. Your own saved presets are there; a system preset that inherits from the slicer’s bundle may need exporting in full from the slicer first. Changes nothing.',
      obj({ slicer: { type: 'string', description: 'The slicer’s id in slicers.json.' } }),
      async ({ slicer }) => {
        const c = await loadConfig(env)
        const s = c.slicers.find((x) => x.id === slicer) ?? (c.slicers.length === 1 ? c.slicers[0] : null)
        if (!s) throw new Error(c.slicers.length ? `No slicer "${slicer}" — have ${c.slicers.map((x) => x.id).join(', ')}.` : 'No slicer is set up — run slicer_detect { save: true } first.')
        return { slicer: s.id, profiles: await listProfiles(s) }
      },
    )
    tool(
      'slicer_slice',
      'Slice a model',
      'Slice a model file (STL, 3MF, STEP — export the part from ScanRuler first with export_stl { path }) with a set-up slicer and its profiles (names from slicer_profiles, or paths; the slicer’s defaults otherwise), with settings overridden by key — fit-comp’s suggested changes (fit_suggest changes: { key: to }) go straight in. The run gets its own job folder (inputs, command line, log, G-code). Returns the job: the slicer’s own totals (seconds, filament mm and g, layers), what the moves count (layers and heights, filament by feature, travel, retractions) and a heuristic stringing indicator, labelled so. Refused, naming the flag, when the installed slicer does not list a flag this needs. Nothing is sent to a printer.',
      obj(
        {
          slicer: { type: 'string', description: 'The slicer’s id in slicers.json; the only one when there is one.' },
          model: { type: 'string', description: 'The model file on this computer.' },
          machine: { type: 'string', description: 'OrcaSlicer / Bambu Studio: the machine profile.' },
          process: { type: 'string', description: 'OrcaSlicer / Bambu Studio: the process profile.' },
          filament: { type: 'string', description: 'The filament profile.' },
          printer: { type: 'string', description: 'PrusaSlicer: the printer profile.' },
          print: { type: 'string', description: 'PrusaSlicer: the print profile.' },
          overrides: { type: 'object', description: 'Settings by key: { "xy_hole_compensation": 0.17, "layer_height": 0.2 }.' },
          name: { type: 'string', description: 'A name for the job folder.' },
        },
        ['model'],
      ),
      async (a) => {
        const r = await slice({ slicerId: a.slicer, model: a.model, machine: a.machine, process: a.process, filament: a.filament, print: a.print, printer: a.printer, overrides: a.overrides ?? {}, name: a.name }, env)
        const { layers, ...rest } = r
        return { ...rest, layerCount: layers.length }
      },
      false,
    )
    tool('slicer_jobs', 'Slicing jobs run', 'The latest 50 jobs in the slices folder, newest first: each with its slicer, model, time and filament. Changes nothing.', obj({}), async () => ({ jobs: await jobs(env) }))
    tool(
      'slicer_result',
      'A slicing job in full',
      'One job: what was run, the totals, the counted moves, the heuristic, and — with layers — every layer’s height and filament. Changes nothing.',
      obj({ job: { type: 'string', description: 'The job id from slicer_slice or slicer_jobs.' }, layers: { type: 'boolean', description: 'Add every layer.' } }, ['job']),
      async ({ job: id, layers }) => {
        const j = await job(id, env)
        if (!layers) delete j.layers
        return j
      },
    )
    tool(
      'slicer_compare',
      'Two slicing jobs side by side',
      'Two jobs compared: time, filament, layers, height, travel, retractions and filament by feature, each before, after and the change — what a setting changed did. Changes nothing.',
      obj({ a: { type: 'string', description: 'The first job.' }, b: { type: 'string', description: 'The second job.' } }, ['a', 'b']),
      async ({ a, b }) => {
        const [x, y] = [await job(a, env), await job(b, env)]
        const pair = (p, q) => ({ a: p ?? null, b: q ?? null, change: p != null && q != null ? Math.round((q - p) * 100) / 100 : null })
        const feats = [...new Set([...Object.keys(x.counted?.byFeatureMm ?? {}), ...Object.keys(y.counted?.byFeatureMm ?? {})])]
        return {
          a: x.job,
          b: y.job,
          overrides: { a: x.overrides, b: y.overrides },
          seconds: pair(x.totals?.seconds, y.totals?.seconds),
          filamentG: pair(x.totals?.filamentG, y.totals?.filamentG),
          filamentMm: pair(x.totals?.filamentMm ?? x.counted?.extrudedFilamentMm, y.totals?.filamentMm ?? y.counted?.extrudedFilamentMm),
          layers: pair(x.counted?.layers, y.counted?.layers),
          heightMm: pair(x.counted?.heightMm, y.counted?.heightMm),
          travelMm: pair(x.counted?.travelMm, y.counted?.travelMm),
          retractions: pair(x.counted?.retractions, y.counted?.retractions),
          byFeatureMm: Object.fromEntries(feats.map((f) => [f, pair(x.counted?.byFeatureMm?.[f], y.counted?.byFeatureMm?.[f])])),
        }
      },
    )
  }
  return tools
}
