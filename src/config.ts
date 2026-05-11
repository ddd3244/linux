/**
 * Centralised base-URL helper.
 *
 * Vite sets `import.meta.env.BASE_URL` from `base` in vite.config.ts. On GitHub
 * Pages the app lives under `/<repo>/`, so all paths to public assets must be
 * prefixed. Using this helper means `hdaUrl`, `wasm_path`, etc. work in both
 * `/` (self-host) and `/linux/` (Pages) deployments.
 */

const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/** Resolve a path that *looks* absolute (`/foo`) under the app's base URL. */
export function asset(path: string): string {
  if (/^[a-z]+:\/\//i.test(path)) return path; // full URL
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return BASE + clean;
}
