<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# More model formats

Opens GLB, glTF (with embedded buffers), FBX, 3DS, Collada, AMF and VRML as
the scan or as the reference part. Each file is read with three.js's
loaders. Every mesh node is flattened into one mesh in mm, Z up, with its
transforms applied, and handed to the app's own `scan.open` or
`deviation.open_reference` as STL.

## In the app

The Open pickers — the top bar's Open, the start tiles and the scan's and
the reference's slots — offer these formats beside the app's own
(`registerModelFormat`), and a file picked there opens as the scan or the
reference part, asking first, as any scan does, before measurements in
place are thrown away. A model in one of these formats dropped on the page
opens as the scan. Both go through `import.open` in the mesh's own units
and up axis as the table in the guide gives them; to override the units, up
or parts, use the command.

A `.blend` goes through the person's own Blender: scanruler-mcp's
`blender_convert` tool runs it in the background with factory settings and
scripts in the file switched off, and writes a GLB. The tool is listed only
when `SCANRULER_MCP_BLENDER` is set in the server's environment, to `auto`
or to Blender's path; with `auto`, Blender is looked for at `BLENDER_PATH`,
where it installs, then on the `PATH`.

## Commands (`import.*`)

| Command | Changes | What |
|---|---|---|
| `import.formats` | nothing | Formats, and the units and up axis each is taken in |
| `import.inspect` | nothing | A file's parts, size and units, without opening it |
| `import.open` | the scan or the reference | Opens it, optionally only some parts, with units or up overridden |

What was last opened (name, as, format, units, up, triangles, parts) is in
`session.state` under `plugins.import.last`.

The agent guide is `guide.read { id: "import-plus" }`.

## Layout

| Path | What |
|---|---|
| `core/convert.ts` | Loading with three.js, flattening into mm and Z up, STL out |
| `app/importCommands.ts` | The commands |
| `app/useImportDrop.ts` | Opening a dropped file, and a file picked in an Open picker |
| `../../mcp/src/blender.js` | `blender_convert` in scanruler-mcp |
| `tests/` | The flattening on blocks made in three.js |
| `scripts/e2e-agent-import.mjs` | Every format and the Blender path, through scanruler-mcp |
