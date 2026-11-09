<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Parts catalog

Four jobs:

1. **Names a standard part from measured dimensions.** Socket and button
   head screws, hex nuts, washers and deep-groove bearings, from an offline
   table of nominal sizes (`core/standards.ts`). A lookup reads every word
   of a query, a whole size ("M5x16", "608") and a standard ("ISO 4762").
2. **Builds search links** to the catalogues and model libraries, each with
   what its terms allow (`core/links.ts`).
3. **Searches model libraries** — Sketchfab, Thingiverse, Cults3D, Poly Haven (CC0, no key) and KiCad's electronic parts (CC-BY-SA 4.0 with the KiCad libraries exception, no key) — from
   the panel's *Find a model*, through their official APIs. Results come
   back as cards with picture, designer and licence; a model's files are
   listed, one is brought in, then opened as the reference or the part (a
   STEP also as a Reverse Engineer body).
4. **Keeps where each part came from** with the project.

Everything that touches the network or the disk runs on this computer, in
scanruler-mcp's extras (`mcp/src/extras/catalog.js`, `models.js`,
`sources.js`; `SCANRULER_MCP_EXTRAS=catalog`):

- `catalog_open_url` opens a search page in the person's own browser;
  `catalog_watch` takes what then lands in their downloads.
- `catalog_downloads` lists the new CAD files; `catalog_take` copies one in,
  or unpacks the CAD files of a zip, into an imports folder, with a
  `provenance.json` beside it.
- `catalog_models_search`, `_files` and `_take` search the libraries, list
  a model's files and download one through the library's API.
- `catalog_mcmaster` and `catalog_traceparts` fetch a part's CAD with the
  person's own account (`catalog_sources`, `catalog_source`).

Library keys and catalogue credentials live in the macOS Keychain (or a
private secrets file), set by the person in Terminal with
`node mcp/src/extras/secrets.js set …`; the page and the agent never see
them. A Keychain read that waits on macOS's allow prompt is given up after
8 s with what to do. Nothing is scraped: pages open in the browser, and
the APIs are the libraries' own.

## Model search

- Each library has 20 s to answer; one that is slow or down is reported by
  name and the others' results still come back. The panel counts the
  seconds, and **Cancel** stops the wait and tells the server to stop
  asking.
- The page asks only a server that says it answers model search (its
  welcome names `catalog.models`). An older server is refused at once,
  with how to restart it, rather than left to time out.
- A closed agent connection ends the wait. **More results** goes on with
  the search already made.

## Licences

A take records source, page and licence. A library model is marked
shareable only under a Creative Commons or public-domain licence that is
not no-derivatives (ND) or negated ("not for …"); a catalogue's parts
never are. Records in a
project file are cleaned on load the same way, so Library Pack leaves out
what may not be passed on. **Bring in** writes its record even while the
page is busy with other work.

## Commands and tools

| Name | Where | What |
|---|---|---|
| `catalog.kinds` | page | The kinds known offline and what each dimension is |
| `catalog.lookup` | page | A standard part's nominal dimensions |
| `catalog.match` | page | Standard parts that fit the measured dimensions |
| `catalog.links` | page | Search pages, with each source's terms |
| `catalog.provenance` | page | Where the project's parts came from (kept with the project) |
| `catalog.answer` | page | Internal: the server's answer to the panel's model search |
| `catalog_open_url` | server | Opens a page in the default browser (http and https only), optionally watching downloads |
| `catalog_watch` | server | Takes each finished download into the imports folder |
| `catalog_downloads` | server | New CAD files and zips in the downloads folder |
| `catalog_take` | server | Brings one in, with its source and licence |
| `catalog_libraries` | server | Which model libraries have keys, and what each can do |
| `catalog_models_search` | server | Sketchfab, Thingiverse, Cults3D, Poly Haven and KiCad's parts library at once |
| `catalog_models_files` | server | A model's downloadable files |
| `catalog_models_take` | server | Downloads one into the imports folder, licence recorded |
| `catalog_sources` / `catalog_source` | server | McMaster-Carr and TraceParts accounts: state, on/off |
| `catalog_mcmaster` | server | A McMaster part number's CAD (approved account and certificate) |
| `catalog_traceparts` | server | A TraceParts part's CAD, requested and waited for |

The server checks each tool's arguments against its schema, sends a
library's token to that library's host only, and keeps keys out of every
error. Zips are read whole and refused when damaged, encrypted or a zip
bomb; a take stages in its own folder.

The agent guide is `guide.read { topic: "catalog" }`.
