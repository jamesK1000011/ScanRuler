// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in for tscircuit's command line in the circuit extras' tests. It
// answers --help, --version, build --help and export --help with the shape
// the real tsci's commander help has (the flag and format names taken from
// tscircuit/cli's register.ts files), writes a circuit.json where tsci
// build does (dist/<entry>/circuit.json), and for tsci export writes the
// file asked for — the Gerbers zip with bom.csv and pick_and_place.csv in
// it, as tsci's does. Every run's arguments go to FAKE_TSCI_LOG.
//
// FAKE_TSCI_MODE: "old" — a tsci whose build lacks --routing-disabled and
// whose export lacks glb; "fail" — build writes nothing and exits 1;
// "slow" — build waits 30 s (to be cancelled); "noexport" — export exits 1.
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A small board's Circuit JSON, with one DRC error and one warning. */
export const FIXTURE = [
  { type: 'source_component', source_component_id: 'source_component_0', ftype: 'simple_resistor', name: 'R1', resistance: 1000 },
  { type: 'pcb_board', pcb_board_id: 'pcb_board_0', center: { x: 0, y: 0 }, width: 30, height: 20, thickness: 1.6, num_layers: 2, material: 'fr4' },
  { type: 'pcb_component', pcb_component_id: 'pcb_component_0', source_component_id: 'source_component_0', center: { x: 0, y: 0 }, width: 2.6, height: 1, layer: 'top', rotation: 0 },
  { type: 'pcb_smtpad', pcb_smtpad_id: 'pcb_smtpad_0', shape: 'rect', x: -0.8, y: 0, width: 0.9, height: 0.95, layer: 'top' },
  { type: 'pcb_smtpad', pcb_smtpad_id: 'pcb_smtpad_1', shape: 'rect', x: 0.8, y: 0, width: 0.9, height: 0.95, layer: 'top' },
  { type: 'pcb_trace_error', pcb_trace_error_id: 'pcb_trace_error_0', error_type: 'pcb_trace_error', message: 'Trace too close to pad', pcb_trace_id: 'pcb_trace_0', source_trace_id: 'source_trace_0', pcb_component_ids: [], pcb_port_ids: [] },
  { type: 'pcb_autorouting_warning', message: 'Routing took the long way' },
]

const HELP = `Usage: tsci [options] [command]

CLI for developing tscircuit packages

Options:
  -h, --help                   display help for command

Commands:
  init [options] [directory]   Initialize a new TSCircuit project
  dev [options] [file]         Start development server for a package
  export [options] <file>      Export tscircuit code to various formats
  build [options] [file]       Run tscircuit eval and output circuit json
  snapshot [options] [path]    Generate schematic and PCB snapshots
  version [options]            Print CLI version
  help [command]               display help for command
`

const buildHelp = (old) => `Usage: tsci build [options] [file]

Run tscircuit eval and output circuit json

Arguments:
  file                         Path to the entry file

Options:
  --ci                         Run install and optional prebuild/build commands
  --ignore-errors              Do not exit with code 1 on errors
  --ignore-warnings            Do not log warnings
  --disable-pcb                Disable PCB outputs
${old ? '' : '  --routing-disabled           Disable routing during circuit generation\n'}  --disable-parts-engine       Disable the parts engine
  --kicad-project              Generate KiCad project directories
  --step                       Generate STEP 3D model files for every successful build
  -h, --help                   display help for command
`

const FORMATS = ['json', 'circuit-json', 'drawing-svg', 'system-svg', 'schematic-svg', 'schematic-pdf', 'pcb-svg', 'pcb-png', 'gerbers', 'readable-netlist', 'gltf', 'glb', 'specctra-dsn', 'kicad_sch', 'kicad_pcb', 'kicad_zip', 'altium', 'kicad-library', 'srj', 'step', 'assembly-svg', 'assembly-step', 'component-box-3mf', 'explosion-mp4']
// The format list wraps over lines, as commander wraps a long description.
const exportHelp = (old) => `Usage: tsci export [options] <file>

Export tscircuit code to various formats

Arguments:
  file                         Path to the package file

Options:
  -f, --format <format>        Output format (${FORMATS.filter((f) => !old || f !== 'glb').join(', ').replace(/(.{60}[^,]*,)/g, '$1\n                               ')})
  -o, --output <path>          Output file path
  --layer <layer>              PCB front layer: top or bottom
  --disable-parts-engine       Disable the parts engine
  -h, --help                   display help for command
`

