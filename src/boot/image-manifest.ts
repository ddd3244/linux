/**
 * Manifest for a shipped Linux image.
 *
 * Two flavours:
 *   - kind: 'disk'  — a flat raw hda image. Big, full userland, persists
 *     user data to the image's blocks (on top of v86's saved state).
 *   - kind: 'kernel' — a bzImage + optional initrd pair. Tiny (~4 MB),
 *     instant boot, but no persistent disk. Perfect for a public demo.
 *
 * We keep a single union type so the rest of the app can treat them
 * uniformly (the boot path picks the right v86 options).
 */

export interface DiskManifest {
  kind: 'disk';
  id: string;
  displayName: string;
  /** URL to a flat raw disk image. */
  hdaUrl: string;
  /** Exact file size in bytes (v86 needs this for chunked ranges). */
  hdaSize: number;
  /** Optional state snapshot URL for fast boot. */
  initialStateUrl?: string;
  recommendedMemoryMiB: number;
}

export interface KernelManifest {
  kind: 'kernel';
  id: string;
  displayName: string;
  bzimageUrl: string;
  bzimageSize: number;
  initrdUrl?: string;
  initrdSize?: number;
  cmdline: string;
  recommendedMemoryMiB: number;
}

export type ImageManifest = DiskManifest | KernelManifest;

export const DEFAULT_IMAGE: DiskManifest = {
  kind: 'disk',
  id: 'linux-iso-tty',
  displayName: 'Linux (v86 demo ISO, TTY)',
  hdaUrl: '/images/linux.iso',
  hdaSize: 5_666_816,
  recommendedMemoryMiB: 128,
};
