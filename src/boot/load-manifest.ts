import { DEFAULT_IMAGE, type ImageManifest } from './image-manifest';

/**
 * At build time the image size may differ from the hardcoded default.
 * `scripts/fetch-image.mjs` writes /public/images/alpine.manifest.json
 * with the actual size. We try to fetch it, fall back to the default.
 */
export async function loadImageManifest(): Promise<ImageManifest> {
  try {
    const res = await fetch('/images/alpine.manifest.json', { cache: 'no-cache' });
    if (!res.ok) return DEFAULT_IMAGE;
    const j = (await res.json()) as Partial<ImageManifest>;
    return { ...DEFAULT_IMAGE, ...j };
  } catch {
    return DEFAULT_IMAGE;
  }
}
