// SPDX-License-Identifier: AGPL-3.0-only
export function stlBytes(positions: Float32Array, normals?: Float32Array | null): Uint8Array
export function threeMfBytes(positions: Float32Array, shouldAbort?: () => boolean): Promise<Uint8Array>
