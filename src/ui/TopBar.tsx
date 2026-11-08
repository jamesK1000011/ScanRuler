// SPDX-License-Identifier: AGPL-3.0-only
// Instrument chassis header: identity on the left, the workspace selector next
// to it, the project's name and the loaded part alongside. Models are opened from the
// workspace itself, not from here — a single "open" in a bar shared by two
// workspaces cannot say which model it means. What the bar does open is a
// project, which says for itself what it holds; a plain scan or image dropped
// on the same button goes where it would have gone from its workspace.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from '../state/store'
import { useFlat } from '../state/flatStore'
import { usePrefs } from '../state/prefsStore'
import { useDeviation } from '../state/deviationStore'
import { useShell, type Workspace } from '../state/shellStore'
import { plugins } from '../plugins/registry'
import { pageToOpen, pluginBarTabs, type BarTab } from '../app/workspacePages'
import { UndoRedo } from './UndoRedo'
import { AGENT_STATUS, useAgentLink } from '../commands/agentLink'
import { Icon, type IconName } from './icons'
import { IMAGE_ACCEPT, SCAN_ACCEPT, isImageFile, isModelFile, isTextureFile } from '../core/formats'
import { modelFormatOf, withPluginFormats } from '../app/modelFormats'
import { bundleFiles } from '../app/scanFiles'
import { PROJECT_ACCEPT, PROJECT_EXTENSION, projectStem } from '../core/project/manifest'
import { holdsProject, isProjectFile } from '../app/useProject'
import { APP_VERSION } from '../version'
import type { RecoveryStatus } from '../app/useRecovery'

const GITHUB_URL = 'https://github.com/CNCKitchen/scanruler'

/** What the GitHub key links to: the whole app, or — with plugins in use,
 *  which are not published there — the app without them. */
const sourceTitle = () =>
  plugins().length > 0 ? 'Source code of the open-source core (AGPL-3.0-only) on GitHub' : 'Source code (AGPL-3.0-only) on GitHub'

const CORE_TABS: { id: Workspace; icon: IconName; label: string; title: string; order: number; group: 'measure' }[] = [
  { id: 'elements', icon: 'wsMeasure', label: '3D Measure', title: 'Fit spheres, cylinders and planes, and measure between them', order: 1, group: 'measure' },
  { id: 'deviation', icon: 'compare', label: 'Surface Deviation', title: 'Best-fit the scan to a nominal part and map the difference', order: 2, group: 'measure' },
  { id: 'thickness', icon: 'wsThickness', label: 'Wall Thickness', title: 'Map the part’s wall thickness', order: 3, group: 'measure' },
  { id: 'flat', icon: 'wsFlat', label: '2D Measure', title: 'Measure a flatbed scan the way a measuring microscope would', order: 4, group: 'measure' },
]

/** The app's tabs and those of the plugins in use, in the order of the work
 *  — measure, model, make, share — each marked where a new stage starts. */
const workspaceTabs = () => {
  // Workspaces that are pages of one tab (Electronics, Print…) show once,
  // as their host: the strip over the panel goes between the pages.
  const core: BarTab[] = CORE_TABS.map((t) => ({ ...t, pages: [t.id] }))
  const all = [...core, ...pluginBarTabs()].sort((a, b) => a.order - b.order)
  return all.map((w, i) => ({ ...w, opens: i > 0 && (w.group ?? 'model') !== (all[i - 1].group ?? 'model') }))
}

/** The workspace tabs, and when they are too many for the row, a key at
 *  each end that shows the ones out of sight — and the wheel scrolls them —
 *  so a window not at full width still reaches every workspace. */
