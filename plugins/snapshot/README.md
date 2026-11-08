<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Screenshot for the agent

A camera button at the bottom right of every workspace, or ⌥⇧S
(Alt+Shift+S) anywhere but a text field. A press asks the browser for this
tab, takes one frame of it — panels, stage, dialogs, as the person sees
them — and stops the capture. The shot comes up in a card with a note
field, Mark up, Save PNG, Copy and Discard.

- **Mark up.** Numbered pins with a comment each, arrows, boxes, circles
  and pen strokes (P, A, B, C, D), in a few colours, with undo. Done keeps
  the marks with the shot; the shot underneath is kept as taken.
- **The agent is told.** A new shot, a note or a finished mark-up rides on
  the agent's next answer from the server ("the person took a screenshot
  … snapshot_latest shows it").
- **Saved beside the project.** With *Save shots beside the project* on
  (the default), the server writes each shot, marks drawn in, to the
  scan's work folder (`shots/`) or its own output folder, and the card
  shows where.

| Command | Tool | What it does |
|---|---|---|
| `snapshot.latest` | `snapshot_latest` | The newest shot (or `index` 1, 2…) as a picture with its marks (`original: true` without), its time, workspace, note, pins and saved path |
| `snapshot.list` | `snapshot_list` | The shots, newest first, without pictures |
| `snapshot.wait` | `snapshot_wait` | Waits (120 s by default, 600 at most) for the next shot or finished mark-up |
| `snapshot.saved` | — | Internal: the server telling the page where it wrote a shot |

- **Only the person takes a shot.** Screen capture needs their click and
  the browser's prompt; there is no command that takes one.
- **Kept in the tab.** Up to 8 shots in the page's memory, never in the
  project file. Besides the server's saved copy, Save and Copy are the
  only ways out.
- **Browsers.** Chrome, Edge and Firefox; Safari from 17.
- **Right-click** the button to open the newest shot's card again.
- **Test.** `scripts/e2e-agent-snapshot.mjs` takes real captures of the tab
  (Chrome told to accept it) and reads them back through the MCP server.
