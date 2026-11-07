<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Parts catalog

Three jobs:

1. **Names a standard part from measured dimensions.** Socket and button
   head screws, hex nuts, washers and deep-groove bearings, from an offline
   table of nominal sizes (`core/standards.ts`).
2. **Builds search links** to the catalogues and model libraries, each with
   what its terms allow (`core/links.ts`).
3. **Keeps where each part came from** with the project.

The downloads come in on this computer, through scanruler-mcp's extras
(`mcp/src/extras/catalog.js`, `SCANRULER_MCP_EXTRAS=catalog`):

- `catalog_open_url` opens a search page in the person's own browser.
- `catalog_downloads` lists the new CAD files in their downloads.
- `catalog_take` copies one in, or unpacks the CAD files of a zip, into an
  imports folder, with a `provenance.json` beside it.

Nothing is scraped or downloaded by a program: the person clicks download.
This branch builds on `slicer-loop`, which brings the extras.

## Commands and tools

| Name | Where | What |
|---|---|---|
| `catalog.kinds` | page | The kinds known offline and what each dimension is |
| `catalog.lookup` | page | A standard part's nominal dimensions |
| `catalog.match` | page | Standard parts that fit the measured dimensions |
| `catalog.links` | page | Search pages, with each source's terms |
| `catalog.provenance` | page | Where the project's parts came from (kept with the project) |
| `catalog_open_url` | server | Opens a page in the default browser (http and https only) |
| `catalog_downloads` | server | New CAD files and zips in the downloads folder |
| `catalog_take` | server | Brings one in, with its source and licence |

The agent guide is `guide.read { id: "catalog" }`.

## Not yet

API adapters for TraceParts and McMaster-Carr need the person's own keys
(and, for McMaster, an approved account and client certificate) to build
and test against. Until then, the browser route above covers every source.
