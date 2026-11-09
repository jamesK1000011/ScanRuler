// SPDX-License-Identifier: AGPL-3.0-only
// What the imprint owes the material data the library offers. Registered by
// index.ts, so it is there whenever the library is bundled — by Mass,
// Strength, Fits or the Materials plugin, any of them alone. The cards are
// not in the bundle (CONTRIBUTING.md: loaded, not linked); the notice says
// where they are, under what licences, and where they come from.
export function MaterialNotices() {
  const at = (file: string) => `${(import.meta.env.BASE_URL ?? '/').replace(/\/*$/, '/')}materials/${file}`
  return (
    <p>
      The material library offers 131 materials from <b>FreeCAD</b>'s material cards, each under its card's licence
      (100 under LGPL-2.0-or-later, 31 under CC BY 3.0), by M. Münch, Jonas Bähr, Uwe Stöhr, Bernd Hahnebach, Juergen
      Riegel, DaviKaur, Przemo Firszt, Mandeep Singh, Yorik van Havre, vlk and the FreeCAD project; converted to this
      app's units, and the cutting-data cards given bulk figures. They are <b>loaded, not linked</b>: a separate data
      file, <a href={at('freecad-cards.json')}>materials/freecad-cards.json</a>, fetched when first needed and
      replaceable with your own conversion, with the licence texts beside it (
      <a href={at('LGPL-2.0.txt')}>LGPL-2.0</a>, <a href={at('CC-BY-3.0.txt')}>CC BY 3.0</a>). Each material
      names its card, author and licence. Source:{' '}
      <a href="https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Material/Resources" target="_blank" rel="noopener noreferrer">
        FreeCAD's Material Resources
      </a>
      .
    </p>
  )
}
