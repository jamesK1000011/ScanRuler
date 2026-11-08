// SPDX-License-Identifier: AGPL-3.0-only
// Tools beyond the page's and the server's own, for the plugins that need
// this computer — a slicer to run, a printer on the network, a part
// catalogue's downloads, tscircuit's command line. Listed only when
// SCANRULER_MCP_EXTRAS names them ("slicer", "catalog", "circuit", "all"),
// so the server's own tools stay as they are for everyone who does not ask.

import { downloads, openUrl, stopWatch, take, watch, watchStatus } from './catalog.js'
import { librariesStatus, LIBRARIES, modelFiles, searchModels, takeModel } from './models.js'
import { mcmaster, saveSources, loadSources, sourcesStatus, traceparts } from './sources.js'
import { detect, job, jobs, KINDS, listProfiles, loadConfig, saveConfig, slice } from './slicer.js'
import { buildInTurn, circuitTools, files as circuitFiles, newProject, OUTPUTS as CIRCUIT_OUTPUTS, readCircuitFile, TEMPLATES as CIRCUIT_TEMPLATES, templatesInfo } from './circuit.js'
import * as printer from './printer.js'
import { KINDS as PRINTER_KINDS } from './printers/adapters.js'

export function extrasWanted(env = process.env) {
  const v = String(env.SCANRULER_MCP_EXTRAS ?? '').toLowerCase()
  const list = v.split(/[\s,]+/).filter(Boolean)
  return (name) => list.includes('all') || list.includes(name)
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

/** The arguments against a tool's schema, as obj() writes them: the
 *  required ones there, no others, each of its type and enum. A client may
 *  send anything; the functions below take what the schema says. */
export function checkArgs(schema, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const props = schema?.properties ?? {}
  for (const k of schema?.required ?? []) if (a[k] === undefined) throw new Error(`${k} is needed.`)
  for (const [k, v] of Object.entries(a)) {
    const p = props[k]
    if (!p) {
      if (schema?.additionalProperties === false) throw new Error(`${k} is not an input of this tool (it takes ${Object.keys(props).join(', ') || 'none'}).`)
      continue
    }
    if (v === undefined) continue
    const type = p.type
    const ok = type === 'string' ? typeof v === 'string' : type === 'number' ? typeof v === 'number' && Number.isFinite(v) : type === 'boolean' ? typeof v === 'boolean' : type === 'array' ? Array.isArray(v) : type === 'object' ? v && typeof v === 'object' && !Array.isArray(v) : true
    if (!ok) throw new Error(`${k} must be ${type === 'array' ? 'a list' : `a ${type}`}.`)
    if (p.enum && !p.enum.includes(v)) throw new Error(`${k} is one of ${p.enum.join(', ')}.`)
    if (type === 'array' && p.items?.enum) for (const x of v) if (!p.items.enum.includes(x)) throw new Error(`${k}: ${JSON.stringify(x)} is not one of ${p.items.enum.join(', ')}.`)
    if (type === 'array' && p.items?.type === 'string') for (const x of v) if (typeof x !== 'string') throw new Error(`${k} must be a list of strings.`)
  }
  return a
}

/** The tools that reach a site on the internet. */
const OPEN_WORLD = new Set(['catalog_open_url', 'catalog_models_search', 'catalog_models_files', 'catalog_models_take', 'catalog_mcmaster', 'catalog_traceparts'])

export function extraTools({ text, failure, page = null }, env = process.env) {
  const wanted = extrasWanted(env)
  const tools = []
  const tool = (name, title, description, inputSchema, call, readOnly = true) =>
    tools.push({
      name,
      title,
      description,
      inputSchema,
      annotations: { readOnlyHint: readOnly, openWorldHint: OPEN_WORLD.has(name) },
      call: async (args) => {
        try {
          // The catalog's and the circuit tools take only what their schema
          // says (their red-team rounds); the others keep taking what they
          // always took.
          return text(await call(/^(catalog|circuit)_/.test(name) ? checkArgs(inputSchema, args ?? {}) : (args ?? {})))
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
  if (wanted('catalog')) {
    tool(
      'catalog_open_url',
      'Open a page in the person’s browser',
      'Open a catalogue or library page (the page’s catalog.links gives them, through scanruler_batch) in the default browser on this computer, for the person to sign in if the site asks and click download. Only http and https. Nothing is downloaded by this server.',
      obj({ url: { type: 'string', description: 'The page.' }, watch: { type: 'boolean', description: 'Also watch the downloads folder and take what arrives (catalog_watch), with source, licence and redistribute.' }, source: { type: 'string' }, licence: { type: 'string' }, redistribute: { type: 'boolean' }, to: { type: 'string' } }, ['url']),
      async ({ url, watch: w, source, licence, redistribute, to }) => {
        if (!w) return openUrl(url, env)
        // The watch first: a folder that isn't there fails before the
        // browser opens, so trying again does not open a second page.
        let host
        try {
          host = new URL(url).hostname
        } catch {
          throw new Error(`Not a web address: ${url}`)
        }
        const watching = await watch({ source: source ?? host, url, licence, redistribute, to }, env)
        const opened = await openUrl(url, env).catch((e) => {
          stopWatch()
          throw e
        })
        return { ...opened, watching, next: 'When the person clicks download, the file comes into the imports folder by itself; catalog_watch { action: "status" } shows what was taken.' }
      },
      false,
    )
    tool(
      'catalog_watch',
      'Take downloads into the imports folder as they arrive',
      'Watch the downloads folder (SCANRULER_DOWNLOADS, else ~/Downloads): each new CAD file or zip, once it has finished downloading, is taken into the imports folder (to; the ScanRuler folder’s imports/ by default, or the project’s folder) with its source, page and licence recorded, as catalog_take does — so the person only clicks download. action: start (with source, and url, licence, redistribute, minutes — 30 by default), status (what was taken), stop. One watch at a time; a new start replaces it. Files already there when it starts are left alone.',
      obj({ action: { type: 'string', enum: ['start', 'status', 'stop'] }, source: { type: 'string' }, url: { type: 'string' }, licence: { type: 'string' }, redistribute: { type: 'boolean' }, to: { type: 'string' }, minutes: { type: 'number' }, dir: { type: 'string' } }, ['action']),
      async ({ action, ...a }) => (action === 'start' ? watch(a, env) : action === 'stop' ? stopWatch() : watchStatus()),
      false,
    )
    tool(
      'catalog_models_search',
      'Search the model libraries',
      'Search 3D model libraries through their official APIs — Sketchfab (no account needed to search), Thingiverse (an app token), Cults3D (the person’s user name and API key) and Poly Haven (CC0, no account; credit “Powered by Poly Haven”) — at once. Each hit: source, id, name, author, licence, page url, downloadable (Cults3D keeps its files on its site), and with thumbnails: true a small picture. missing names a library whose key is not set and how the person sets it; errors one that failed. Search in the words a listing would use ("608 bearing holder", "M18 battery mount"). catalog_models_files lists a hit’s files; catalog_models_take brings one in. Changes nothing.',
      obj({ query: { type: 'string', description: 'What to look for.' }, sources: { type: 'array', items: { type: 'string', enum: Object.keys(LIBRARIES) }, description: 'Only these libraries.' }, page: { type: 'number', description: 'Page of results, 1 by default.' }, thumbnails: { type: 'boolean', description: 'Include each hit’s picture as data (false by default here).' }, cursors: { type: 'object', description: 'For the next page: the cursors the last answer gave, as given.' } }, ['query']),
      async ({ query, sources, page, thumbnails = false, cursors }) => searchModels({ query, sources, page, thumbnails, ...(cursors ? { cursors } : {}) }, env),
    )
    tool(
      'catalog_models_files',
      'A model’s files',
      'The files a library model offers — Thingiverse: each file the designer uploaded; Sketchfab: glb, gltf or the source upload (needs the person’s Sketchfab token) — with the model’s licence and page. Changes nothing.',
      obj({ source: { type: 'string', enum: Object.keys(LIBRARIES) }, id: { type: 'string' } }, ['source', 'id']),
      async (a) => modelFiles(a, env),
    )
    tool(
      'catalog_models_take',
      'Bring a library model in',
      'Download one of a model’s files (file: its id from catalog_models_files; the first by default) through the library’s API and take it into the imports folder (to), unpacked if a zip, with its source, page and licence in provenance.json beside it — redistribute true only for Creative Commons and public domain. Then open it (scan_open, import_open or reverse_import_step) and record it with the page’s catalog.provenance (through scanruler_batch) so it stays with the project.',
      obj({ source: { type: 'string', enum: Object.keys(LIBRARIES) }, id: { type: 'string' }, file: { type: 'string' }, to: { type: 'string' } }, ['source', 'id']),
      async (a) => takeModel(a, env),
      false,
    )
    tool('catalog_libraries', 'The model libraries set up', 'Which model libraries are set up — Sketchfab, Thingiverse, Cults3D — whether each key is set (never the key), whether it can search and download, and for one not set up, how the person sets its key in a terminal. Changes nothing.', obj({}), async () => librariesStatus(env))
    tool('catalog_sources', 'The catalogue accounts set up', 'Which catalogue connections that need an account are on — McMaster-Carr (client certificate, user, password) and TraceParts (tenant id, API key) — and whether each credential is set, never the credential itself; for one that is off, how to set it up. Changes nothing.', obj({}), async () => sourcesStatus(env))
    tool(
      'catalog_source',
      'Set up a catalogue account',
      'Turn a catalogue connection on or off and say where its non-secret parts are: mcmaster { certPath (the .pfx McMaster issued), user }, traceparts { tenantUid, userEmail (TraceParts links each download to an account), cultureInfo (en) }. The passwords and keys are never given here: the person sets them in a terminal (catalog_sources says how).',
      obj({ source: { type: 'string', enum: ['mcmaster', 'traceparts'] }, enabled: { type: 'boolean' }, certPath: { type: 'string' }, user: { type: 'string' }, tenantUid: { type: 'string' }, userEmail: { type: 'string' }, cultureInfo: { type: 'string' } }, ['source']),
      async ({ source, ...a }) => {
        if (source !== 'mcmaster' && source !== 'traceparts') throw new Error('source is mcmaster or traceparts.')
        const now = (await loadSources(env))[source] ?? {}
        const keep = source === 'mcmaster' ? ['enabled', 'certPath', 'user'] : ['enabled', 'tenantUid', 'userEmail', 'cultureInfo']
        if (a.enabled !== undefined) a.enabled = a.enabled === true
        await saveSources({ [source]: { ...now, ...Object.fromEntries(Object.entries(a).filter(([k, v]) => keep.includes(k) && v !== undefined)) } }, env)
        return sourcesStatus(env)
      },
      false,
    )
    tool(
      'catalog_mcmaster',
      'Fetch a McMaster-Carr part’s CAD file',
      'With McMaster’s Product Information API (an approved customer’s certificate and login, catalog_sources): the part number’s CAD file — STEP by default, or another format its page offers (format: "STEP", "SLDPRT", "DWG"…) — brought into the imports folder (to) with its provenance, marked not to be shared on. Returns the part’s description, status and the file taken.',
      obj({ part: { type: 'string', description: 'The McMaster part number: 91290A115.' }, format: { type: 'string' }, to: { type: 'string' } }, ['part']),
      async (a) => mcmaster(a, env),
      false,
    )
    tool(
      'catalog_traceparts',
      'Fetch a TraceParts part’s CAD file',
      'With the TraceParts API Gateway (tenant id and API key, catalog_sources): a part number in a supplier’s catalog, its CAD file requested in a format it offers (STEP by default), waited for and brought into the imports folder (to) with its provenance, marked not to be shared on. TraceParts’ terms: for computer-aided design only; credit "Powered by TraceParts" where you show it.',
      obj({ partNumber: { type: 'string' }, catalog: { type: 'string', description: 'The supplier’s catalog, as TraceParts names it.' }, format: { type: 'string' }, to: { type: 'string' } }, ['partNumber', 'catalog']),
      async (a) => traceparts(a, env),
      false,
    )
    tool(
      'catalog_downloads',
      'New CAD files in the downloads folder',
      'The CAD files (STL, STEP, 3MF, OBJ, GLB, FBX … ) and zips that arrived in the person’s downloads folder (SCANRULER_DOWNLOADS, else ~/Downloads) in the last sinceMinutes (120), newest first. Changes nothing.',
      obj({ dir: { type: 'string', description: 'Another folder to look in.' }, sinceMinutes: { type: 'number', description: 'How far back, minutes.' } }),
      async ({ dir, sinceMinutes }) => downloads({ dir, sinceMinutes }, env),
    )
    tool(
      'catalog_take',
      'Bring a download into the imports folder',
      'Copy a downloaded CAD file — or the CAD files inside a downloaded zip — into an imports folder (to; the ScanRuler folder’s imports/ by default, or the project’s own folder from scanruler_status), never overwriting, and record in that folder’s provenance.json where it came from: source, page, licence, whether it may be shared on (false unless its licence says so). Returns the files taken.',
      obj(
        {
          file: { type: 'string', description: 'The download, from catalog_downloads.' },
          to: { type: 'string', description: 'The imports folder.' },
          source: { type: 'string', description: 'Where it came from: traceparts, mcmaster, misumi, printables, thangs, grabcad, or a name.' },
          url: { type: 'string', description: 'The page it came from.' },
          licence: { type: 'string', description: 'Its licence, as the page says.' },
          redistribute: { type: 'boolean', description: 'May it be shared on.' },
          note: { type: 'string', description: 'Anything else.' },
        },
        ['file', 'source'],
      ),
      async (a) => take(a, env),
      false,
    )
  }
  if (wanted('circuit')) {
    const project = { type: 'string', description: 'A project’s name (in the circuits folder; circuit_files lists them) or its folder.' }
    tool(
      'circuit_tools',
      'tscircuit on this computer',
      'Whether tscircuit’s command line (tsci) is found — SCANRULER_TSCI, a project’s node_modules, the PATH, npm’s global folder, Bun’s and nvm’s, else bunx — its version, the build flags and export formats its --help lists, and how to install it when not (npm install -g tscircuit). Also the project templates circuit_new makes and their values. Changes nothing.',
      obj({}),
      async () => ({ ...(await circuitTools(env)), templates: templatesInfo() }),
    )
    tool(
      'circuit_new',
      'Start a circuit board project',
      `Make a tscircuit project folder from a template — package.json, tsconfig.json and the board in index.circuit.tsx, as tsci init lays one out, made here without the network: ${Object.entries(CIRCUIT_TEMPLATES).map(([id, t]) => `${id} (${t.label})`).join(', ')}. params sets the template’s values (circuit_tools lists them; lengths in mm). In the circuits folder of the ScanRuler folder unless dir is given. Refuses a folder that holds files already. Edit the .tsx, then circuit_build.`,
      obj({ name: { type: 'string', description: 'The project’s name and folder: letters, digits, . _ -.' }, template: { type: 'string', enum: Object.keys(CIRCUIT_TEMPLATES), description: 'blank by default.' }, params: { type: 'object', description: 'The template’s values by key.' }, dir: { type: 'string', description: 'The folder to make it in, if not the circuits folder.' } }, ['name']),
      async (a) => newProject(a, env),
      false,
    )
    tool(
      'circuit_build',
      'Build a circuit board project',
      `Run tsci build on a project, then tsci export from the circuit.json it writes for each output asked for — ${Object.keys(CIRCUIT_OUTPUTS).join(', ')} (bom and pnp come out of the Gerbers zip) — into a job folder of its own (circuits/builds/), with the command lines and the log. Every flag and format is checked against the installed tsci’s --help first and refused by name if it lacks one. Returns the job: its files, and what the build said was wrong (its DRC, routing and placement errors and warnings). The Circuit workspace’s circuit.open { job } brings the board in. routing: false skips the autorouter; partsEngine: false skips the parts lookup (no network).`,
      obj({ project, entry: { type: 'string', description: 'The board file, relative to the project; package.json’s main or index.circuit.tsx otherwise.' }, outputs: { type: 'array', items: { type: 'string', enum: Object.keys(CIRCUIT_OUTPUTS) }, description: 'Files beside circuit.json.' }, routing: { type: 'boolean', description: 'Autoroute (true, the default).' }, partsEngine: { type: 'boolean', description: 'Look parts up (true, the default).' }, name: { type: 'string', description: 'A name for the job folder.' } }, ['project']),
      async (a) => buildInTurn(a, env),
      false,
    )
    tool(
      'circuit_files',
      'Circuit projects, builds and their files',
      'With nothing: the projects (in the circuits folder, and those made or built elsewhere) and the latest 50 builds. With project or job: its files and sizes. Changes nothing.',
      obj({ project, job: { type: 'string', description: 'A build’s job id.' } }),
      async (a) => circuitFiles(a, env),
    )
    tool(
      'circuit_read',
      'Read a circuit project’s or build’s file',
      'A text file of a project or build — circuit.json, the .tsx, bom.csv, pick_and_place.csv, a .kicad_pcb, the log — relative to project or job, or by its full path inside one. A zip lists what it holds; entry reads one of its text files. Only projects and builds this server made or built are read. Changes nothing.',
      obj({ path: { type: 'string', description: 'The file.' }, project, job: { type: 'string', description: 'A build’s job id.' }, entry: { type: 'string', description: 'A file inside a zip.' } }, ['path']),
      async (a) => readCircuitFile(a, env),
    )
  }
  if (wanted('printer')) {
    const name = { type: 'string', description: 'The printer’s name in printers.json; the only one when there is one.' }
    tool('printer_list', 'The printers set up', 'The printers in printers.json (the ScanRuler folder): name, kind, address, whether its secret is set (never the secret), and who starts a print on it; and the kinds there are, with what each needs. Changes nothing.', obj({}), async () => printer.list(env))
    tool(
      'printer_add',
      'Set up a printer',
      `Add a printer to printers.json, or change one by name. kind: ${Object.entries(PRINTER_KINDS).map(([k, v]) => `${k} (${v.label}; needs ${v.needs.join(', ') || 'nothing'}${v.secret ? `; secret: ${v.secret}` : ''})`).join('; ')}. host is an address on the local network (192.0.2.40, or http://name.local:7125). The secret — access code or API key — is never given here: the person sets it in a terminal with the command this answers, and it stays in the Keychain (or a file only they can read). Several printers of different kinds are fine.`,
      obj({ name: { type: 'string', description: 'A name for it: "X1C", "Voron".' }, kind: { type: 'string', enum: Object.keys(PRINTER_KINDS) }, host: { type: 'string' }, port: { type: 'number' }, serial: { type: 'string', description: 'Bambu: the serial number (Settings → Device).' }, folder: { type: 'string', description: 'folder: where to copy files (an SD card path).' }, app: { type: 'string', description: 'bambu-studio: the app, if not BambuStudio.' }, storage: { type: 'string', description: 'prusalink: usb (the default) or local.' }, useAms: { type: 'boolean', description: 'Bambu: print from the AMS.' }, mqttPort: { type: 'number', description: 'Bambu: MQTT port, 8883 unless changed.' }, model: { type: 'string', description: 'Bambu: the model (X1C, P1S, A1, H2D…) — picks how its camera is read.' }, camera: { type: 'string', enum: ['jpeg', 'rtsp', 'none'], description: 'Bambu: jpeg (P1, A1: port 6000) or rtsp (X1, H2D: port 322, needs ffmpeg).' }, user: { type: 'string', description: 'PrusaLink: the user name (usually maker) for a password login; leave out for an API key.' }, confirm: { type: 'string', enum: ['dialog', 'app', 'page'], description: 'Where the person is asked to start a print on this printer: a dialog on the Mac, a card in ScanRuler, or a page in the browser; SCANRULER_CONFIRM, else dialog on a Mac, by default.' }, ftpPort: { type: 'number', description: 'Bambu: FTPS port, 990 unless changed.' } }, ['name', 'kind']),
      async (a) => printer.add(a, env),
      false,
    )
    tool('printer_remove', 'Remove a printer', 'Take a printer out of printers.json. Its secret stays where the person put it until they remove it.', obj({ name }, ['name']), async ({ name: n }) => printer.remove(n, env), false)
    tool('printer_test', 'Check a printer can be reached', 'Connect to the printer and read its state. For a Bambu printer this also pins its certificate the first time (trust: true pins a new one after a reset). Sends no command.', obj({ name, trust: { type: 'boolean' } }), async ({ name: n, trust }) => printer.test(n, { trust }, env), false)
    tool('printer_status', 'What a printer is doing', 'The printer’s state (idle, printing, paused, finished, failed), progress, time left, file, layer and temperatures, as far as its kind tells. Changes nothing.', obj({ name }), async ({ name: n }) => printer.status(n, env))
    tool(
      'printer_upload',
      'Put a sliced job on a printer',
      'Send a file to the printer, or open it in Bambu Studio for a bambu-studio printer — a slicer job by id (slicer_jobs; its 3MF for a Bambu printer, else its G-code) or a file path. Does not start it.',
      obj({ printer: name, job: { type: 'string', description: 'A job from slicer_jobs.' }, file: { type: 'string', description: 'Or a G-code or 3MF file.' } }),
      async (a) => printer.upload(a, env),
      false,
    )
    tool(
      'printer_start',
      'Ask the person to start a print',
      'Asks the person to start a file already on the printer (the last upload by default): a dialog on this Mac, a card in ScanRuler (SCANRULER_CONFIRM=app), or a page in their browser, shows the printer, file, time and filament with Start and Cancel. Nothing starts unless they press Start; this tool cannot start a print, and nothing here can answer the question for them. Returns the request; printer_requests shows the answer.',
      obj({ printer: name, file: { type: 'string', description: 'The file on the printer; the last upload by default.' } }),
      async (a) => printer.start(a, env, process.platform, page),
      false,
    )
    tool('printer_requests', 'Start requests and their answers', 'The requests to start a print, newest first: waiting, started, cancelled, expired (after 15 minutes), withdrawn or failed, with what the printer said. withdraw takes back one still waiting.', obj({ withdraw: { type: 'string', description: 'A waiting request’s id.' } }), async ({ withdraw }) => (withdraw ? { withdrawn: printer.withdraw(withdraw), ...printer.requests() } : printer.requests()), false)
    tool('printer_pause', 'Pause a print', 'Pause the print running on the printer.', obj({ name }), async ({ name: n }) => printer.control(n, 'pause', env), false)
    tool('printer_resume', 'Resume a print', 'Ask the person to resume a paused print — they may have paused it for a reason, so it resumes only when they say so, like printer_start. printer_requests shows the answer.', obj({ name }), async ({ name: n }) => printer.control(n, 'resume', env, process.platform, page), false)
    tool('printer_stop', 'Stop a print', 'Stop (cancel) the print running on the printer. It cannot be resumed.', obj({ name }), async ({ name: n }) => printer.control(n, 'stop', env), false)
    tools.push({
      name: 'printer_camera',
      title: 'A picture from the printer’s camera',
      description: 'A snapshot from the printer’s camera: Moonraker and OctoPrint webcams; a Bambu printer’s own camera (P1 and A1 on port 6000; X1 and H2D over RTSP, which needs ffmpeg). Changes nothing.',
      inputSchema: obj({ name }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      call: async (args) => {
        try {
          const shot = await printer.camera(args?.name, env)
          return { content: [{ type: 'image', data: Buffer.from(shot.bytes).toString('base64'), mimeType: shot.mimeType }] }
        } catch (e) {
          return failure(e)
        }
      },
    })
  }
  return tools
}
