# Writing assembly instructions

assembly-manual turns parts modelled in their assembled places into a
step-by-step manual. Each step gets a line drawing: the parts already in
place in grey, the step's own parts in black, pulled back along the way they
go in. It also gets the parts and tools the step takes, and short
instructions. The cover carries the bill of materials.

## Steps

1. **The parts.** Every part is a solid body in Reverse Engineer, in the
   place it ends up: modelled there, imported as STEP
   (`reverse.import.step`), or a catalog download imported the same way.
   Name the bodies (`reverse.body.set`). `asm.parts { fromBodies: true }`
   lists them. Then `set` the hardware's designation ("M3×10 ISO 4762") and
   each part's source (supplier, catalog file, "printed"). Hardware alike by
   designation comes as one item with a count.
2. **The steps.** `asm.step { add: { place: [{ part, move }] } }`, in the
   order a person would build it. `move` is the way the part goes in:
   `down` for a lid set on top, `-x` for a pin pushed in from the side. Add
   tools and torque where they matter.
3. **Check.** `asm.check` sweeps every part in along its move against what
   is already there. A hit names the part, what it runs into and how far
   short of its place. Change the order or the direction, and check again
   until `ok` is true.
4. **Words.** `asm.style` is `ste100` by default. Write to ASD-STE100
   Issue 9 habits: one instruction a sentence, the verb first, active voice,
   20 words at most. Don't quote the standard. `asm.text { step, text }`
   writes a step and lints it. Rewrite until the findings are gone, or say
   why one stays. Use the names on the parts list.
5. **Look.** `asm.render { page }` returns a page as a picture: 0 is the
   cover, n is step n. Check that each new part is clear, and that its
   balloon and path line read. Set `view` on a step if another angle shows
   it better.
6. **Save.** `asm.save { path }` writes the manual as HTML (self-contained),
   `format: "pdf"`, or `"zip"` with both and every page as SVG. Local only.

## Notes

- A clash is two parts overlapping in their places: a press fit, or a model
  to fix. Ask which.
- A part never placed, or placed twice, shows in `asm.steps` and
  `asm.check`.
