import type { V86Ctor } from './v86-types';
import { asset } from '@/config';

/**
 * Loads `libv86.js` from /public/v86/ at runtime.
 *
 * Why not `import`?
 *   libv86 attaches itself to `window` and is a big UMD blob. Importing it
 *   through Vite's dep-optimizer makes cold starts painful and has historically
 *   tripped up module resolution. A plain <script> tag is the officially
 *   documented way.
 *
 * The script, the WASM file, and the BIOSes are expected at:
 *   /v86/libv86.js
 *   /v86/v86.wasm
 *   /v86/bios/seabios.bin
 *   /v86/bios/vgabios.bin
 *
 * Use `npm run fetch:v86` to populate them.
 */

let loadingPromise: Promise<V86Ctor> | null = null;

export function loadV86(scriptUrl = asset('/v86/libv86.js')): Promise<V86Ctor> {
  if (loadingPromise) return loadingPromise;

  if (typeof window === 'undefined') {
    return Promise.reject(new Error('v86 can only be loaded in the browser'));
  }

  if (window.V86) return Promise.resolve(window.V86);
  if (window.V86Starter) return Promise.resolve(window.V86Starter);

  loadingPromise = new Promise<V86Ctor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-v86-loader][src="${scriptUrl}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolveCtor(resolve, reject));
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${scriptUrl}`)));
      return;
    }

    const s = document.createElement('script');
    s.src = scriptUrl;
    s.async = true;
    s.dataset.v86Loader = '1';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolveCtor(resolve, reject);
    s.onerror = () =>
      reject(
        new Error(
          `Failed to load v86 from ${scriptUrl}. Did you run \`npm run fetch:v86\`?`,
        ),
      );
    document.head.appendChild(s);
  });

  return loadingPromise;
}

function resolveCtor(
  resolve: (c: V86Ctor) => void,
  reject: (e: Error) => void,
): void {
  const ctor = window.V86 ?? window.V86Starter;
  if (!ctor) {
    reject(new Error('libv86.js loaded but no V86/V86Starter constructor on window'));
    return;
  }
  resolve(ctor);
}
