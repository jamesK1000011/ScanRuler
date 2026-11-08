// SPDX-License-Identifier: AGPL-3.0-only
// The manual as one self-contained HTML file: a cover with the bill of
// materials and the steps' contents, then a step a section — its drawing,
// the parts it takes with their balloons, tools, torque, notes and the
// instructions one to a line. Styled by the theme (themes.ts) for a screen
// and for print, a step a page. No scripts, no fonts, nothing fetched: it
// opens anywhere and prints as it shows.

import { toSvg, type Mark, type Sheet } from '../../_shared/lineart/sheet'
import { bom, subAssemblies } from './assembly'
import { hardwareOutline, icon, SIGNAL_STYLE } from './extras'
import { pack } from './layout'
import { pageSize, stepLabels, takes } from './manual'
import type { AsmSettings, IconId, Part, Step } from './model'
import { themeOf, type Theme } from './themes'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

import { sentences } from './extras'

export { sentences }

function css(t: Theme): string {
  return `
:root{--accent:${t.accent};--ink:${t.ink};--muted:${t.muted};--paper:${t.paper};--rule:${t.rule};--wash:${t.wash};--font:${t.font};--heading:${t.heading};--mono:${t.mono}}
*{box-sizing:border-box}
html{font-size:${t.size}px;-webkit-text-size-adjust:100%}
body{margin:0;background:color-mix(in srgb,var(--rule) 35%,var(--paper));color:var(--ink);font-family:var(--font);line-height:1.5;font-feature-settings:"tnum" 1}
main{max-width:64rem;margin:0 auto;padding:2.5rem 1.25rem 4rem;display:flex;flex-direction:column;gap:1.75rem}
.sheet{background:var(--paper);border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 28px rgba(0,0,0,.08);padding:2.25rem 2.5rem}
h1,h2,h3{font-family:var(--heading);line-height:1.15;margin:0}
h1{font-size:2.4rem;font-weight:700;letter-spacing:-.01em}
.kicker{display:block;width:3.5rem;height:.3rem;background:var(--accent);margin-bottom:1.25rem;border-radius:2px}
.meta{color:var(--muted);margin:.5rem 0 2rem;font-size:.95rem}
h2.label{font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:2rem 0 .75rem}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th{font-family:var(--heading);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);text-align:left;font-weight:600;padding:.4rem .6rem;border-bottom:2px solid var(--ink)}
td{padding:.55rem .6rem;border-bottom:1px solid var(--rule);vertical-align:middle}
td.qty,td.item{white-space:nowrap;width:1%}
td.qty{font-family:var(--mono);font-size:.85rem}
td.des,td.src{color:var(--muted)}
.balloon{display:inline-flex;align-items:center;justify-content:center;min-width:1.6rem;height:1.6rem;padding:0 .3rem;border-radius:999px;font-family:var(--heading);font-weight:700;font-size:.8rem;line-height:1}
.balloons-filled .balloon{background:var(--accent);color:#fff}
.balloons-outline .balloon{border:1.5px solid var(--accent);color:var(--accent);background:var(--paper)}
ol.contents{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem}
ol.contents a{display:flex;gap:.6rem;align-items:baseline;text-decoration:none;color:var(--ink);padding:.5rem .7rem;border:1px solid var(--rule);border-radius:4px}
ol.contents a:hover{border-color:var(--accent)}
ol.contents b{font-family:var(--mono);color:var(--accent);font-weight:600}
ol.contents span{color:var(--muted);font-size:.88rem}
.step{display:grid;grid-template-columns:minmax(0,1fr) 15rem;grid-template-areas:"head head" "fig side" "warn warn" "do do";gap:1.25rem 2rem}
.step header{grid-area:head;display:flex;align-items:center;gap:1rem;padding-bottom:.9rem;border-bottom:1px solid var(--rule)}
.step header .of{margin-left:auto;font-family:var(--mono);font-size:.8rem;color:var(--muted)}
.badge-box .num{display:inline-flex;align-items:center;justify-content:center;width:2.8rem;height:2.8rem;background:var(--accent);color:#fff;font-family:var(--heading);font-weight:700;font-size:1.5rem;border-radius:4px}
.step header .what{font-family:var(--heading);font-weight:700;font-size:1.25rem}
.badge-box .word,.badge-big .word{display:none}
.badge-big .num{font-family:var(--heading);font-weight:800;font-size:4.2rem;line-height:.9;color:var(--accent);letter-spacing:-.03em}
.badge-big .what{font-weight:600;color:var(--muted)}
.badge-plain .num{display:none}
.badge-plain .word{font-family:var(--heading);font-size:.85rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.badge-plain .word::after{content:" " attr(data-n)}
.badge-plain .what{font-size:1.05rem;font-weight:600}
.step label.done{display:flex;align-items:center;gap:.4rem;font-size:.8rem;color:var(--muted);cursor:pointer;user-select:none}
.step:has(label.done input:checked){opacity:.45}
figure{grid-area:fig;margin:0}
figure svg{display:block;width:100%;height:auto}
aside.side{grid-area:side;display:flex;flex-direction:column;gap:1.1rem;font-size:.92rem}
aside.side h3{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:.45rem}
ul.parts,ul.tools{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
ul.parts li{display:grid;grid-template-columns:auto 1fr;gap:.1rem .6rem;align-items:center}
ul.parts .name{font-weight:600}
ul.parts .des{grid-column:2;color:var(--muted);font-size:.82rem;font-family:var(--mono)}
ul.tools li::before{content:"";display:inline-block;width:.45rem;height:.45rem;border:1.5px solid var(--accent);border-radius:1px;margin-right:.55rem;vertical-align:middle}
.torque{font-family:var(--mono);font-size:.95rem;padding:.45rem .6rem;border-left:3px solid var(--accent);background:var(--wash)}
.note{font-size:.88rem;padding:.6rem .75rem;background:var(--wash);border-radius:4px}
.note::before{content:"Note";display:block;font-family:var(--heading);font-weight:700;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:.2rem}
ol.do{grid-area:do;margin:0;padding:1rem 0 0;border-top:1px solid var(--rule);list-style:none;counter-reset:do;display:flex;flex-direction:column;gap:.45rem;font-size:1.08rem}
ol.do li{counter-increment:do;display:grid;grid-template-columns:2rem 1fr}
ol.do li::before{content:counter(do,lower-alpha) ".";color:var(--accent);font-family:var(--heading);font-weight:700}
ol.do.one li{grid-template-columns:1fr}
ol.do.one li::before{content:none}
footer{text-align:center;color:var(--muted);font-size:.78rem}
.z535{border:2px solid var(--zb);border-radius:3px;overflow:hidden;font-size:.95rem}
.z535 b{display:flex;align-items:center;gap:.45rem;background:var(--zb);color:var(--zi);font-family:var(--heading);letter-spacing:.06em;padding:.25rem .6rem}
.z535 b svg{width:1.05em;height:1.05em}
.z535 p{margin:0;padding:.5rem .7rem}
.warnings{grid-area:warn;display:flex;flex-direction:column;gap:.5rem}
.icons{display:flex;gap:.4rem}
.icons svg{width:2.1rem;height:2.1rem}
.step.sub{background:var(--wash);outline:2px solid var(--accent);outline-offset:-2px}
.step.sub .subname{font-family:var(--heading);font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.subtag{display:inline-flex;align-items:center;padding:0 .45rem;height:1.6rem;border:1.5px solid var(--accent);border-radius:3px;color:var(--accent);font-family:var(--heading);font-weight:700;font-size:.78rem}
.facts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem 2rem;margin-top:1.5rem}
.facts h3{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:.3rem}
.facts p{margin:0;font-size:.95rem}
.hardware .bar{display:flex;align-items:center;gap:.8rem;color:var(--muted);font-size:.85rem;margin:.6rem 0 1.4rem}
.hardware ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:1.4rem 2.4rem;align-items:center}
.hardware li{display:flex;align-items:center;gap:.8rem}
.hardware .q{font-family:var(--heading);font-weight:700;color:var(--accent)}
.hardware .d{font-family:var(--mono);font-size:.8rem;color:var(--muted)}
.hardware svg{display:block}
.pp{display:contents}
@media print{
  .pp{display:grid;gap:6mm;height:calc(100vh - 1mm);break-after:page;overflow:hidden}
  .pp .sheet.step{break-after:auto;height:auto;min-height:0;overflow:hidden}
  .pp.n2{grid-template-columns:var(--pp2c);grid-template-rows:var(--pp2r)}
  .pp.n3,.pp.n4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
  .pp.n5,.pp.n6{grid-template-columns:var(--pp6c);grid-template-rows:var(--pp6r)}
  .pp.multi .step{font-size:.72em;gap:.6rem 1rem;grid-template-columns:minmax(0,1fr) 11rem}
  .pp.multi .step figure svg{max-height:40vh}
  .words-hide ol.do{display:none}
}
@media (max-width:760px){.sheet{padding:1.4rem 1.2rem}.step{grid-template-columns:1fr;grid-template-areas:"head" "fig" "side" "warn" "do"}h1{font-size:1.9rem}}
@media print{
  @page{margin:12mm}
  body{background:none}
  main{max-width:none;padding:0;gap:0}
  .sheet{box-shadow:none;border-radius:0;padding:0;break-after:page}
  .sheet:last-of-type{break-after:auto}
  .step{break-inside:avoid}
  nav,footer,label.done{display:none}
  .step:has(label.done input:checked){opacity:1}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`
}

