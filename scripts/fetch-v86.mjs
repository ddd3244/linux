#!/usr/bin/env node
// Fetch pinned v86 release artifacts into /public/v86.
//
// v86 publishes build artifacts as release assets on GitHub (tag `latest`,
// updated by their CI). BIOS files live in the `bios/` directory of the
// source repo. We pull from both and fail loudly if either is unreachable.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, '..');
const OUT = pathResolve(ROOT, 'public/v86');

// v86 publishes to the `latest` release tag via CI. We pin to that tag
// intentionally; bump by wiping public/v86 and re-running.
const RELEASE_TAG = 'latest';
const REPO_REF = 'master';

const FILES = [
  {
    url: `https://github.com/copy/v86/releases/download/${RELEASE_TAG}/libv86.js`,
    dest: 'libv86.js',
  },
  {
    url: `https://github.com/copy/v86/releases/download/${RELEASE_TAG}/v86.wasm`,
    dest: 'v86.wasm',
  },
  {
    url: `https://raw.githubusercontent.com/copy/v86/${REPO_REF}/bios/seabios.bin`,
    dest: 'bios/seabios.bin',
  },
  {
    url: `https://raw.githubusercontent.com/copy/v86/${REPO_REF}/bios/vgabios.bin`,
    dest: 'bios/vgabios.bin',
  },
];

async function download(url, destAbs) {
  // redirect: 'follow' is default, but be explicit — release URLs 302 to S3.
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  await mkdir(dirname(destAbs), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destAbs));
}

async function exists(p) {
  try {
    const s = await stat(p);
    // Treat empty files as missing; prior aborted fetches may have left them.
    return s.size > 0 ? s : null;
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let failed = false;
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
      failed = true;
    }
  }
  const readme = `# /public/v86

Vendored v86 build artifacts. Fetched by scripts/fetch-v86.mjs.
- libv86.js, v86.wasm: from release tag \`${RELEASE_TAG}\`
- bios/: from \`master\`
Do not commit — re-run the script.
`;
  await writeFile(pathResolve(OUT, 'README.md'), readme);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
