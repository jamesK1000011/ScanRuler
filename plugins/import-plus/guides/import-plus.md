<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Opening GLB, glTF, FBX, 3DS, Collada, AMF, VRML and Blender files

ScanRuler reads STL, PLY, OBJ, 3MF and STEP itself, through `scan.open` and
`deviation.open_reference`. import-plus opens the rest:

- **GLB** and **glTF** (with embedded buffers)
- **FBX**
- **3DS**
- **Collada** (`.dae`)
- **AMF**
- **VRML** (`.wrl`)
- a **`.blend`**, through the person's own Blender

It flattens every mesh node into one mesh in mm, Z up, and hands it to the
app as STL.

## Workflow

1. A `.blend`: run `blender_convert { path }` first. It runs the Blender
   installed on this computer, headless, with autoexec off, and writes a
   `.glb`. If Blender isn't found, say so: the person can set `BLENDER_PATH`
   or export a GLB from Blender themselves.
   `import.formats` lists the formats, their extensions and the units and up
   axis each is taken in when the file doesn't say.
2. `import.inspect { path }`: look at `parts`, `sizeMm` and `unitsWarning`
   before opening. A game or scene file often holds props, a floor or a
   rig. Pick the part that is the object with `parts`.
3. `import.open { path, as: "scan" | "reference", units?, up?, parts? }`.
   Opening as the reference part, the CAD to compare a scan against, needs a
   scan open already.
4. Check the size against what the person said the object is. A wrong unit
   is the common failure: 1000× (m vs mm) or 10× (cm vs mm).

## Units and up

| Format | Taken as | Why |
|---|---|---|
| glb, gltf | m, Y up | the glTF specification |
| fbx | cm, Y up | most exporters' habit, not a guarantee |
| dae | the file's own unit, Y up after the loader | Collada `<unit>` |
| wrl | m, Y up | the VRML specification |
| 3ds, amf | mm, Z up | no units in 3DS; AMF's default |

Override with `units` (mm, cm, m or in) and `up` (y or z) whenever the size
or the orientation reads wrong.

## Limits

- Textures, materials, animation and skinning are dropped: the mesh is taken
  in its rest pose.
- A `.gltf` that points to separate `.bin` or image files can't be read from
  one path. Ask for the `.glb`, or convert with Blender.
- USD and USDZ aren't read.
- Dropping one of these files on the page opens it as the scan. The Open
  button's file list doesn't show them.
