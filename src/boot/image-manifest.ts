/**
 * Manifest for the default shipped Linux image.
 *
 * The image is a flat disk image (not qcow2) because v86's async loader only
 * supports raw. We describe the file so the emulator knows its total size
 * (required for chunked range requests).
 *
 * Produce the image with `scripts/fetch-image.mjs` or build your own via
 * alpine-make-vm-image. Place it at /public/images/<name>.
 */

export interface ImageManifest {
  /** Human name for UI. */
  displayName: string;
  /** URL that resolves to a flat raw disk image. */
  hdaUrl: string;
  /** File size in bytes (exact). */
  hdaSize: number;
  /** Optional state snapshot URL for fast boot. */
  initialStateUrl?: string;
  /** Recommended RAM in MiB for this image. */
  recommendedMemoryMiB: number;
  /** Stable ID used as IndexedDB key for saved state. */
  id: string;
}

export const DEFAULT_IMAGE: ImageManifest = {
  id: 'alpine-3.19-x86',
  displayName: 'Alpine Linux 3.19 (x86, TTY)',
  hdaUrl: '/images/alpine.img',
  // Actual bytes of /public/images/alpine.img, filled by fetch-image.mjs
  // (the script writes `images.manifest.json` next to it).
  hdaSize: 134_217_728,
  recommendedMemoryMiB: 128,
};
