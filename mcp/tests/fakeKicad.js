// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in kicad-cli for the Boards extras' tests: it answers `version`
// and each command's --help with the flags that KiCad version's own help
// lists (KiCad 7, 8, 9 and 10, from KiCad's command-line reference), refuses a
// flag its help does not list as the real one does, and writes what the
// real one writes — a STEP, Gerbers named as KiCad names them, drill files
// with plated and unplated holes apart, a placement CSV, a DRC report in
// JSON (exit 5 with violations), a parts list. Each run is logged, one line
// of JSON, to FAKE_KICAD_LOG.
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Each version's flags per command, as its --help lists them. */
export const HELP = {
  7: {
    'pcb export step': ['--help', '--drill-origin', '--grid-origin', '--no-virtual', '--subst-models', '--force', '--board-only', '--min-distance', '--user-origin', '--output'],
    'pcb export gerbers': ['--help', '--output', '--layers', '--exclude-refdes', '--exclude-value', '--include-border-title', '--no-x2', '--no-netlist', '--subtract-soldermask', '--disable-aperture-macros', '--use-drill-file-origin', '--precision', '--no-protel-ext'],
    'pcb export drill': ['--help', '--output', '--format', '--drill-origin', '--excellon-zeros-format', '--excellon-units', '--excellon-mirror-y', '--excellon-min-header', '--excellon-separate-th', '--excellon-oval-format', '--generate-map', '--map-format', '--gerber-precision'],
    'pcb export pos': ['--help', '--output', '--side', '--format', '--units', '--bottom-negate-x', '--use-drill-file-origin', '--smd-only', '--exclude-fp-th', '--gerber-board-edge'],
  },
  8: {
    'pcb export step': ['--help', '--output', '--define-var', '--force', '--grid-origin', '--drill-origin', '--no-unspecified', '--no-dnp', '--subst-models', '--board-only', '--include-tracks', '--include-zones', '--min-distance', '--no-optimize-step', '--user-origin'],
    'pcb export gerbers': ['--help', '--output', '--layers', '--drawing-sheet', '--define-var', '--exclude-refdes', '--exclude-value', '--include-border-title', '--no-x2', '--no-netlist', '--subtract-soldermask', '--disable-aperture-macros', '--use-drill-file-origin', '--precision', '--no-protel-ext', '--common-layers', '--board-plot-params'],
    'pcb export drill': ['--help', '--output', '--format', '--drill-origin', '--excellon-zeros-format', '--excellon-oval-format', '--excellon-units', '--excellon-mirror-y', '--excellon-min-header', '--excellon-separate-th', '--generate-map', '--map-format', '--gerber-precision'],
    'pcb export pos': ['--help', '--output', '--side', '--format', '--units', '--bottom-negate-x', '--use-drill-file-origin', '--smd-only', '--exclude-fp-th', '--exclude-dnp', '--gerber-board-edge'],
    'pcb drc': ['--help', '--output', '--define-var', '--format', '--all-track-errors', '--schematic-parity', '--units', '--severity-all', '--severity-error', '--severity-warning', '--severity-exclusions', '--exit-code-violations'],
    'sch export bom': ['--help', '--output', '--preset', '--format-preset', '--fields', '--labels', '--group-by', '--sort-field', '--sort-asc', '--filter', '--exclude-dnp', '--field-delimiter', '--string-delimiter', '--ref-delimiter', '--ref-range-delimiter', '--keep-tabs', '--keep-line-breaks'],
  },
}
HELP[9] = {
  ...HELP[8],
  'pcb export step': [...HELP[8]['pcb export step'], '--cut-vias-in-body', '--no-board-body', '--no-components', '--component-filter', '--include-pads', '--include-inner-copper', '--include-silkscreen', '--include-soldermask', '--fuse-shapes', '--fill-all-vias', '--net-filter'],
  'pcb export gerbers': [...HELP[8]['pcb export gerbers'], '--sketch-pads-on-fab-layers', '--hide-DNP-footprints-on-fab-layers', '--sketch-DNP-footprints-on-fab-layers', '--crossout-DNP-footprints-on-fab-layers', '--plot-invisible-text'],
  'sch export bom': [...HELP[8]['sch export bom'], '--include-excluded-from-bom'],
}
// KiCad 10 (docs.kicad.org/10.0/en/cli/cli.html): DRC can refill zones and
// save the board, drill gains its report and tenting, Gerbers lose
// --plot-invisible-text and gain --check-zones and --variant, pos and step
// gain --variant (step --no-extra-pad-thickness too).
HELP[10] = {
  ...HELP[9],
  'pcb drc': [...HELP[9]['pcb drc'], '--refill-zones', '--save-board'],
  'pcb export drill': [...HELP[9]['pcb export drill'], '--generate-report', '--report-path', '--generate-tenting'],
  'pcb export gerbers': [...HELP[9]['pcb export gerbers'].filter((f) => f !== '--plot-invisible-text'), '--check-zones', '--variant'],
  'pcb export pos': [...HELP[9]['pcb export pos'], '--variant'],
  'pcb export step': [...HELP[9]['pcb export step'], '--variant', '--no-extra-pad-thickness'],
}