export async function fakeTsci(dir, { mode = '' } = {}) {
  const path = join(dir, 'tsci')
  const zipUrl = new URL('../src/extras/zip.js', import.meta.url).href
  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      "const fs = require('fs'), p = require('path')",
      `const MODE = process.env.FAKE_TSCI_MODE || ${JSON.stringify(mode)}`,
      'const old = MODE === "old"',
      'const a = process.argv.slice(2)',
      'if (process.env.FAKE_TSCI_LOG) fs.appendFileSync(process.env.FAKE_TSCI_LOG, JSON.stringify({ cwd: process.cwd(), args: a }) + "\\n")',
      `const HELP = ${JSON.stringify(HELP)}`,
      `const buildHelp = ${JSON.stringify(buildHelp(false))}, buildHelpOld = ${JSON.stringify(buildHelp(true))}`,
      `const exportHelp = ${JSON.stringify(exportHelp(false))}, exportHelpOld = ${JSON.stringify(exportHelp(true))}`,
      `const FIXTURE = ${JSON.stringify(FIXTURE)}`,
      "if (a[0] === '--version') { console.log('0.1.2446'); process.exit(0) }",
      "if (a[0] === '--help' || a.length === 0) { console.log(HELP); process.exit(0) }",
      "if (a[0] === 'build' && a.includes('--help')) { console.log(old ? buildHelpOld : buildHelp); process.exit(0) }",
      "if (a[0] === 'export' && a.includes('--help')) { console.log(old ? exportHelpOld : exportHelp); process.exit(0) }",
      "if (a[0] === 'build') {",
      "  if (MODE === 'fail') { console.error('Error: Cannot find module ./missing'); process.exit(1) }",
      "  const go = () => {",
      "    const entry = a[1]",
      "    const sub = entry.replace(/(\\.board|\\.circuit)?\\.tsx$/, '')",
      "    const out = p.join(process.cwd(), 'dist', sub)",
      "    fs.mkdirSync(out, { recursive: true })",
      "    fs.writeFileSync(p.join(out, 'circuit.json'), JSON.stringify(FIXTURE))",
      "    console.log('Built ' + entry)",
      "  }",
      "  if (MODE === 'slow') setTimeout(go, 30000)",
      '  else go()',
      '  return',
      '}',
      "if (a[0] === 'export') {",
      "  if (MODE === 'noexport') { console.error('Error exporting'); process.exit(1) }",
      "  const at = (f) => a[a.indexOf(f) + 1]",
      "  const format = at('--format'), out = at('--output')",
      "  JSON.parse(fs.readFileSync(a[1], 'utf8'))",
      "  if (format === 'gerbers') {",
      `    import(${JSON.stringify(zipUrl)}).then(({ zipStore }) => {`,
      "      fs.writeFileSync(out, zipStore([{ name: 'F_Cu.gtl', data: Buffer.from('G04 top copper*\\n') }, { name: 'Edge_Cuts.gm1', data: Buffer.from('G04 edge*\\n') }, { name: 'bom.csv', data: Buffer.from('Designator,Comment,Footprint\\nR1,1k,0603\\n') }, { name: 'pick_and_place.csv', data: Buffer.from('Designator,Mid X,Mid Y,Layer,Rotation\\nR1,0mm,0mm,Top,0\\n') }]))",
      "      console.log('Exported to ' + out + '!')",
      '    })',
      '    return',
      '  }',
      "  fs.writeFileSync(out, format === 'kicad_pcb' ? '(kicad_pcb (version 20240108) (generator tscircuit))\\n' : format === 'step' ? 'ISO-10303-21;\\nEND-ISO-10303-21;\\n' : 'fake ' + format + '\\n')",
      "  console.log('Exported to ' + out + '!')",
      '  return',
      '}',
      "console.error('unknown command ' + a[0]); process.exit(1)",
    ].join('\n'),
  )
  await chmod(path, 0o755)
  return path
}
