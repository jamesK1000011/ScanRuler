// SPDX-License-Identifier: AGPL-3.0-only
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compatible, licenceFile, readLicence } from '../core/licence'
import { DEFAULT_PACK, plan, platformText, readme } from '../core/plan'
import { scrubFile } from '../core/scrub'

describe('licences', () => {
  it('reads licences as pages write them', () => {
    expect(readLicence('CC BY-SA 4.0')).toBe('CC-BY-SA-4.0')
    expect(readLicence('Creative Commons - Attribution - Non-Commercial')).toBe('CC-BY-NC-4.0')
    expect(readLicence('CC-BY')).toBe('CC-BY-4.0')
    expect(readLicence('Creative Commons Attribution 4.0 International')).toBe('CC-BY-4.0')
    expect(readLicence('cc0')).toBe('CC0-1.0')
    expect(readLicence('Standard Digital File License')).toBe('ARR')
    expect(readLicence('GNU GPL v3')).toBe('GPL-3.0-only')
    expect(readLicence('something odd')).toBeNull()
  })

  it('blocks a CC BY-SA remix released CC BY-NC, and says why', () => {
    const v = compatible('CC-BY-SA-4.0', 'CC-BY-NC-4.0')
    expect(v.ok).toBe(false)
    expect(v.why).toMatch(/ShareAlike/)
    expect(compatible('CC-BY-SA-4.0', 'CC-BY-SA-4.0').ok).toBe(true)
    expect(compatible('CC-BY-SA-4.0', 'GPL-3.0-only').ok).toBe(true)
    expect(compatible('CC-BY-NC-4.0', 'CC0-1.0').why).toMatch(/forbids commercial use/)
    expect(compatible('CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0').ok).toBe(true)
    expect(compatible('CC-BY-ND-4.0', 'CC-BY-4.0').why).toMatch(/only unchanged/)
    expect(compatible('CC-BY-ND-4.0', 'CC-BY-4.0', { modified: false }).ok).toBe(true)
    expect(compatible('CC-BY-4.0', 'ARR').ok).toBe(true)
    expect(compatible('ARR', 'CC-BY-4.0').ok).toBe(false)
    expect(compatible('ARR', 'CC-BY-4.0', { permission: true }).ok).toBe(true)
    expect(compatible(null, 'MIT').ok).toBe(false)
    expect(compatible('MIT', 'CC-BY-4.0').needs).toEqual(['keep its copyright and licence notice'])
  })

  it('writes the LICENSE file', () => {
    expect(licenceFile('CC-BY-SA-4.0', 'Alex', 2026)).toMatch(/Attribution-ShareAlike 4\.0[\s\S]*creativecommons\.org\/licenses\/by-sa\/4\.0/)
    const gpl = readFileSync(join(__dirname, '..', 'licences', 'GPL-3.0.txt'), 'utf8')
    expect(gpl).toMatch(/^\s+GNU GENERAL PUBLIC LICENSE\n\s+Version 3, 29 June 2007/)
    expect(gpl.length).toBe(35149)
    expect(licenceFile('GPL-3.0-only', 'Alex', 2026, gpl)).toContain('END OF TERMS AND CONDITIONS')
    expect(licenceFile('MIT', 'Alex', 2026)).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Alex/)
  })
})

