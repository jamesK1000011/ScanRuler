# Packing a part to share

library-pack builds a zip of a finished part for the person to upload:
model files, renders, a README, a LICENSE, and the text for the upload
form. You never upload or post anything. The person does that themselves,
so every site's terms stay in their hands.

## Steps

1. **Settings.** `pack.settings`: the title, the author (the name they
   want credited, which may not be their account name), a summary, print
   settings as they'd tell a friend, and the platform. Ask; don't invent.
2. **Licence.** Ask which licence they want (`pack.licence { id }`) and
   explain the choice in a sentence if they're unsure. CC BY lets anyone
   use it with credit; CC BY-NC forbids selling; CC BY-SA keeps remixes
   open; CC0 gives it away.
3. **Upstream parts.** For every part they didn't design (a remix base, a
   bought-in bolt, a catalog download), `pack.attrib { set: [...] }`: its
   author, page, licence as the page says it, and the body it became. Ask
   them to confirm each licence on its page. Parts from TraceParts,
   McMaster, MISUMI or GrabCAD, or marked not to be shared on, are left out
   of the files and linked in the README instead.
4. **Check.** `pack.plan`. A blocked part says why: a ShareAlike base must
   keep its licence, a NonCommercial base can't go out under a licence that
   allows selling, a NoDerivatives base can't be remixed, and an
   all-rights-reserved base needs the author's permission. Tell the person
   and let them choose: another licence, leaving the part out, or asking
   the author. This is a guide, not legal advice.
5. **Extras.** `pack.add { path }` for the sliced 3MF with its print
   profile (slicer_slice's job folder), photos of the print, and so on.
6. **Scrub.** `pack.scrub` shows what will be taken out: home folder paths
   and the user name in them, access codes, API keys, printer serials and
   addresses, e-mail addresses, STEP author fields, and EXIF in pictures.
   Tell the person what it found.
7. **Build.** `pack.build { path }` writes the zip. PLATFORM.md in it has
   the upload form's fields to paste. Tell them to upload it themselves.
