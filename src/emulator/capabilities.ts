/**
 * Runtime capability detection.
 *
 * v86 runs best when:
 *   - `WebAssembly` is available (obviously)
 *   - `SharedArrayBuffer` is available (requires COOP/COEP headers)
 *   - `crossOriginIsolated === true`
 *
 * On mobile Safari SharedArrayBuffer is gated behind crossOriginIsolated AND a
 * same-origin top-level document. We detect the full situation and surface it
 * so the UI can warn the user *before* starting a 30 MB download.
 */
export interface Capabilities {
  wasm: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  opfs: boolean;
  indexedDb: boolean;
  clipboardRead: boolean;
  clipboardWrite: boolean;
  webAudio: boolean;
  /** Rough "can we actually run a VM acceptably" heuristic. */
  recommended: boolean;
  warnings: string[];
}

export function detectCapabilities(): Capabilities {
  const warnings: string[] = [];

  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  if (!wasm) warnings.push('WebAssembly is not available; v86 cannot start.');

  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const crossOriginIsolated =
    typeof self !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

  if (!sharedArrayBuffer || !crossOriginIsolated) {
    warnings.push(
      'SharedArrayBuffer / crossOriginIsolated unavailable. The VM will still run, ' +
        'but noticeably slower. Configure COOP=same-origin and COEP=require-corp headers.',
    );
  }

  const opfs =
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof (navigator.storage as { getDirectory?: () => unknown }).getDirectory === 'function';

  const indexedDb = typeof indexedDB !== 'undefined';
  if (!indexedDb) warnings.push('IndexedDB is unavailable; persistence will be disabled.');

  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  const clipboardRead = !!clip && typeof clip.readText === 'function';
  const clipboardWrite = !!clip && typeof clip.writeText === 'function';

  const webAudio =
    typeof window !== 'undefined' &&
    (typeof window.AudioContext !== 'undefined' ||
      typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');

  const recommended = wasm && indexedDb;

  return {
    wasm,
    sharedArrayBuffer,
    crossOriginIsolated,
    opfs,
    indexedDb,
    clipboardRead,
    clipboardWrite,
    webAudio,
    recommended,
    warnings,
  };
}
