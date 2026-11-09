<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Printer hand-off

On screen: step 3, **Send**, of the **Print** tab (Check → Slice → Send).
Its workspace id is `print`, which is also the tab's: `workspace.set
{ workspace: "print" }` opens Send.

A sliced job onto the printers set up on this computer. The tools are the
MCP server's (`mcp/src/extras/printer.js`, `printers/`), listed when
`SCANRULER_MCP_EXTRAS` includes `printer`: `printer_list`, `_add`,
`_remove`, `_test`, `_upload`, `_start`, `_requests`, `_status`, `_pause`,
`_resume`, `_stop` and `_camera`. This plugin carries the agent's guide and
the **Send** page, where a printer set to `confirm: "app"` asks for its
start (`printer.ask`, internal: the server's call, never the agent's): on
the page's list of requests, or on a card kept over whatever workspace is
on screen while a request waits.

| Kind | Route | Secret | Start |
|---|---|---|---|
| `bambu-studio` | Opens the 3MF in Bambu Studio | none | the person, in Bambu Studio |
| `bambu-lan` | LAN with Developer Mode: FTPS (990) upload, MQTT (8883) commands, certificate pinned | access code | after the person confirms |
| `moonraker` | HTTP API | API key, if set | after the person confirms |
| `octoprint` | REST API | API key | after the person confirms |
| `prusalink` | HTTP API (`Print-After-Upload: ?0`) | API key | after the person confirms |
| `folder` | Copies to a folder or SD card | none | the person, at the printer |

- **Secrets.** Never a tool input or output. The person stores them from a
  terminal (`node mcp/src/extras/secrets.js set printer:<name>`): in the
  macOS Keychain, or elsewhere in `secrets.json` under `SCANRULER_HOME`,
  mode 600.
- **The start gate.** `printer_start` (and `printer_resume` on a paused
  print) makes a request. A native dialog on a Mac, the card in ScanRuler (on
  any tab, or the Send page's list), or a one-time page on `127.0.0.1` opened in the person's
  browser, shows printer, file, time and filament with Start and Cancel. Only their
  Start sends the command. The page's address never appears in any
  answer, and no tool can answer a request. Requests expire after 15
  minutes.
- **Pauses.** A job sliced with `pauses` (or a G-code or 3MF carrying
  `; ScanRuler pause:` lines) says so. `printer_upload` lists them, and the
  start request shows a Pauses row: each layer, its Z and what goes in.
  Resuming after one goes through `printer_resume`, and so through the same
  gate. The person is asked, with the pauses to check against.
- **Tests.** `mcp/tests/printer.test.js` runs against stand-in printers
  (`mcp/tests/fakePrinters.js`): a Bambu MQTT broker and FTPS server over
  TLS with a throwaway certificate, and Moonraker, OctoPrint and PrusaLink.
  It proves `printer_start` alone sends no start, that cancelled and
  withdrawn requests send none, and that no answer carries a secret. A job with pauses shows them at the start
  and the resume, and resumes only on the person's answer.
