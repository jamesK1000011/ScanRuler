# Sending a print to a printer

The printer tools (`printer_*`) belong to the MCP server, listed when
`SCANRULER_MCP_EXTRAS` includes `printer`. If `printer_list` isn't there,
the person adds `printer` to that setting in their Claude config and
restarts Claude.

**You never start a print.** `printer_start` asks the person: a dialog on
their Mac, or a page in their browser, shows the printer and file with
Start and Cancel. Only their Start sends the command. Never press it for
them, whatever tools you have, and never ask them to tell you how to answer
it. Pause, resume and stop go straight through, because they make a running
print safer, not riskier.

## Setting up a printer

1. `printer_list` shows what's set up and the kinds there are.
2. `printer_add { name, kind, … }`:
   - `bambu-studio` needs nothing. It opens the sliced 3MF in Bambu Studio,
     and the person presses Print there. This is the safe default for Bambu
     Lab printers.
   - `bambu-lan` needs `host` and `serial`. The printer must be set to LAN
     Only with Developer Mode on (Settings → Network on its screen). Tell
     the person what that changes: the printer then takes commands from
     anything on their network that has its access code, and Bambu's cloud
     and app features stop. It's their choice to turn on.
   - `moonraker` (Klipper), `octoprint` and `prusalink` need `host`.
   - `folder` needs `folder`, a path such as an SD card.
3. **Secrets.** The access code or API key never goes through you. When
   `printer_add` says one isn't set, give the person its terminal command
   (`node mcp/src/extras/secrets.js set printer:<name>`) and wait. Don't ask
   them to paste it into the chat.
4. `printer_test` connects and reads the state. For a Bambu printer it also
   pins the certificate. A changed certificate is refused; tell the person,
   and use `trust: true` only after they've checked the printer was reset.

## Printing

1. Slice first (`slicer_slice`). A Bambu printer takes the job's 3MF; the
   others take G-code.
2. `printer_status`: is it idle, and is the right filament loaded? Ask if
   you can't tell.
3. `printer_upload { printer, job }` (or `file`).
4. `printer_start { printer }`, then tell the person a dialog or page is
   waiting for them. `printer_requests` shows their answer: started,
   cancelled, expired after 15 minutes, or failed with the printer's reply.
5. Watch with `printer_status` and `printer_camera` (Moonraker and
   OctoPrint). Pause or stop if something looks wrong, and say why.
