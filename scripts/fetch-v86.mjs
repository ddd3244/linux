#!/usr/bin/env node
// Fetch pinned v86 release artifacts into /public/v86.
//
// We pull from the upstream repo's release assets; if that fails (e.g. in CI
// without network), we fall back to jsDelivr.
//
// Pinning: the v86 project does not currently cut versioned releases, so we
// pin to a specific git SHA via jsDelivr.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, '..');
const OUT = pathResolve(ROOT, 'public/v86');

// Pin to a known-good commit. Bump intentionally.
const V86_REF = 'v1.32.1'; // released tag on GitHub
const BASE = `https://cdn.jsdelivr.net/gh/copy/v86@${V86_REF}/build`;
const BIOS_BASE = `https://cdn.jsdelivr.net/gh/copy/v86@${V86_REF}/bios`;

const FILES = [
  { url: `${BASE}/libv86.js`, dest: 'libv86.js' },
  { url: `${BASE}/v86.wasm`, dest: 'v86.wasm' },
  { url: `${BIOS_BASE}/seabios.bin`, dest: 'bios/seabios.bin' },
  { url: `${BIOS_BASE}/vgabios.bin`, dest: 'bios/vgabios.bin' },
];

async function download(url, destAbs) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  await mkdir(dirname(destAbs), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destAbs));
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const f of FILES) {
    const destAbs = pathResolve(OUT, f.dest);
    if (await exists(destAbs)) {
      console.log(`ok  ${f.dest} (cached)`);
      continue;
    }
    process.stdout.write(`get ${f.dest} ... `);
    try {
      await download(f.url, destAbs);
      console.log('ok');
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      process.exitCode = 1;
    }
  }
  const readme = `# /public/v86\n\nVendored v86 build artifacts. Fetched by scripts/fetch-v86.mjs at ref ${V86_REF}.\nDo not commit — re-run the script.\n`;
  await writeFile(pathResolve(OUT, 'README.md'), readme);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