/** The flags that take a value, as kicad-cli reads them. */
const VALUED = ['--output', '--layers', '--user-origin', '--format', '--units', '--side', '--excellon-units', '--fields', '--labels', '--group-by', '--min-distance', '--define-var', '--map-format', '--drill-origin', '--excellon-zeros-format', '--excellon-oval-format', '--precision', '--common-layers', '--drawing-sheet', '--preset', '--format-preset', '--sort-field', '--filter', '--field-delimiter', '--string-delimiter', '--ref-delimiter', '--ref-range-delimiter', '--gerber-precision', '--component-filter', '--net-filter', '--report-path', '--variant']

const SCRIPT = (version, help) => `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const HELP = ${JSON.stringify(help)}
const VALUED = new Set(${JSON.stringify(VALUED)})
const VERSION = ${JSON.stringify(version)}
const a = process.argv.slice(2)
const log = (o) => process.env.FAKE_KICAD_LOG && fs.appendFileSync(process.env.FAKE_KICAD_LOG, JSON.stringify(o) + '\\n')
if (a[0] === 'version') { console.log(VERSION); process.exit(0) }
let cmd = null
for (const k of Object.keys(HELP)) { const w = k.split(' '); if (w.every((x, i) => a[i] === x)) { cmd = k; break } }
if (!cmd) { console.log('Usage: kicad-cli [--help] [--version] {fp,pcb,sch,sym,version}'); process.exit(a.includes('--help') ? 0 : 1) }
const rest = a.slice(cmd.split(' ').length)
if (rest.includes('--help')) { console.log('Usage: kicad-cli ' + cmd + ' ' + HELP[cmd].map((f) => '[' + f + (VALUED.has(f) ? ' VAR' : '') + ']').join(' ') + ' INPUT_FILE'); process.exit(0) }
const flags = {}; const pos = []
for (let i = 0; i < rest.length; i++) {
  const x = rest[i]
  if (x.startsWith('--')) {
    if (!HELP[cmd].includes(x)) { console.error('Unknown argument: ' + x); process.exit(1) }
    flags[x] = VALUED.has(x) ? rest[++i] : true
  } else pos.push(x)
}
log({ cmd, flags, input: pos[0] })
const input = pos[0]
if (!input || !fs.existsSync(input)) { console.error('Board file does not exist or is not accessible'); process.exit(2) }
const name = path.basename(input).replace(/\\.kicad_(pcb|sch)$/, '')
const out = flags['--output']
if (cmd === 'pcb export step') {
  if (process.env.FAKE_KICAD_FAIL === 'step') { console.error('Failed to export STEP'); process.exit(3) }
  console.log('Loading board')
  console.log('Could not add 3D model to J9.')
  fs.writeFileSync(out, 'ISO-10303-21;\\nHEADER;\\n/* fake ' + (flags['--user-origin'] || '') + ' ' + (flags['--board-only'] ? 'board-only' : 'all') + ' */\\nENDSEC;\\nDATA;\\nENDSEC;\\nEND-ISO-10303-21;\\n')
  process.exit(0)
}
if (cmd === 'pcb export gerbers') {
  const ext = { 'F.Cu': 'gtl', 'B.Cu': 'gbl', 'F.Mask': 'gts', 'B.Mask': 'gbs', 'F.SilkS': 'gto', 'B.SilkS': 'gbo', 'F.Paste': 'gtp', 'B.Paste': 'gbp', 'Edge.Cuts': 'gm1' }
  const names = { 'F.SilkS': 'F_Silkscreen', 'B.SilkS': 'B_Silkscreen' }
  for (const l of String(flags['--layers']).split(',')) {
    const inner = /^In(\\d+)\\.Cu$/.exec(l)
    const e = flags['--no-protel-ext'] ? 'gbr' : inner ? 'g' + inner[1] : (ext[l] || 'gbr')
    fs.writeFileSync(path.join(out, name + '-' + (names[l] || l.replace('.', '_')) + '.' + e), 'G04 fake ' + l + '*\\nM02*\\n')
  }
  fs.writeFileSync(path.join(out, name + '-job.gbrjob'), '{}')
  process.exit(0)
}
if (cmd === 'pcb export drill') {
  if (!flags['--excellon-separate-th']) fs.writeFileSync(path.join(out, name + '.drl'), 'M48\\n')
  else { fs.writeFileSync(path.join(out, name + '-PTH.drl'), 'M48\\n;PTH\\n'); fs.writeFileSync(path.join(out, name + '-NPTH.drl'), 'M48\\n;NPTH\\n') }
  if (flags['--generate-map']) for (const k of flags['--excellon-separate-th'] ? ['-PTH', '-NPTH'] : ['']) fs.writeFileSync(path.join(out, name + k + '-drl_map.' + (flags['--map-format'] === 'gerberx2' ? 'gbr' : flags['--map-format'] || 'pdf')), 'G04 map*\\n')
  process.exit(0)
}
if (cmd === 'pcb export pos') {
  fs.writeFileSync(out, 'Ref,Val,Package,PosX,PosY,Rot,Side\\n"J1","USB_C_Receptacle_USB2.0","USB_C_Receptacle_HRO_TYPE-C-31-M-12",125.0000,-103.2000,0.0000,top\\n"J2","Conn_01x04","PinHeader_1x04_P2.54mm_Vertical",103.0000,-116.0000,90.0000,top\\n"R1","10k","R_0603_1608Metric",125.0000,-120.0000,90.0000,top\\n')
  process.exit(0)
}
if (cmd === 'pcb drc') {
  const clean = process.env.FAKE_KICAD_DRC === 'clean'
  fs.writeFileSync(out, JSON.stringify({ $schema: 'https://schemas.kicad.org/drc.v1.json', coordinate_units: 'mm', kicad_version: VERSION, source: path.basename(input), violations: clean ? [] : [{ type: 'clearance', severity: 'error', description: 'Clearance violation (netclass Default clearance 0.2000 mm; actual 0.1500 mm)', items: [{ description: 'Track [GND] on F.Cu', pos: { x: 120.5, y: 110.2 }, uuid: 'a' }, { description: 'Pad 1 [VCC] of R1 on F.Cu', pos: { x: 120.7, y: 110.2 }, uuid: 'b' }] }, { type: 'silk_overlap', severity: 'warning', description: 'Silkscreen overlap', items: [] }], unconnected_items: clean ? [] : [{ type: 'unconnected_items', severity: 'error', description: 'Missing connection between items', items: [] }], schematic_parity: [] }, null, 1))
  process.exit(clean || !flags['--exit-code-violations'] ? 0 : 5)
}
if (cmd === 'sch export bom') {
  const head = flags['--labels'] ? flags['--labels'] : 'Refs,Value,Footprint,Qty,DNP'
  fs.writeFileSync(out, head + '\\n"10k","R1","R_0603_1608Metric",""\\n')
  process.exit(0)
}
process.exit(0)
`

/** A fake kicad-cli of the given major version in dir; its path. */
export async function fakeKicad(dir, major = 9) {
  const help = HELP[major]
  const version = major === 7 ? '7.0.11' : major === 8 ? '8.0.8' : major === 10 ? '10.0.0' : '9.0.2'
  const path = join(dir, 'kicad-cli')
  await writeFile(path, SCRIPT(version, help))
  await chmod(path, 0o755)
  return path
}
