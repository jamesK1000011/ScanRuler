// SPDX-License-Identifier: AGPL-3.0-only
// Tools beyond the page's and the server's own, for the plugins that need
// this computer — a slicer to run, a printer on the network, a part
// catalogue's downloads. Listed only when SCANRULER_MCP_EXTRAS names them
// ("slicer", "catalog", "all"), so the server's own tools stay as they are for
// everyone who does not ask.

import { downloads, openUrl, take } from './catalog.js'
import { detect, job, jobs, KINDS, listProfiles, loadConfig, saveConfig, slice } from './slicer.js'
import * as printer from './printer.js'
import { KINDS as PRINTER_KINDS } from './printers/adapters.js'

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
  if (wanted('catalog')) {
    tool(
      'catalog_open_url',
      'Open a page in the person’s browser',
      'Open a catalogue or library page (catalog_links gives them) in the default browser on this computer, for the person to sign in if the site asks and click download. Only http and https. Nothing is downloaded by this server.',
      obj({ url: { type: 'string', description: 'The page.' } }, ['url']),
      async ({ url }) => openUrl(url, env),
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
  if (wanted('printer')) {
    const name = { type: 'string', description: 'The printer’s name in printers.json; the only one when there is one.' }
    tool('printer_list', 'The printers set up', 'The printers in printers.json (the ScanRuler folder): name, kind, address, whether its secret is set (never the secret), and who starts a print on it; and the kinds there are, with what each needs. Changes nothing.', obj({}), async () => printer.list(env))
    tool(
      'printer_add',
      'Set up a printer',
      `Add a printer to printers.json, or change one by name. kind: ${Object.entries(PRINTER_KINDS).map(([k, v]) => `${k} (${v.label}; needs ${v.needs.join(', ') || 'nothing'}${v.secret ? `; secret: ${v.secret}` : ''})`).join('; ')}. host is an address on the local network (192.0.2.40, or http://name.local:7125). The secret — access code or API key — is never given here: the person sets it in a terminal with the command this answers, and it stays in the Keychain (or a file only they can read). Several printers of different kinds are fine.`,
      obj({ name: { type: 'string', description: 'A name for it: "X1C", "Voron".' }, kind: { type: 'string', enum: Object.keys(PRINTER_KINDS) }, host: { type: 'string' }, port: { type: 'number' }, serial: { type: 'string', description: 'Bambu: the serial number (Settings → Device).' }, folder: { type: 'string', description: 'folder: where to copy files (an SD card path).' }, app: { type: 'string', description: 'bambu-studio: the app, if not BambuStudio.' }, storage: { type: 'string', description: 'prusalink: usb (the default) or local.' }, useAms: { type: 'boolean', description: 'Bambu: print from the AMS.' }, mqttPort: { type: 'number', description: 'Bambu: MQTT port, 8883 unless changed.' }, model: { type: 'string', description: 'Bambu: the model (X1C, P1S, A1, H2D…) — picks how its camera is read.' }, camera: { type: 'string', enum: ['jpeg', 'rtsp', 'none'], description: 'Bambu: jpeg (P1, A1: port 6000) or rtsp (X1, H2D: port 322, needs ffmpeg).' }, user: { type: 'string', description: 'PrusaLink: the user name (usually maker) for a password login; leave out for an API key.' }, ftpPort: { type: 'number', description: 'Bambu: FTPS port, 990 unless changed.' } }, ['name', 'kind']),
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
      'Asks the person to start a file already on the printer (the last upload by default): a dialog on this Mac, or a page in their browser, shows the printer, file, time and filament with Start and Cancel. Nothing starts unless they press Start; this tool cannot start a print, and nothing here can answer the question for them. Returns the request; printer_requests shows the answer.',
      obj({ printer: name, file: { type: 'string', description: 'The file on the printer; the last upload by default.' } }),
      async (a) => printer.start(a, env),
      false,
    )
    tool('printer_requests', 'Start requests and their answers', 'The requests to start a print, newest first: waiting, started, cancelled, expired (after 15 minutes), withdrawn or failed, with what the printer said. withdraw takes back one still waiting.', obj({ withdraw: { type: 'string', description: 'A waiting request’s id.' } }), async ({ withdraw }) => (withdraw ? { withdrawn: printer.withdraw(withdraw), ...printer.requests() } : printer.requests()), false)
    tool('printer_pause', 'Pause a print', 'Pause the print running on the printer.', obj({ name }), async ({ name: n }) => printer.control(n, 'pause', env), false)
    tool('printer_resume', 'Resume a print', 'Resume a paused print. Check the printer first: the person may have paused it for a reason.', obj({ name }), async ({ name: n }) => printer.control(n, 'resume', env), false)
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
