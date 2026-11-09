<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Library pack

A finished part bundled for sharing: model files (STL, 3MF and STEP from
Reverse Engineer's bodies, or the scan), 3 to 6 renders, files you add
(the sliced 3MF with its profile, photos), the assembly manual if there is
one, a README, a LICENSE and the text for the upload form. It writes a zip
on this computer. You upload it yourself.

- **Licence check.** Each upstream part's licence is checked against the
  pack's (`core/licence.ts`, a table written for this plugin). ShareAlike
  remixes must keep their licence. NonCommercial parts can't go out under
  a licence that allows selling. NoDerivatives parts can't be remixed.
  All-rights-reserved parts need the author's permission. A blocked pack
  says why. This is a guide, not legal advice.
- **Left out and linked.** Parts from TraceParts, McMaster, MISUMI or
  GrabCAD, or recorded by catalog as not to be shared on (no-derivatives
  and unclear licences included), are taken out of the model export and
  listed in the README with their links.
- **Attribution.** Each remixed part gets a line with its title, author,
  page and licence, noting that it was changed.
- **Privacy scrub.** Every file, including those inside a 3MF, is
  scrubbed. Absolute paths are cut to the file name, and the user name
  found in them is replaced everywhere. Access codes, API keys, tokens,
  passwords, printer serial numbers and printer addresses are emptied.
  Local network addresses and e-mail addresses are removed. A STEP
  header's author and organisation are emptied, text in an STL header is
  blanked, and EXIF, XMP and text are taken out of pictures. The report
  lists every change.
- **Platform presets.** Printables, Thangs, MakerWorld and Thingiverse set
  folder names, render size and count, and field lengths. These are
  defaults to check against each upload form. Your own are kept with the
  project: `pack.presets`, or the panel's *Upload form presets* — *Edit*
  the chosen one, *Copy as new* for another site (id, name, images and
  their size, the folders, title and summary lengths, a note), remove one
  of yours with its ×.

## Commands (`pack.*`)

| Command | Changes | What |
|---|---|---|
| `pack.settings` | settings | Title, author, summary, print settings, platform, what to include |
| `pack.licence` | licence | The pack's licence, checked against every upstream part |
| `pack.attrib` | upstream | Upstream parts: author, page, licence, body, remix or not |
| `pack.add` | session files | A file from disk (path) |
| `pack.files` | session files | List or remove added files |
| `pack.plan` | nothing | What goes in, what's left out, what blocks |
| `pack.scrub` | nothing | What the scrub takes out of each file |
| `pack.presets` | presets | Platform presets, built in and your own |
| `pack.build` | nothing | The zip |

The agent guide is `guide.read { topic: "library-pack" }`.