const balloon = (n: number) => `<span class="balloon">${n}</span>`

/** A pictogram or the alert symbol as a small inline SVG. */
function pictogram(id: IconId): string {
  const marks: Mark[] = []
  icon(marks, id, 0, 0, 10)
  return toSvg({ w: 10, h: 10, marks }).replace(/ width="[^"]*mm" height="[^"]*mm"/, ` role="img" aria-label="${id.replace(/-/g, ' ')}"`).replace(/<rect [^>]*fill="#ffffff"\/>/, '')
}
const alertSvg = (ink: string, band: string) =>
  `<svg viewBox="0 0 10 9" aria-hidden="true"><path d="M5 0L10 9H0Z" fill="${ink}"/><text x="5" y="8" font-size="6.5" font-weight="bold" text-anchor="middle" fill="${band}" font-family="Helvetica,Arial,sans-serif">!</text></svg>`

function warningsHtml(ws: Step['warnings']): string {
  if (!ws?.length) return ''
  return `<div class="warnings">${ws
    .map((w) => {
      const st = SIGNAL_STYLE[w.level]
      return `<div class="z535 ${w.level}" role="note" style="--zb:${st.band};--zi:${st.ink}"><b>${st.alert ? alertSvg(st.ink, st.band) : ''}${st.word}</b><p>${esc(w.text)}</p></div>`
    })
    .join('')}</div>`
}

