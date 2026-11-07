<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Finding a part: standard sizes, catalogues and model libraries

Geometry alone guesses badly. Use what you measure *and* what the person
says the part is.

## Is it a standard part?

1. Measure what defines it. For a bearing, that's the bore, outside diameter
   and width. For a screw, the thread (`thread_identify`, if thread-match is
   there), head diameter, head height and hex key size. For a nut, across the
   flats and the height. For a washer, the hole, outside diameter and
   thickness. Use `element_fit` or section fits on the scan, or ask the
   person for caliper readings.
2. Run `catalog.match { dims, kind? }`, naming the dimensions as
   `catalog.kinds` does. `fit: good` (worst under about 3 %) names it.
   `loose` may be worn, printed or a maker's own size: say so.
3. A standard part usually needs no CAD. Say what to buy: "608 bearing,
   8 × 22 × 7".

## Finding the CAD

1. Build a query from the person's words plus what you measured: "Milwaukee
   M18 battery latch", "M5 x 16 socket head cap screw ISO 4762", "NEMA 17
   bracket".
2. Run `catalog.links { query }` for the search pages. Each source has its
   own terms: catalogues (TraceParts, McMaster, MISUMI) are for designing
   with their parts; libraries (Printables, Thangs, GrabCAD) carry a licence
   per model.
3. Open the most likely one with `catalog_open_url { url }`, in the person's
   own browser. Ask them to pick the model, sign in if the site asks, and
   click download. Don't scrape or download pages yourself.
   With `watch: true` (and `source`, `licence`, `redistribute`, `to`) the
   downloads folder is watched too. The finished file comes into the
   imports folder by itself, and `catalog_watch { action: "status" }` says
   what arrived. Ask for the licence first, so it's recorded with the file.
4. Without a watch, run `catalog_downloads` to see what arrived, then `catalog_take { file,
   source, url, licence }`. It copies the file, or unpacks a catalogue's
   zip, into the imports folder and records where it came from. Use the
   project's folder from `scanruler_status` as `to` to keep the project
   together. Ask the person for the licence the model page shows. Set
   `redistribute: true` only when that licence allows sharing.
5. Record it with the project: `catalog.provenance { action: "record" }`.

## McMaster-Carr and TraceParts accounts

With an account set up, a part comes in without the browser.
`catalog_sources` says whether each is on and how to set it up.
`catalog_mcmaster { part }` fetches a McMaster part number's STEP.
`catalog_traceparts { partNumber, catalog }` requests a TraceParts part's
STEP and waits for it. Both land in the imports folder, recorded as not to be
shared on. Their passwords and keys are set by the person in a terminal,
never in the chat. Credit "Powered by TraceParts" where you show its parts.

## From a download to a repair

- **A mesh** (STL, 3MF, OBJ, GLB …): open it as the reference with
  `deviation_open_reference` or `import_open { as: "reference" }`. Align it
  to the scan, and the deviation map shows wear and breakage.
- **A STEP** to build on: use `reverse_import_step`, then modify with
  Reverse features. For a **kintsugi-style repair**, keep the worn original
  and add the repair as its own feature (a sleeve, collar or bridging rib),
  so it can be printed in a contrasting colour.

## Limits

- The offline table holds common metric fasteners and deep-groove bearings
  only. Anything else goes through the search pages.
- Catalogue APIs (TraceParts, McMaster) need the person's own credentials,
  and aren't connected yet. The browser route works for every source today.
