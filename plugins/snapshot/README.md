<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Screenshot for the agent

A camera button at the bottom right of every workspace. A press asks the
browser for this tab, takes one frame of it — panels, stage, dialogs, as
the person sees them — and stops the capture. The shot comes up in a card
with a note field, Save PNG, Copy and Discard.

| Command | Tool | What it does |
|---|---|---|
| `snapshot.latest` | `snapshot_latest` | The newest shot (or `index` 1, 2…) as a picture, with its time, workspace and note |
| `snapshot.list` | `snapshot_list` | The shots, newest first, without pictures |

- **Only the person takes a shot.** Screen capture needs their click and
  the browser's prompt; there is no command that takes one.
- **Kept in the tab.** Up to 8 shots in the page's memory, never in the
  project or in storage. Save and Copy are the only ways out besides an
  agent reading one.
- **Browsers.** Chrome, Edge and Firefox; Safari from 17.
- **Right-click** the button to open the newest shot's card again.
- **Test.** `scripts/e2e-agent-snapshot.mjs` takes real captures of the tab
  (Chrome told to accept it) and reads them back through the MCP server.
