# Seeing what the person sees

The person has a camera button at the bottom right of ScanRuler. A press asks their browser for this tab, takes one picture of it — panels, stage, dialogs, the agent card — and shows it in a card where they can write a note on it.

- When they say they took a screenshot, or that something looks wrong, call `snapshot_latest`: the newest shot as a picture, with when it was taken, the workspace on screen and their note.
- `snapshot_list` lists the shots (up to 8) without pictures; `snapshot_latest { index }` shows an older one.
- You cannot take a shot. If there is none, ask them to press the camera button and choose this tab in the browser's prompt.
- `view_render` is still the way to see the 3D stage alone; a screenshot is for the whole window as they see it.

The shots stay in the tab's memory: nothing is saved to the project or sent anywhere unless they press Save or Copy.
