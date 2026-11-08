# Seeing what the person sees

The person has a camera button at the bottom right of ScanRuler. A press asks their browser for this tab and takes one picture of it: panels, stage, dialogs, the agent card. It shows in a card where they can write a note, or press Mark up to draw on it: numbered pins with a comment each, arrows, boxes, circles and a pen.

- You are told. After they take or mark up a shot, the next answer you get from any ScanRuler tool ends with a line starting "From ScanRuler: the person took a screenshot…". Look at it then.
- `snapshot_latest`: the newest shot as a picture with their marks on it, plus the note, each pin's number, comment and place, and where it was saved. `original: true` for the picture without the marks; `index` or `id` for an older one.
- `snapshot_list`: the shots (up to 8) without pictures.
- `snapshot_wait`: when they say "I'll show you", call it. It answers when the next shot is taken or marked up.
- You cannot take a shot. If there is none, ask them to press the camera button and choose this tab in the browser's prompt.
- `view_render` is still the way to see the 3D stage alone. A screenshot is for the whole window as they see it.

Shots are saved by this server next to the scan (`scanruler-work/shots/`), or in its output folder (`scanruler-shots/`) when no scan was opened from a folder, unless the person turns that off on the card. Nothing is sent anywhere else.
