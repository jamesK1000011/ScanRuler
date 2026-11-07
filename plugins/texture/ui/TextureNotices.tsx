// SPDX-License-Identifier: AGPL-3.0-only
// What the imprint owes the software the Texture workspace ships.
import VERSION from '../bumpmesh/VERSION.json'

export function TextureNotices() {
  return (
    <p>
      The Texture workspace runs <b>BumpMesh</b> {VERSION.bumpmesh} by CNC Kitchen (Stefan Hermann) and contributors —
      its texturing engine and texture library — under the GNU Affero General Public License v3.0. Some library
      textures are derived from Hero Patterns (CC BY 4.0) and from ambientCG and Poly Haven (CC0).
    </p>
  )
}
