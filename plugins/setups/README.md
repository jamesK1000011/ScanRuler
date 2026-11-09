<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Setups

How each part of a build is made. A build mixes processes part by part —
printed brackets, laser-cut plates, machined parts, boards, bought parts —
and, as in Fusion's Manufacture workspace, a **setup** says what is made
and how: one process (its type) and the bodies made by it, with that
process's settings. A project has as many as it needs. What a part is made
of (its material) is the part's own, not the setup's. Nothing here decides
which process a part gets: that is chosen in conversation, and a setup
records it.

On screen: the **Make** tab (it was Print). Over its pages stands the list
of setups — add, rename, remove, the parts made by each, its settings —
and under it the pages of the setup chosen: a print setup's Check · Slice ·
Send. With none chosen the tab's pages are all offered, as before. The
pages keep their workspace ids (`dfm`, `slice`, `print`), so a project
saved on one opens on it.

## Data

The project file's `setups` part: `{ version: 1, setups, selected }`, each
setup `{ id, type, name, bodies, …its type's settings }` — `id` S1, S2 …,
`bodies` the bodies' keys: a Reverse Engineer body's id as text, which a
rename leaves alone, as the materials are kept (a name kept from an older
project matches its body too, and becomes its id at the setup's next
change); the answers name the bodies. Written with none too. A setup of a type not
in the build is kept as it was and written back. A project from before
setups (no `setups` part) opens with one print setup holding the bodies it
printed (the review spec's `processes` "fdm" or "print", and the body Check
was set to), when it did any printing work — else with none, and the Make
tab offers one; nothing in it is changed or dropped.

## Commands (`setup.*`)

| Command | Changes | What |
|---|---|---|
| `setup.list` | nothing | The setups, the one shown, and the kinds there are |
| `setup.add` | setups | A setup: type, name, bodies, settings |
| `setup.set` | setups | Name, bodies (whole list, or add and remove), settings (null drops one), select |
| `setup.remove` | setups | Takes one away |
| `setup.of` | nothing | The setups a body is in |

Each change is one undo step. Every command runs headless. The agent
guide is `guide.read { topic: "setups" }`.

## For the workspaces: plugins/_shared/setups.ts

The workspaces read the setups through this plugin's part of the session,
never by importing it: `setupsOf()`, `setupFor(body, type?)`,
`isPrinted(body)`, `bodyKeyOf(body)`, `setupValue(body, key, type = 'print')` (a setting, or null — the
workspace's own then), `sharedSetupValue(bodies, key)` and
`machineTolerance({ body } | { setup })`. Without this plugin every body is
in no setup and every workspace goes by its own settings.

## A kind of setup: registerSetupType

A plugin brings a kind of setup from its `install()` with
`registerSetupType(type)` (plugins/_shared/setups.ts). The same object
registered by several plugins is one — the print setup is registered by
each of its three pages' plugins, so any of them alone brings it.

| Field | |
|---|---|
| `id`, `label`, `title` | Stable id kept in each setup; its name; a tooltip of 60 characters at most |
| `pages` | The Make tab's pages for it, by workspace id, in order; each page's workspace names `MAKE` (plugins/_shared/workspaces.ts) as its host and adds its id to `MAKE.pages` |
| `settings` | By key: `schema` (for the agent), `check(value)` (why not, or null), `normalize(value)` |
| `checks` | What `part.review` runs on a body in it: `{ command, input?(body) }`; findings read from each answer's `findings` (`severity`, `says`, `at`, `waived`) |
| `outputs` | What it puts out, in words, for `setup.list` |
| `tolerance(setup)` | The machine's tolerance: `{ kind: 'print', fit }`, `{ kind: 'kerf', kerf }`, `{ kind: 'it', grade }` — Fits sizes with `print` today and refuses the others until their sizing is added in `plugins/fits/app/fitsCommands.ts` (`calibrationNow`) |
| `Settings` | Its settings on the Make tab, a component given `{ setup }`; changes run `setup.set` |

The print setup's type is `plugins/_shared/printSetup.ts`; the PCB order
setup's (`pcb`: a board made by a board house, its page Order) is
`plugins/pcb-order/app/orderSetup.ts`, with no tolerance — and the board's
enclosure is a part of its own, in a print, cut or mill setup.
