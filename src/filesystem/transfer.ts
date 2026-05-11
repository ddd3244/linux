/**
 * File transfer helpers between the host browser and the VM.
 *
 * v86 does not expose a direct "mount host FS" path; the pragmatic
 * approach used by v86-based projects is to paste file contents into
 * the guest via base64 + a here-doc. This is slow for large files but
 * simple, reliable, and needs no guest agent.
 *
 * For larger uploads, prefer networking (e.g., `curl` inside the guest
 * to fetch from the proxy). That path lives in /src/network.
 */

import type { Emulator } from '@/emulator/emulator';

const CHUNK = 4096;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Upload a small file (≲5 MB) by typing it into the shell as base64 here-doc.
 * Returns the guest path, which is always /tmp/<name>.
 */
export async function uploadFileToGuest(
  emulator: Emulator,
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const guestPath = `/tmp/${sanitizeName(file.name)}`;

  // Start a base64 decoder on the guest.
  emulator.sendSerial(`cat > ${guestPath}.b64 <<'__BL_EOF__'\n`);

  for (let off = 0; off < buf.length; off += CHUNK) {
    const chunk = buf.subarray(off, Math.min(off + CHUNK, buf.length));
    const encoded = toBase64(chunk);
    emulator.sendSerial(encoded + '\n');
    onProgress?.(Math.min(1, (off + chunk.length) / Math.max(1, buf.length)));
    // Yield to the event loop to avoid blocking the terminal.
    await new Promise((r) => setTimeout(r, 0));
  }

  emulator.sendSerial('__BL_EOF__\n');
  emulator.sendSerial(`base64 -d ${guestPath}.b64 > ${guestPath} && rm ${guestPath}.b64\n`);
  emulator.sendSerial(`echo "uploaded: ${guestPath} ($(stat -c %s ${guestPath}) bytes)"\n`);
  return guestPath;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Export a blob (e.g., state snapshot) as a downloadable file on the host.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
