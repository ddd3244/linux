import { DEFAULT_IMAGE, type ImageManifest } from './image-manifest';
import { asset } from '@/config';

/**
 * At build time the image size may differ from the hardcoded default.
 * `scripts/fetch-image.mjs` writes /public/images/alpine.manifest.json
 * with the actual size. We try to fetch it, fall back to the default.
 */
export async function loadImageManifest(): Promise<ImageManifest> {
  try {
    const res = await fetch(asset('/images/alpine.manifest.json'), { cache: 'no-cache' });
    if (!res.ok) return DEFAULT_IMAGE;
    const raw = (await res.json()) as Partial<ImageManifest> & { kind?: string };
    // Backward compat: older manifests had no `kind`, they were disk-only.
    const kind = raw.kind ?? 'disk';
    if (kind === 'disk') {
      const m = raw as Partial<import('./image-manifest').DiskManifest>;
      return {
        kind: 'disk',
        id: m.id ?? 'unknown',
        displayName: m.displayName ?? 'Linux (disk)',
        hdaUrl: m.hdaUrl ? prefix(m.hdaUrl) : '',
        hdaSize: m.hdaSize ?? 0,
        ...(m.initialStateUrl ? { initialStateUrl: prefix(m.initialStateUrl) } : {}),
        recommendedMemoryMiB: m.recommendedMemoryMiB ?? 128,
      };
    }
    const m = raw as Partial<import('./image-manifest').KernelManifest>;
    return {
      kind: 'kernel',
      id: m.id ?? 'unknown',
      displayName: m.displayName ?? 'Linux (kernel)',
      bzimageUrl: m.bzimageUrl ? prefix(m.bzimageUrl) : '',
      bzimageSize: m.bzimageSize ?? 0,
      ...(m.initrdUrl ? { initrdUrl: prefix(m.initrdUrl) } : {}),
      ...(m.initrdSize ? { initrdSize: m.initrdSize } : {}),
      cmdline: m.cmdline ?? 'console=ttyS0',
      recommendedMemoryMiB: m.recommendedMemoryMiB ?? 128,
    };
  } catch {
    return DEFAULT_IMAGE;
  }
}

function prefix(p: string): string {
  return p.startsWith('/') ? asset(p) : p;
}
