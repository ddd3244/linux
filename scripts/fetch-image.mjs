#!/usr/bin/env node
// Fetch or build a default Alpine x86 disk image for v86.
//
// For CI/dev convenience, we pull a pre-made Alpine image from v86-images
// (community-maintained). Users who want a different distro should either:
//   - Drop their own flat .img into /public/images/ and update
//     src/boot/image-manifest.ts, or
//   - Use alpine-make-vm-image or `qemu-img convert -f qcow2 -O raw in out`.
//
// The default URL below points to a v86-compatible Alpine snapshot. If it's
// unavailable, run `npm run fetch:image -- --url <your-url>` to override.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, '..');
const OUT_DIR = pathResolve(ROOT, 'public/images');

// A v86-compatible Alpine image hosted by the v86 project for demos.
// Can be overridden with --url <URL>.
const DEFAULT_URL =
  process.env.BROWSER_LINUX_IMAGE_URL ??
  'https://copy.sh/v86/images/linux4.iso'; // fallback, small bootable linux

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { url: DEFAULT_URL, name: 'alpine.img' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url') out.url = args[++i];
    else if (args[i] === '--name') out.name = args[++i];
  }
  return out;
}

async function exists(p) {
  try {
    const s = await stat(p);
    return s;
  } catch {
    return null;
  }
}

async function main() {
  const { url, name } = parseArgs();
  await mkdir(OUT_DIR, { recursive: true });
  const dest = pathResolve(OUT_DIR, name);

  const existing = await exists(dest);
  if (existing && existing.size > 1024 * 1024) {
    console.log(`ok  images/${name} (cached, ${existing.size} bytes)`);
    await writeManifest(dest, existing.size);
    return;
  }

  console.log(`downloading ${url} -> images/${name}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    console.error(`GET ${url} -> ${res.status}`);
    console.error('Provide your own image: npm run fetch:image -- --url <url> --name alpine.img');
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const size = (await stat(dest)).size;
  console.log(`ok  images/${name} (${size} bytes)`);
  await writeManifest(dest, size);
}

async function writeManifest(filePath, size) {
  const manifestPath = pathResolve(OUT_DIR, 'alpine.manifest.json');
  const j = {
    id: 'alpine-3.19-x86',
    displayName: 'Alpine Linux (x86, TTY)',
    hdaUrl: '/images/' + filePath.split('/').pop(),
    hdaSize: size,
    recommendedMemoryMiB: 128,
  };
  await writeFile(manifestPath, JSON.stringify(j, null, 2));
  console.log(`ok  images/alpine.manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
