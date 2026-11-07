// SPDX-License-Identifier: AGPL-3.0-only
// The manual as one self-contained HTML file: a cover with the bill of
// materials and the steps' contents, then a step a section — its drawing,
// the parts it takes with their balloons, tools, torque, notes and the
// instructions one to a line. Styled by the theme (themes.ts) for a screen
// and for print, a step a page. No scripts, no fonts, nothing fetched: it
// opens anywhere and prints as it shows.

import { toSvg, type Sheet } from '../../_shared/lineart/sheet'
import { bom, itemOf } from './assembly'
import type { AsmSettings, Part, Step } from './model'
import { themeOf, type Theme } from './themes'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** STE writes one instruction a sentence: each its own line. */
export const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/))
    .map((x) => x.trim())
    .filter(Boolean)

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
.step{display:grid;grid-template-columns:minmax(0,1fr) 15rem;grid-template-areas:"head head" "fig side" "do do";gap:1.25rem 2rem}
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
@media (max-width:760px){.sheet{padding:1.4rem 1.2rem}.step{grid-template-columns:1fr;grid-template-areas:"head" "fig" "side" "do"}h1{font-size:1.9rem}}
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

export function html(s: AsmSettings, parts: Part[], steps: Step[], figures: Sheet[]): string {
  const t = themeOf(s)
  const all = bom(parts)
  const rows = all
    .map((r) => `<tr><td class="item">${balloon(r.item)}</td><td class="qty">${r.qty}×</td><td>${esc(r.name)}</td><td class="des">${esc(r.designation ?? '')}</td><td class="src">${esc(r.source ?? '')}</td></tr>`)
    .join('\n')
  const takes = (step: Step) => {
    const got = new Map<number, number>()
    for (const pl of step.place) {
      const item = itemOf(parts, pl.part)
      if (item) got.set(item, (got.get(item) ?? 0) + (parts.find((p) => p.name === pl.part)?.qty ?? 1))
    }
    return [...got].map(([item, n]) => ({ item, n, row: all.find((x) => x.item === item) }))
  }
  const summary = (st: Step) => takes(st).map((x) => `${x.n > 1 ? `${x.n}× ` : ''}${x.row?.name ?? ''}`).join(', ')
  const contents = steps
    .map((st, i) => `<li><a href="#step-${i + 1}"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(summary(st))}</span></a></li>`)
    .join('\n')
  const sections = steps
    .map((st, i) => {
      const said = sentences(st.text ?? '')
      const side = [
        `<div><h3>Parts</h3><ul class="parts">${takes(st)
          .map((x) => `<li>${balloon(x.item)}<span class="name">${x.n}× ${esc(x.row?.name ?? '?')}</span>${x.row?.designation ? `<span class="des">${esc(x.row.designation)}</span>` : ''}</li>`)
          .join('')}</ul></div>`,
        st.tools?.length ? `<div><h3>Tools</h3><ul class="tools">${st.tools.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '',
        st.torque ? `<div><h3>Torque</h3><div class="torque">${esc(st.torque)}</div></div>` : '',
        st.notes ? `<div class="note">${esc(st.notes)}</div>` : '',
      ].join('')
      const svg = figures[i] ? toSvg(figures[i]).replace(/ width="[^"]*mm" height="[^"]*mm"/, ` role="img" aria-label="Step ${i + 1}"`).replace(/<rect [^>]*fill="#ffffff"\/>/, '') : ''
      return `<section class="sheet step" id="step-${i + 1}">
<header><span class="num">${i + 1}</span><span class="word" data-n="${i + 1}">Step</span><span class="what">${esc(summary(st))}</span><span class="of">${i + 1} / ${steps.length}</span><label class="done"><input type="checkbox"> Done</label></header>
<figure>${svg}</figure>
<aside class="side">${side}</aside>
${said.length ? `<ol class="do${said.length === 1 ? ' one' : ''}">${said.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
</section>`
    })
    .join('\n')
  const count = all.reduce((n, r) => n + r.qty, 0)
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)}</title>
<meta name="generator" content="ScanRuler assembly-manual (${t.id})">
<style>${css(t)}</style>
</head><body class="badge-${t.badge} balloons-${t.balloon}">
<main>
<section class="sheet cover">
<span class="kicker"></span>
<h1>${esc(s.title)}</h1>
<p class="meta">${steps.length} step${steps.length === 1 ? '' : 's'} · ${count} part${count === 1 ? '' : 's'} in ${all.length} item${all.length === 1 ? '' : 's'}</p>
<h2 class="label">Bill of materials</h2>
<table><thead><tr><th>Item</th><th>Qty</th><th>Name</th><th>Designation</th><th>Source</th></tr></thead><tbody>
${rows}
</tbody></table>
<nav><h2 class="label">Steps</h2><ol class="contents">${contents}</ol></nav>
</section>
${sections}
<footer>Made with ScanRuler</footer>
</main>
</body></html>
`
}