function TabStrip({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [ends, setEnds] = useState({ left: false, right: false })
  const strip = () => box.current?.querySelector<HTMLElement>('.modeswitch') ?? null
  useEffect(() => {
    const el = strip()
    if (!el) return
    const look = () => {
      const next = { left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 }
      setEnds((was) => (was.left === next.left && was.right === next.right ? was : next))
    }
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    look()
    el.addEventListener('scroll', look, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    const ro = new ResizeObserver(look)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', look)
      el.removeEventListener('wheel', wheel)
      ro.disconnect()
    }
  }, [])
  const step = (dir: -1 | 1) => {
    const el = strip()
    el?.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' })
  }
  return (
    <div className="tabstrip" ref={box}>
      {ends.left && (
        <button className="tabmore left" title="More workspaces" aria-label="Show the workspaces to the left" onClick={() => step(-1)}>
          ‹
        </button>
      )}
      {children}
      {ends.right && (
        <button className="tabmore right" title="More workspaces" aria-label="Show the workspaces to the right" onClick={() => step(1)}>
          ›
        </button>
      )}
    </div>
  )
}

/** The page's own title, while no project is named. */
const APP_TITLE = 'ScanRuler by CNC Kitchen'

/** The project's name, typed in place — what Save Project saves it under,
 *  every export is named on and the browser tab reads. Unnamed, those go by
 *  the scan's name, or the image's. Enter or leaving the field takes what
 *  was typed; Escape puts it back. */
function ProjectName() {
  const name = useStore((s) => s.projectName)
  const fileName = useStore((s) => s.fileName)
  const imageName = useFlat((s) => s.imageName)
  /** The text while it is being typed, or null. */
  const [typed, setTyped] = useState<string | null>(null)
  const dropped = useRef(false)
  useEffect(() => {
    document.title = name ? `${name} — ScanRuler` : APP_TITLE
  }, [name])
  const shown = typed ?? name ?? ''
  const fallback = projectStem(null, fileName, imageName)
  const placeholder = 'Untitled project'
  return (
    <input
      className="projectname"
      data-test="project-name"
      aria-label="Project name"
      spellCheck={false}
      value={shown}
      placeholder={placeholder}
      size={Math.max(14, Math.min(32, (shown || placeholder).length + 1))}
      title={name || fallback === 'project' ? 'Project name, used for saves and exports' : `Project name; until set, exports use “${fallback}”`}
      onFocus={() => setTyped(name ?? '')}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={() => {
        if (!dropped.current && typed !== null) useStore.getState().setProjectName(typed)
        dropped.current = false
        setTyped(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          // The field takes the key: the name goes back, and nothing else
          // the key would close is closed.
          e.preventDefault()
          dropped.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** How many of its folds the bar takes — see the top bar in styles.css —
 *  when everything spelled out does not fit its row. */
const FOLDS = 8

/** What the fold depends on, read without asking the page for a layout: the
 *  words, how many things hold them, the class that sets the bar's mode, and
 *  which tab is open, since from the fourth fold on only that tab shows its
 *  word, so the row's width follows the tab with no change of text. The
 *  project's name sits in an input, whose words are not the bar's text: its
 *  size, which follows the name, stands in for them. */
function signature(el: HTMLElement) {
  const open = el.querySelector('.modeswitch .on')?.getAttribute('data-test')
  const name = el.querySelector<HTMLInputElement>('.projectname')?.size
  return el.textContent + '|' + el.childElementCount + '|' + el.className + '|' + open + '|' + name
}

/** Folds the bar just as far as its row needs, and marks the ends with keys
 *  scrolled out of sight ('start', 'end' or both) for the fade that says
 *  there is more that way. Measured rather than set by window width, since
 *  what the bar holds varies: the plugins' tabs, a part chip, the agent chip.
 *  It measures with nothing squeezed (see .top.measuring), so the words go
 *  before the part's name is cut to an ellipsis. Written to
 *  the bar directly, so a fit costs no render; it runs after every render of
 *  the bar — a chip coming or going changes the row and not the bar — and
 *  whenever the bar's own width changes. A render that left the bar's content
 *  as it was (a tab tap re-renders the bar for the highlight alone) is told
 *  apart without a layout read and skipped: each fit forces the page's layout
 *  several times over, which is most of what such a tap costs. The resize and
 *  font paths always fit, as then it is the width, not the content, that moved. */
function useFit(ref: RefObject<HTMLElement | null>) {
  const fit = useRef((_force?: boolean) => {})
  const last = useRef('')
  fit.current = (force) => {
    const el = ref.current
    if (!el) return
    if (!force && signature(el) === last.current) return
    el.classList.add('measuring')
    for (let fold = 0; ; fold++) {
      el.dataset.fold = Array.from({ length: fold }, (_, i) => i + 1).join(' ')
      if (fold === FOLDS || el.scrollWidth <= el.clientWidth) break
    }
    el.classList.remove('measuring')
    // Folded to the last, the tabs scroll on their own: keep the open one in view.
    if (el.dataset.fold?.split(' ').includes('8')) el.querySelector<HTMLElement>('.modeswitch button.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    markEnds(el)
    // Taken after the fold and the measuring class are settled, so what is
    // remembered is what the next render will be compared with.
    last.current = signature(el)
  }
  useLayoutEffect(() => fit.current())
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => markEnds(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    // The web fonts arriving widen every word.
    document.fonts?.ready.then(() => fit.current(true))
    if (typeof ResizeObserver === 'undefined') return () => el.removeEventListener('scroll', onScroll)
    const observer = new ResizeObserver(() => fit.current(true))
    observer.observe(el)
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [ref])
}

function markEnds(el: HTMLElement) {
  const over = el.scrollWidth - el.clientWidth
  const ends = [el.scrollLeft > 1 && 'start', el.scrollLeft < over - 1 && 'end'].filter(Boolean).join(' ')
  if (ends) el.dataset.hidden = ends
  else delete el.dataset.hidden
}

export function TopBar({
  onNewProject,
  onSaveProject,
  onOpenProject,
  onOpenScan,
  onOpenImage,
  savable,
  recovery,
}: {
  onNewProject: () => void
  onSaveProject: () => void
  onOpenProject: (file: File) => void
  onOpenScan: (file: File) => void
  onOpenImage: (file: File) => void
  savable: boolean
  recovery: RecoveryStatus
}) {
  const fileName = useStore((s) => s.fileName)
  const triangleCount = useStore((s) => s.triangleCount)
  const vertexCount = useStore((s) => s.vertexCount)
  const busy = useStore((s) => s.busy)
  const workspace = useShell((s) => s.workspace)
  const setWorkspace = useShell((s) => s.setWorkspace)
  const picking = useDeviation((s) => s.picking)
  const openSettings = usePrefs((s) => s.openSettings)
  const agentLink = usePrefs((s) => s.agentLink)
  const agent = useAgentLink()
  const openRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLElement>(null)
  useFit(barRef)

  const onLoad = (file: File | undefined) => {
    if (file) {
      if (isProjectFile(file.name)) onOpenProject(file)
      else if (isImageFile(file.name)) {
        onOpenImage(file)
      } else if (isModelFile(file.name) || modelFormatOf(file.name)) onOpenScan(file)
      else
        // A project saved under a name the browser made up opens by what it
        // holds.
        void holdsProject(file).then((project) =>
          project
            ? onOpenProject(file)
            : useStore
                .getState()
                .setError(
                  isTextureFile(file.name)
                    ? `${file.name} is part of a textured scan — open it together with its OBJ (select the OBJ, the .mtl and the image at once).`
                    : `Unsupported file type — use a .${PROJECT_EXTENSION} project, STL, PLY, OBJ, 3MF, STEP, PNG or JPEG.`,
                ),
        )
    }
    // Allow re-picking the same file.
    if (openRef.current) openRef.current.value = ''
  }

  return (
    <header className="top" ref={barRef}>
      <img className="brandmark" src="/scanruler-mark.svg" alt="" />
      {/* The version rides in the caption, and in the tooltip for the narrow
          layouts that drop the caption: a bug report needs the number, and
          the imprint carries it too. */}
      <div className="brand" title={`ScanRuler v${APP_VERSION}`}>
        <b>ScanRuler</b>
        <span>
          CNC Kitchen · 3D scan analysis ·{' '}
          <i className="ver" data-test="app-version">
            v{APP_VERSION}
          </i>
        </span>
      </div>
      {/* Both workspaces share the loaded scan, the scene and the camera, so
          switching is free and neither side loses what it had. */}
      <TabStrip>
        <div className="modeswitch" role="tablist">
        {workspaceTabs().map((w) => (
          <button
            key={w.id}
            role="tab"
            data-test={`workspace-${w.id}`}
            aria-selected={w.pages.includes(workspace)}
            className={[w.pages.includes(workspace) ? 'on' : '', w.opens ? 'tabgap' : ''].filter(Boolean).join(' ') || undefined}
            title={`${w.label}\n${w.title}`}
            aria-label={w.label}
            disabled={picking}
            onClick={() => setWorkspace(pageToOpen(w))}
          >
            <Icon name={w.icon} size={16} />
            <span className="wtxt">{w.label}</span>
          </button>
        ))}
        </div>
      </TabStrip>
      <ProjectName />
      {fileName && (
        <div className="partchip file-info" title={fileName}>
          <b>{fileName}</b>
          <span>
            {triangleCount.toLocaleString('en-US')} triangles ·{' '}
            {vertexCount.toLocaleString('en-US')} vertices
          </span>
        </div>
      )}
      <div className="grow" />
      {/* While the agent connection is on, where it stands — and the way to
          its settings. */}
      {agentLink && (
        <button
          className={`agentchip ${agent.status}`}
          data-test="agent-chip"
          title={`${AGENT_STATUS[agent.status]}${agent.detail ? ` — ${agent.detail}` : ''}. Settings → Agents.`}
          onClick={() => openSettings(true)}
        >
          <span className="agentlamp" />
          <span className="btxt">
            Agent: {agent.status === 'connected' ? 'connected' : agent.status === 'refused' ? 'turned away' : 'listening'}
          </span>
        </button>
      )}
      <span className="project-save-status" data-test="project-save-status"
        title={`${recovery.status || 'Checkpoints stay in this browser.'} Save Project for a portable copy.`}>
        {recovery.dirty ? 'Unsaved changes' : 'No unsaved changes'}
        {recovery.status && <small role="status">{recovery.status}</small>}
      </span>
      <UndoRedo />
      <input
        ref={openRef}
        type="file"
        accept={`${PROJECT_ACCEPT},${withPluginFormats(SCAN_ACCEPT)},${IMAGE_ACCEPT}`}
        multiple
        hidden
        data-test="project-input"
        onChange={(e) => onLoad(bundleFiles(Array.from(e.target.files ?? [])) ?? undefined)}
      />
      <button
        className="ghost withicon"
        data-test="new-project"
        onClick={onNewProject}
        disabled={busy}
        title="Start a new project (asks if there are unsaved changes)"
      >
        <Icon name="newProject" size={16} />
        <span className="btxt">New<span className="ptxt"> Project</span></span>
      </button>
      <button
        className="ghost withicon"
        data-test="save-project"
        onClick={onSaveProject}
        disabled={busy || !savable}
        title={`Save everything as one .${PROJECT_EXTENSION} file`}
      >
        <Icon name="save" size={16} />
        <span className="btxt">Save<span className="ptxt"> Project</span></span>
      </button>
      <button
        className="ghost withicon"
        data-test="load-project"
        onClick={() => openRef.current?.click()}
        disabled={busy}
        title={`Open a project, scan or image`}
      >
        <Icon name="load" size={16} />
        <span className="btxt">Load<span className="ptxt"> Project</span></span>
      </button>
      {/* What is set once and left — the chassis, the colour mode, the mouse
          controls, the line weights, the hints. Beside the project keys
          because it is about the instrument rather than about any workspace. */}
      <button
        className="ghost withicon"
        data-test="open-settings"
        onClick={() => openSettings(true)}
        title="Theme, mouse controls and other settings"
      >
        <Icon name="settings" size={16} />
        <span className="btxt"> Settings</span>
      </button>
      <a
        className="iconbtn"
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={sourceTitle()}
        aria-label={sourceTitle()}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </a>
    </header>
  )
}
