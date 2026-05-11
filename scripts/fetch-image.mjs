#!/usr/bin/env node
// Fetch a default Linux image for v86.
//
// Default profile is `linux-iso` — a ~5.5 MB bootable Linux ISO shipped by
// the v86 project (copy/images on GitHub). Fast first-load, no userland
// package manager, perfect for a public demo on GitHub Pages.
//
// For a bigger distro, pass --profile alpine or override --url.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, resolve as pathResolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, '..');
const OUT_DIR = pathResolve(ROOT, 'public/images');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    profile: process.env.BROWSER_LINUX_PROFILE ?? 'linux-iso',
    url: null,
    name: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile') out.profile = args[++i];
    else if (args[i] === '--url') out.url = args[++i];
    else if (args[i] === '--name') out.name = args[++i];
  }
  return out;
}

const PROFILES = {
  // Small bootable Linux ISO from the v86 images repo. Works with `hda` +
  // autostart. ~5.5 MB.
  'linux-iso': {
    kind: 'disk',
    hda: {
      url: 'https://raw.githubusercontent.com/copy/images/master/linux.iso',
      name: 'linux.iso',
    },
    recommendedMemoryMiB: 128,
    id: 'linux-iso-tty',
    displayName: 'Linux (v86 demo ISO, TTY)',
  },
  // A full Alpine disk image. Users should point --url at their own
  // alpine-make-vm-image output.
  alpine: {
    kind: 'disk',
    hda: {
      url: 'https://raw.githubusercontent.com/copy/images/master/linux.iso',
      name: 'alpine.img',
    },
    recommendedMemoryMiB: 256,
    id: 'alpine-3.19-x86',
    displayName: 'Alpine Linux (x86, TTY)',
  },
};

async function exists(p) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

async function download(url, dest) {
  const existing = await exists(dest);
  if (existing && existing.size > 1024) {
    console.log(`ok  images/${basename(dest)} (cached, ${existing.size} B)`);
    return existing.size;
  }
  console.log(`get ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return (await stat(dest)).size;
}

async function main() {
  const { profile, url, name } = parseArgs();
  await mkdir(OUT_DIR, { recursive: true });

  const spec = PROFILES[profile];
  if (!spec) {
    console.error(`unknown profile: ${profile}`);
    console.error(`known: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }

  const targetName = name ?? spec.hda.name;
  const target = pathResolve(OUT_DIR, targetName);
  const size = await download(url ?? spec.hda.url, target);
  const manifest = {
    id: spec.id,
    displayName: spec.displayName,
    kind: 'disk',
    hdaUrl: '/images/' + basename(target),
    hdaSize: size,
    recommendedMemoryMiB: spec.recommendedMemoryMiB,
  };
  await writeFile(pathResolve(OUT_DIR, 'alpine.manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('ok  images/alpine.manifest.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
