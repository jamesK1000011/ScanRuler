// SPDX-License-Identifier: AGPL-3.0-only
// One model the workspace needs, in the left panel. Shared by both
// workspaces, so a scan is opened the same way in either.

import { useRef, type RefObject } from 'react'
import { SCAN_ACCEPT, SCAN_FORMATS } from '../core/formats'
import { usePulse } from '../app/useHints'
import { bundleFiles } from '../app/scanFiles'
import { withPluginFormats } from '../app/modelFormats'

/** A file input out of sight, opened through `inputRef` by the key that
 *  stands for it, and emptied after every pick so the same file can come
 *  again; a model's picker offers the plugins' formats too
 *  (app/modelFormats). Several files may be picked where the scan is opened — a
 *  textured OBJ with its material library and image — and the model among
 *  them is what opens, the rest riding on it (see app/scanFiles). */
export function HiddenFileInput({ inputRef, accept, onOpen, multiple = false }: { inputRef: RefObject<HTMLInputElement | null>; accept: string; onOpen: (file: File) => void; multiple?: boolean }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={withPluginFormats(accept)}
      multiple={multiple}
      hidden
      onChange={(e) => {
        const f = bundleFiles(Array.from(e.target.files ?? []))
        if (f) onOpen(f)
        e.target.value = ''
      }}
    />
  )
}

export function ModelSlot({
  role,
  name,
  detail,
  dotColor,
  busy,
  accept = SCAN_ACCEPT,
  formats = SCAN_FORMATS,
  onOpen,
}: {
  role: string
  name: string | null
  detail: string
  dotColor: string
  busy: boolean
  /** What the file picker offers — the scan's, with a texture's files,
   *  unless the slot says otherwise. */
  accept?: string
  /** The same list in prose, for the empty slot. */
  formats?: string
  onOpen: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const slot = role.toLowerCase()
  const pulse = usePulse(`open-${slot}`)
  return (
    <div className="slot" data-test={`slot-${slot}`}>
      <HiddenFileInput inputRef={inputRef} accept={accept} onOpen={onOpen} multiple={accept === SCAN_ACCEPT} />
      <span
        className="dot"
        style={{ background: name ? dotColor : 'transparent', borderColor: dotColor }}
      />
      <div className="slotname">
        <b title={name ?? undefined}>{name ?? `No ${role.toLowerCase()} loaded`}</b>
        <span>{name ? detail : formats}</span>
      </div>
      <button
        data-test={`open-${slot}`}
        className={pulse ? 'pulse' : undefined}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {name ? 'Replace…' : 'Open…'}
      </button>
    </div>
  )
}
