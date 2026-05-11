/**
 * Thin wrapper over the Origin Private File System for host-side file
 * stash (e.g. uploads queued for push into the guest, or session logs).
 *
 * This is *not* used for v86 state (see state-store.ts for the reason).
 * Use it for things the user produces on the host and wants to keep
 * across sessions.
 */

export interface OpfsFileInfo {
  name: string;
  size: number;
  lastModified: number;
}

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('OPFS not supported in this browser');
  }
  return await navigator.storage.getDirectory();
}

export async function opfsAvailable(): Promise<boolean> {
  try {
    await root();
    return true;
  } catch {
    return false;
  }
}

export async function opfsWriteBlob(path: string, blob: Blob): Promise<void> {
  const r = await root();
  const handle = await r.getFileHandle(path, { create: true });
  // Note: createWritable is not supported in Safari on the main thread as of
  // mid-2024; this code path is best-effort. Callers should catch and fall
  // back to downloadBlob().
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

export async function opfsReadBlob(path: string): Promise<Blob | null> {
  try {
    const r = await root();
    const handle = await r.getFileHandle(path);
    const file = await handle.getFile();
    return file;
  } catch {
    return null;
  }
}

export async function opfsList(): Promise<OpfsFileInfo[]> {
  const r = await root();
  const out: OpfsFileInfo[] = [];
  // Types for FileSystemDirectoryHandle iteration aren't in every lib version; be defensive.
  const iter = (r as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
  for await (const h of iter) {
    if (h.kind === 'file') {
      const file = await (h as FileSystemFileHandle).getFile();
      out.push({ name: h.name, size: file.size, lastModified: file.lastModified });
    }
  }
  return out;
}

export async function opfsDelete(path: string): Promise<void> {
  const r = await root();
  await r.removeEntry(path, { recursive: false });
}
