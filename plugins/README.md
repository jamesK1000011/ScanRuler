<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Plugins

Workspaces that sit beside the app rather than in `src/`, under the same
licence. A build stands with any of them or none, and may carry others that are
not in this repository.

| Plugin | What it adds |
|---|---|
| [reverse/](reverse/) | The Reverse engineer workspace — scan to solid STEP body |
| [mesh-tools/](mesh-tools/) | The Mesh Tools workspace — clean up and reduce a scan |
| [texture/](texture/) | The Texture workspace — a printable surface texture with BumpMesh's engine, masked by paint or by a Reverse body's CAD faces |
| [thread-match/](thread-match/) | Thread identification — names a scanned thread, or says which measurement would |
| [fit-comp/](fit-comp/) | Print fit — the Fits tab's Calibrate from a scan page: a scanned print against its CAD, to slicer settings, a compensated model and the printer's one calibration |
| [fits/](fits/) | Fits (the Fits tab's Design page) — hole and shaft sizes for slip and press fits, snap-fit hooks, print-in-place hinges, pins, tolerance stacks; calibrated with a test coupon |
| [import-plus/](import-plus/) | More model formats — GLB, glTF, FBX, 3DS, Collada, AMF, VRML, and .blend through Blender |
| [dfm-fdm/](dfm-fdm/) | Printability check (Print › 1 Check) — FDM rules from editable profiles, with findings you can waive |
| [printer-handoff/](printer-handoff/) | Printer hand-off (Print › 3 Send) — the guide for the MCP server's printer tools, and the start requests; a print starts only on your Start |
| [catalog/](catalog/) | Parts catalog — standard parts by size, catalogue links, Sketchfab/Thingiverse/Cults3D search, downloads brought in with their licence |
| [slicer-loop/](slicer-loop/) | Slicing (Print › 2 Slice) — OrcaSlicer, Bambu Studio and PrusaSlicer from ScanRuler, through scanruler-mcp's extras; the step shows the pauses and corrections that go in |
| [wear-repair/](wear-repair/) | Wear repair — worn regions back onto the mirrored half or the CAD; prints pre-warped |
| [assembly-manual/](assembly-manual/) | Assembly manual — steps checked for a clear way in, drawn and written; HTML and PDF |
| [patent-kit/](patent-kit/) | Patent kit — 37 CFR 1.84 line drawings with numerals, and a draft for an attorney; stays local |
| [_shared/](_shared/) | Code plugins share: line art (views, HLR, sheets as SVG, PDF and PNG), a zip writer, the materials, the printer's fit calibration in one sign convention (`printerFit.ts`, read with `readPrinterFit.ts`), and the tabs several plugins' workspaces share (`workspaces.ts`); no plugin.ts |
| [library-pack/](library-pack/) | Library pack — a part bundled to share: licences checked, remixes credited, private details scrubbed |
| [scanner-profiles/](scanner-profiles/) | Scanner profiles — the scan's noise, measured or from a profile you keep |
| [snapshot/](snapshot/) | Screenshot for the agent — a camera button that captures the tab, with pins and marks, for the agent to look at |
| [fea/](fea/) | Strength — FEA of a printed part, weaker across its layers; Gmsh and CalculiX on your computer |
| [mass/](mass/) | Mass and balance — weight, balance point and inertia as printed; ballast pockets to hit a target |
| [gen/](gen/) | Generate — Gridfinity bins and baseplates, a project box and lid, a board enclosure, made to size as solids |
| [hw/](hw/) | Hardware — holes for screws, nut traps, heat-set inserts, magnets and bearings, sized for printing and cut into Reverse Engineer bodies |
| [pcb/](pcb/) | Boards (Electronics › KiCad) — KiCad boards brought in as solids, an enclosure round them, Gerbers, drills and DRC through kicad-cli |
| [printed/](printed/) | Printed circuits (Electronics › Printed wiring) — traces of conductive filament as a body of their own, or channels for copper wire, tape or paint, in a Reverse Engineer body; each net's resistance along and through the layers |
| [gen/](gen/) | Generate — Gridfinity bins and baseplates, a project box and lid, made to size as solids |
| [circuit/](circuit/) | Circuit (Electronics › tscircuit) — boards as code with tscircuit, built on this computer; Circuit JSON read, measured, and brought into Reverse Engineer as board, copper and keep-out solids |

## The rules

1. **Plugin code lives in `plugins/<id>/`.**
2. **Nothing outside `plugins/` imports from it.** Not `src/`, not `tests/`,
   not `scripts/`, not a dynamic `import()`, not a worker URL, not a CSS
   `@import`. The app finds plugins through two globs only —
   `src/plugins/registry.ts` and `src/core/workerPlugins.ts`.
   `node scripts/check-plugin-boundary.mjs` fails on anything else, and CI
   runs it.
3. **A plugin reaches into the app freely:** stores, viewer, worker client,
   UI parts. When it needs the app to call *it*, it registers through one of
   the extension points below — the app never names a plugin.
4. **Every file here carries the licence header**, first line:
   `// SPDX-License-Identifier: AGPL-3.0-only` (a Markdown file as an HTML
   comment; JSON has no comments and goes without).
5. **A plugin's dependencies** go in the root `package.json` like the app's,
   and the dependency licence policy in CONTRIBUTING.md holds for them too. The
   one exception it records is Open CASCADE in the Reverse engineer.
6. **Changes go in the top-level `CHANGELOG.md`**, a plugin's documentation in
   its `README.md`.

## How a plugin is found and used

`plugins/<id>/plugin.ts` default-exports a `ScanRulerPlugin`
([src/plugins/api.ts](../src/plugins/api.ts)). At start-up
`installPlugins()` asks `pluginEnabled()` of every one found and installs those
it allows. `?plugins=none` in the address runs the app without any.

| Extension point | Where | What for |
|---|---|---|
| `workspace` | `plugin.ts` | the tab, and the guided hint's step; with `host`, a page of a tab several plugins share (below) |
| `usePlugin(host)` | `plugin.ts` | a React hook App runs every render: panel, stage, overlays, a view beside the viewport (`split`), clicks, hover (`hover`, `hovers`), grips, the scan's colouring, start pane, and the view bar — its parts beside the Scan key (`partKeys`, made with `src/ui/PartKey.tsx`), its keys at the side (`viewKeys`), the Scan key's click and Transparent when it holds them, and its own rows in the Scan key's menu (`scanKey`) |
| `keyboard` | `plugin.ts` | keys in the workspace, Enter and the middle click |
| `notices` | `plugin.ts` | what the imprint owes the third-party software the plugin ships, under "Third-party software" |
| `headless()` | `plugin.ts` | what the plugin's headless commands need when the app runs without a browser (`src/headless/engine.ts`, scanruler-mcp `--engine`): a session over its kernel in-process, say. A command marked `headless: true` is offered there; any other answers `unavailable` |
| `install()` | `plugin.ts` | registries, once: |
| — `registerHistory` | `src/state/historyStore.ts` | undo sections, actions, blocking, an editor's own history |
| — `registerProjectSection` | `src/app/projectSections.ts` | the plugin's key in the project file, and its archive files |
| — `onScan` | `src/app/scanEvents.ts` | a scan loaded, about to be swapped (`swapping`: the old version still in the scene, to read off it what is carried across), swapped, renumbered, remeasured |
| — `registerCommands` | `src/commands/registry.ts` | the plugin's commands for an agent, under its id (`reverse.feature.add`) — or its workspace's, where the id is no command name (`mesh.cut` for `mesh-tools`): the panel's own code path, one undo step each |
| — `registerSettle` | `src/commands/registry.ts` | work runs marked deferred left for later — a rebuild held while an agent's batch makes change after change — finished before the next command that is not deferred; `runningChange()` says which change is running and whether it is deferred |
| — `registerStateSection` | `src/commands/stateSections.ts` | the plugin's part of `session.state`, under `plugins.<id>` (`plugins.mesh` for Mesh Tools, as its commands) |
| — `registerBusy` | `src/commands/activity.ts` | what the plugin's own machinery is busy with — a command that changes the session is refused while it is, and the readout's `busy` says so; with the stores the check reads, which a command's wait then looks again on (a hidden tab slows its timer); and how it is stopped, for a change that throws the work away (`Command.discards`: a project or a scan opened with discard). A command marked `interrupts` — a stop of the plugin's own — runs at once, over the busy guard |
| — `registerViewToggles` | `src/commands/viewToggles.ts` | what `view.set` and `view.render` can show or put away by key in the plugin's workspace — its own keys, or the app's `scan` taken over with `applies` while the workspace is on screen |
| — `registerGuide` | `src/commands/guides.ts` | a guide `guide.read` serves an agent before a task — the workflow and judgement in Markdown, loaded when first read, with the guides it is read with |
| — `registerSectionLayers` | `src/commands/sectionLayers.ts` | what `section.render`'s picture of a section draws beside the scan, by key: outlines the scan's gap is read against (a model's cut by the section's plane) and labelled pieces (a sketch's, with their ids) |
| — `registerSheetPlanes` | `src/commands/sectionLayers.ts` | planes the workspace names, which `section.render { plane: { sketch } }` cuts in their own frame — its sketches' planes |
| — `registerMapReport` | `src/commands/mapReports.ts` | which map a `view.render` picture of the plugin's workspace shows, or why none (`map`, `mapWhy`, `mapNote`) — the bodies' live map |
| — `registerPanelSection` | `src/plugins/panelSections.ts` | a section of one of the app's own panels, for a plugin with no workspace that works on what one of the app's holds: `measure`, the 3D Measure panel after its tolerances (thread-match's Thread, scanner-profiles' Scanner) — its controls run the plugin's commands |
| — `registerModelFormat` | `src/app/modelFormats.ts` | model formats the plugin reads, offered by the scan's and the reference's Open pickers beside the app's own, and the opener a file picked in one goes to |
| `worker.ts` | `plugins/<id>/worker.ts` | operations in the mesh worker (`MeshWorkerClient.pluginCall`) |
| `MapLegend` `marks` | `src/ui/MapLegend.tsx` | a value called out on a map's ramp — a line across it and its figure, and with `to` the stretch from it hatched along the ramp: a band read differently inside the scale |
| `SceneManager.addLayer` | `src/viewer/sceneLayers.ts` | drawing and picking in the 3D viewport — and, with `cycle` and `cycling`, what the arrow keys step through under the cursor; with the host's `claimDrag`, the plain left-drag while the cursor is over what the layer drags |
| `offerSolids` | `src/app/solids.ts` | closed bodies a workspace lends the others as triangles — the Reverse engineer's bodies for Mesh Tools' Boolean |
| `ci.json` | `plugins/<id>/ci.json` | browser checks `npm run e2e:ci` runs |

Tests live in `plugins/<id>/tests/` and run with the app's (`npm test`);
browser checks in `plugins/<id>/scripts/`. A test that needs the plugin's
registrations calls `plugin.install()` first — see
`reverse/tests/reHistory.test.ts`.

## Tabs shared by several plugins

Some workspaces are pages of one top-bar tab rather than tabs of their own.
A page names its tab in `workspace.host`; the hosts live in
[_shared/workspaces.ts](_shared/workspaces.ts), so every page of a tab names
the same one:

| Tab | Pages (workspace id) |
|---|---|
| Electronics | KiCad (`pcb`) · tscircuit (`circuit`) · Printed wiring (`printed`) |
| Fits | Design (`fits`) · Calibrate from a scan (`fit-scan`, fit-comp) |
| Print | 1 Check (`dfm`) · 2 Slice (`slice`) · 3 Send (`print`) |

A page is still a workspace of its own: its id is what the shell, the undo
history, a project file and `workspace.set` name, so projects saved before
the tabs were merged open on their page, and an agent's switch to `pcb`
lands on Electronics › KiCad. The tab's own id (`electronics`, `fits`,
`print`) opens the page last shown, else the first — except where a page has
the same id, which wins (`print` is Send). `session.state` gives `tab` while
a page is up. The top bar shows the tab once; a strip over the panel
(`src/ui/PageStrip.tsx`) switches pages, numbered when the host has
`steps`. With one page left in a build, the tab stands for it and there is
no strip.

## Licence

AGPL-3.0-only, like the app; see [../LICENSE](../LICENSE).