export function html(s: AsmSettings, parts: Part[], steps: Step[], figures: Sheet[]): string {
  const t = themeOf(s)
  const all = bom(parts)
  const subs = subAssemblies(steps)
  const labels = stepLabels(steps)
  const rows = all
    .map((r) => `<tr><td class="item">${balloon(r.item)}</td><td class="qty">${r.qty}×</td><td>${esc(r.name)}</td><td class="des">${esc(r.designation ?? '')}</td><td class="src">${esc(r.source ?? '')}</td></tr>`)
    .join('\n')
  const summary = (st: Step) =>
    takes(st, parts, subs)
      .map((x) => (x.sub ? x.sub : `${x.n > 1 ? `${x.n}× ` : ''}${x.row?.name ?? ''}`))
      .join(', ')
  const contents = steps
    .map((st, i) => `<li><a href="#step-${i + 1}"><b>${labels[i].padStart(2, '0')}</b><span>${esc(summary(st))}</span></a></li>`)
    .join('\n')
  const section = (st: Step, i: number) => {
    const said = sentences(st.text ?? '')
    const side = [
      `<div><h3>Parts</h3><ul class="parts">${takes(st, parts, subs)
        .map((x) =>
          x.sub
            ? `<li><span class="subtag">${esc(x.sub)}</span><span class="name">Sub-assembly</span></li>`
            : `<li>${balloon(x.item)}<span class="name">${x.n}× ${esc(x.row?.name ?? '?')}</span>${x.row?.designation ? `<span class="des">${esc(x.row.designation)}</span>` : ''}</li>`,
        )
        .join('')}</ul></div>`,
      st.tools?.length ? `<div><h3>Tools</h3><ul class="tools">${st.tools.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '',
      st.torque ? `<div><h3>Torque</h3><div class="torque">${esc(st.torque)}</div></div>` : '',
      st.notes ? `<div class="note">${esc(st.notes)}</div>` : '',
    ].join('')
    const svg = figures[i] ? toSvg(figures[i]).replace(/ width="[^"]*mm" height="[^"]*mm"/, ` role="img" aria-label="Step ${labels[i]}"`).replace(/<rect [^>]*fill="#ffffff"\/>/, '') : ''
    const icons = st.icons?.length ? `<span class="icons">${st.icons.map(pictogram).join('')}</span>` : ''
    return `<section class="sheet step${st.sub ? ' sub' : ''}" id="step-${i + 1}">
<header><span class="num">${labels[i]}</span><span class="word" data-n="${labels[i]}">Step</span><span class="what">${esc(summary(st))}</span>${icons}${st.sub ? `<span class="subname">Sub-assembly: ${esc(st.sub)}</span>` : ''}<span class="of">${i + 1} / ${steps.length}</span><label class="done"><input type="checkbox"> Done</label></header>
<figure>${svg}</figure>
<aside class="side">${side}</aside>
${warningsHtml(st.warnings)}
${said.length ? `<ol class="do${said.length === 1 ? ' one' : ''}">${said.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
</section>`
  }
  const landscape = s.orientation === 'landscape'
  const groups = pack(steps, s.layout ?? 'one', pageSize(s), 12, landscape)
  const sections = groups.map((g) => `<div class="pp n${g.length}${g.length > 1 ? ' multi' : ''}">${g.map((c) => section(steps[c.step], c.step)).join('\n')}</div>`).join('\n')
  const hw = s.hardwarePage
    ? all.flatMap((r) => {
        const o = r.designation ? hardwareOutline(r.designation) : null
        if (!o) return []
        const pad = 1
        const w = o.length + 2 * pad
        const h = o.height + 2 * pad
        const paths = o.lines.map((l) => `<path d="${l.map((v, j) => `${j === 0 ? 'M' : j % 2 === 0 ? 'L' : ''}${(j % 2 === 0 ? v + pad : v + h / 2).toFixed(2)}${j % 2 === 0 ? ' ' : ' '}`).join('')}" fill="none" stroke="#000" stroke-width="0.25"/>`).join('')
        return [`<li>${balloon(r.item)}<span><span class="q">${r.qty}×</span><br><span class="d">${esc(r.designation!)}</span></span><svg width="${w.toFixed(2)}mm" height="${h.toFixed(2)}mm" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" role="img" aria-label="${esc(o.kind)} at 1:1">${paths}</svg></li>`]
      })
    : []
  const hardware = hw.length
    ? `<section class="sheet hardware"><h2 class="label">Hardware at 1:1</h2><p class="meta">Print at 100% — no “fit to page” — and lay each piece on its outline.</p><div class="bar"><svg width="50mm" height="4mm" viewBox="0 0 50 4"><path d="M0 2H50M0 0.5V3.5M10 1V3M20 1V3M30 1V3M40 1V3M50 0.5V3.5" stroke="#000" stroke-width="0.3" fill="none"/></svg><span>This bar is 50 mm when printed true to size.</span></div><ul>${hw.join('')}</ul></section>`
    : ''
  const facts = [
    ['Intended use', s.intendedUse],
    ['Disposal', s.disposal],
    ['Made by', s.publisher],
  ].filter(([, v]) => v)
  const count = all.reduce((n, r) => n + r.qty, 0)
  const safety = s.safety ? warningsHtml([{ level: 'warning', text: s.safety }]) : ''
  const vars = `--pp2c:${landscape ? '1fr 1fr' : '1fr'};--pp2r:${landscape ? '1fr' : '1fr 1fr'};--pp6c:${landscape ? '1fr 1fr 1fr' : '1fr 1fr'};--pp6r:${landscape ? '1fr 1fr' : '1fr 1fr 1fr'}`
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)}</title>
<meta name="generator" content="ScanRuler assembly-manual (${t.id})">
<style>${css(t)}
@media print{@page{size:${s.paper === 'a4' ? 'A4' : 'letter'} ${s.orientation}}}</style>
</head><body class="badge-${t.badge} balloons-${t.balloon} layout-${s.layout ?? 'one'} words-${s.words ?? 'show'}" style="${vars}">
<main>
<section class="sheet cover">
<span class="kicker"></span>
<h1>${esc(s.title)}</h1>
<p class="meta">${[s.product, s.version ? `Version ${s.version}` : ''].filter((x): x is string => Boolean(x)).map(esc).join(' · ')}${s.product || s.version ? ' · ' : ''}${steps.length} step${steps.length === 1 ? '' : 's'} · ${count} part${count === 1 ? '' : 's'} in ${all.length} item${all.length === 1 ? '' : 's'}</p>
${safety}
${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div><h3>${k}</h3><p>${esc(v!)}</p></div>`).join('')}</div>` : ''}
<h2 class="label">Bill of materials</h2>
<table><thead><tr><th>Item</th><th>Qty</th><th>Name</th><th>Designation</th><th>Source</th></tr></thead><tbody>
${rows}
</tbody></table>
<nav><h2 class="label">Steps</h2><ol class="contents">${contents}</ol></nav>
</section>
${hardware}
${sections}
<footer>Made with ScanRuler</footer>
</main>
</body></html>
`
}