describe('the plan', () => {
  const s = { ...DEFAULT_PACK, title: 'Bracket remix', author: 'Alex', summary: 'A stiffer bracket.', licence: 'CC-BY-NC-4.0' as const }
  const upstream = [
    { part: 'Bracket', body: 'Bracket', title: 'Wall bracket', author: 'maker42', url: 'https://www.printables.com/model/1', licence: 'CC BY-SA 4.0', source: 'printables' },
    { part: 'M5 bolt', body: 'M5 bolt', url: 'https://www.mcmaster.com/91290A228/', source: 'mcmaster', licence: 'n/a' },
    { part: 'Bearing', source: 'thangs', redistribute: false, url: 'https://thangs.com/x' },
  ]

  it('blocks the ShareAlike remix under NC, leaves the McMaster bolt out and links it', () => {
    const p = plan(s, upstream)
    expect(p.ok).toBe(false)
    expect(p.blocked).toEqual([{ part: 'Bracket', why: expect.stringMatching(/ShareAlike/) }])
    expect(p.leftOut.map((x) => [x.part, x.url])).toEqual([
      ['M5 bolt', 'https://www.mcmaster.com/91290A228/'],
      ['Bearing', 'https://thangs.com/x'],
    ])
    const ok = plan({ ...s, licence: 'CC-BY-SA-4.0' }, upstream)
    expect(ok.ok).toBe(true)
    expect(ok.credited[0]).toMatchObject({ part: 'Bracket', author: 'maker42', licence: 'CC BY-SA' })
    const md = readme({ settings: { ...s, licence: 'CC-BY-SA-4.0' }, planned: ok, files: ['files/model.stl'], scrubbed: [], fit: { scaleXY: 1.002, holeOffset: 0.12 }, dfm: { errors: 0, warnings: 2, waived: 1 } })
    expect(md).toMatch(/Remixed from \*\*Wall bracket\*\* by maker42 \(https:\/\/www\.printables\.com\/model\/1\), CC BY-SA\. Changed for this design\./)
    expect(md).toMatch(/## Parts not included[\s\S]*M5 bolt \(mcmaster\): https:\/\/www\.mcmaster\.com/)
    expect(md).toMatch(/hole offset 0\.12 mm/)
    expect(md).toMatch(/0 errors, 2 warnings open, 1 waived/)
    const paste = platformText({ settings: { ...s, licence: 'CC-BY-SA-4.0' }, planned: ok, files: [], scrubbed: [] }, { name: 'Printables', fields: { title: 10, summary: 140 } })
    expect(paste).toMatch(/Title \(10 characters here\): Bracket r…/)
  })

  it('asks for a licence and an author first', () => {
    expect(plan({ ...DEFAULT_PACK }, []).problems).toEqual(['No licence chosen yet: pack.licence { id }.', 'No author (the copyright holder) yet: pack.settings { author }.'])
  })
})

describe('the scrub', () => {
  it('red team: an environment block and key = value lines lose their values, and the key stays readable', () => {
    const env = 'HOME=/x\0GH_TOKEN=ghp_abcdef123456\0CLOUDSDK_AUTH_ACCESS_TOKEN=ya29.zzz\0PATH=/bin\0'
    const out = strFromU8(scrubFile('notes.txt', strToU8(env)).bytes)
    expect(out).not.toMatch(/ghp_abcdef|ya29/)
    expect(out).toContain('GH_TOKEN=')
    const ini = strFromU8(scrubFile('notes.txt', strToU8('api_key = sk-live-123\npassword: hunter2\n')).bytes)
    expect(ini).toBe('api_key = \npassword: \n')
  })

  it('takes the home path, user name, access code, serial and printer address out of a 3MF', () => {
    const project = JSON.stringify({ printer_settings_id: 'Bambu Lab X1 Carbon', print_host: '192.168.1.40', printhost_apikey: 'abc123secret', filament_settings_id: ['PETG'], 'access_code': '87654321', export_path: '/Users/alexuser/Desktop/bracket/bracket.3mf' }, null, 2)
    const model = `<?xml version="1.0"?>\n<config><plate><metadata key="printer_sn" value="01P00A123456789"/><metadata key="dev_ip" value="192.168.1.40"/><metadata key="source_file" value="C:\\Users\\alexuser\\Documents\\bracket.step"/></plate></config>`
    const gcode = `; generated by BambuStudio\n; printer_access_code = 87654321\n; thumbnail\nG28\n; file /home/alexuser/prints/b.gcode\n; owner: alexuser@example.com\n`
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 4, ...strToU8('tEXt'), 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, ...strToU8('IEND'), 0, 0, 0, 0])
    const tmf = zipSync({ 'Metadata/project_settings.config': strToU8(project), 'Metadata/model_settings.config': strToU8(model), 'Metadata/plate_1.gcode': strToU8(gcode), 'Metadata/plate_1.png': png, '3D/3dmodel.model': strToU8('<model unit="millimeter"><metadata name="Designer">alexuser</metadata></model>') })
    const r = scrubFile('bracket.3mf', tmf)
    const back = unzipSync(r.bytes)
    const all = Object.entries(back)
      .filter(([n]) => !n.endsWith('.png'))
      .map(([, b]) => strFromU8(b))
      .join('\n')
    for (const planted of ['87654321', 'abc123secret', '01P00A123456789', '192.168.1.40', '/Users/alexuser', 'C:\\Users', '/home/alexuser', 'alexuser', 'alexuser@example.com']) expect(all, planted).not.toContain(planted)
    expect(all).toContain('PETG')
    expect(all).toContain('G28')
    expect(back['Metadata/plate_1.png'].length).toBe(png.length - 16)
    const kinds = r.changes.map((c) => c.what).sort()
    expect(kinds).toEqual(['absolute paths cut to the file name', 'access codes, keys, tokens or passwords emptied', 'e-mail addresses removed', 'local network addresses removed', 'picture text and EXIF chunks removed', 'printer addresses emptied', 'printer serial numbers emptied', 'the user name replaced'].sort())
  })

  it('empties a STEP header’s author and blanks a binary STL header', () => {
    const step = "ISO-10303-21;\nHEADER;\nFILE_NAME('/Users/alexuser/cad/bracket.step','2026-11-07T10:00:00',('Alex Example'),('Acme Corp'),'OCCT','ScanRuler','');\nENDSEC;\n"
    const s = strFromU8(scrubFile('bracket.step', strToU8(step)).bytes)
    expect(s).toContain("FILE_NAME('bracket.step','2026-11-07T10:00:00',(''),(''),'OCCT','ScanRuler','')")
    const stl = new Uint8Array(84 + 50)
    stl.set(strToU8('exported from /Users/alexuser/x.stl'), 0)
    new DataView(stl.buffer).setUint32(80, 1, true)
    const out = scrubFile('x.stl', stl)
    expect(strFromU8(out.bytes.subarray(0, 80))).not.toContain('alexuser')
    expect(out.changes[0].what).toBe('the STL header blanked')
  })

  it('strips EXIF from a JPEG', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 6, 1, 2, 3, 4, 0xff, 0xe0, 0, 4, 9, 9, 0xff, 0xda, 0, 2, 5, 5, 0xff, 0xd9])
    const r = scrubFile('a.jpg', jpg)
    expect([...r.bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0, 0, 4, 9, 9, 0xff, 0xda, 0, 2, 5, 5, 0xff, 0xd9])
  })
})

describe('stays local', () => {
  it('has no network code', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) {
          if (n !== 'scripts' && n !== 'tests') walk(p)
        } else if (/\.(ts|tsx)$/.test(n)) files.push(p)
      }
    }
    walk(join(__dirname, '..'))
    expect(files.length).toBeGreaterThan(3)
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/)
  })
})
