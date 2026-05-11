import { loadV86 } from './v86-loader';
import { asset } from '@/config';
import type { V86DownloadProgress, V86Instance, V86Options } from './v86-types';
import type { ImageManifest } from '@/boot/image-manifest';

export type EmulatorStatus =
  | 'idle'
  | 'loading-emulator'
  | 'downloading-image'
  | 'booting'
  | 'running'
  | 'stopped'
  | 'error';

export interface EmulatorConfig {
  /** Manifest describing what to boot (disk image OR kernel+initrd). */
  image: ImageManifest;
  /** RAM in MiB (128..512 recommended). */
  memoryMiB: number;
  /** WebSocket relay for networking (wss://...). */
  networkRelayUrl?: string;
  /** Mount <div> that will receive the VGA canvas (even if we mostly use serial). */
  screenContainer: HTMLElement;
  /** Called on any status transition. */
  onStatus: (status: EmulatorStatus, detail?: string) => void;
  /** Progress for image download (0..1) or null if unknown. */
  onDownloadProgress?: (ratio: number | null, bytesLoaded: number, bytesTotal: number) => void;
  /** Bytes written to serial0 (the kernel console). */
  onSerialOutput: (byte: number) => void;
}

/**
 * Wraps a v86 instance. Owns lifecycle (start/stop/snapshot/restore) and
 * exposes a tiny API that the terminal and UI use.
 *
 * Deliberately does NOT pull React/DOM in — emulator is a plain class.
 */
export class Emulator {
  private v86: V86Instance | null = null;
  private status: EmulatorStatus = 'idle';
  private config: EmulatorConfig;
  private serialListener = (data: unknown): void => {
    // v86 emits either a number (byte) or a string (legacy). Normalize to byte.
    if (typeof data === 'number') {
      this.config.onSerialOutput(data);
    } else if (typeof data === 'string') {
      for (let i = 0; i < data.length; i++) {
        this.config.onSerialOutput(data.charCodeAt(i));
      }
    }
  };

  constructor(config: EmulatorConfig) {
    this.config = config;
  }

  getStatus(): EmulatorStatus {
    return this.status;
  }

  private setStatus(next: EmulatorStatus, detail?: string): void {
    this.status = next;
    this.config.onStatus(next, detail);
  }

  async start(): Promise<void> {
    if (this.v86) throw new Error('Emulator already started');
    this.setStatus('loading-emulator');

    const V86 = await loadV86();

    const opts: V86Options = {
      wasm_path: asset('/v86/v86.wasm'),
      memory_size: this.config.memoryMiB * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      screen_container: this.config.screenContainer,
      bios: { url: asset('/v86/bios/seabios.bin') },
      vga_bios: { url: asset('/v86/bios/vgabios.bin') },
      autostart: true,
      disable_speaker: false,
      acpi: true,
      uart1: false,
      uart2: false,
      uart3: false,
    };

    const img = this.config.image;
    if (img.kind === 'disk') {
      opts.hda = { url: img.hdaUrl, async: true, size: img.hdaSize };
      if (img.initialStateUrl) {
        opts.initial_state = { url: img.initialStateUrl };
      }
    } else {
      // Kernel boot path: bzImage + (optional) initrd + cmdline.
      opts.bzimage = { url: img.bzimageUrl, async: true, size: img.bzimageSize };
      if (img.initrdUrl && img.initrdSize) {
        opts.initrd = { url: img.initrdUrl, async: true, size: img.initrdSize };
      }
      opts.cmdline = img.cmdline;
    }

    if (this.config.networkRelayUrl) {
      opts.network_relay_url = this.config.networkRelayUrl;
    }

    this.setStatus('downloading-image');

    const v86 = new V86(opts);
    this.v86 = v86;

    v86.add_listener('download-progress', (raw) => {
      const p = raw as V86DownloadProgress;
      if (!this.config.onDownloadProgress) return;
      const ratio = p.lengthComputable && p.total > 0 ? p.loaded / p.total : null;
      this.config.onDownloadProgress(ratio, p.loaded, p.total);
    });

    v86.add_listener('emulator-ready', () => this.setStatus('booting'));
    v86.add_listener('emulator-started', () => this.setStatus('running'));
    v86.add_listener('emulator-stopped', () => this.setStatus('stopped'));
    v86.add_listener('download-error', (e) => {
      this.setStatus('error', `Image download failed: ${describe(e)}`);
    });

    // Prefer the byte-level event; fall back to char event for older builds.
    v86.add_listener('serial0-output-byte', this.serialListener);
    v86.add_listener('serial0-output-char', this.serialListener);
  }

  /** Send raw UTF-8 text from the terminal to the VM's stdin. */
  sendSerial(input: string): void {
    if (!this.v86) return;
    this.v86.serial0_send(input);
  }

  /** Save the full VM state as a Blob (used for persistence / fast boot). */
  async saveState(): Promise<ArrayBuffer> {
    if (!this.v86) throw new Error('Emulator not running');
    return this.v86.save_state();
  }

  async restoreState(state: ArrayBuffer): Promise<void> {
    if (!this.v86) throw new Error('Emulator not running');
    await this.v86.restore_state(state);
  }

  async stop(): Promise<void> {
    if (!this.v86) return;
    try {
      await this.v86.stop();
    } catch (err) {
      console.warn('v86.stop() threw:', err);
    }
    try {
      this.v86.destroy?.();
    } catch {
      /* ignore */
    }
    this.v86 = null;
    this.setStatus('stopped');
  }

  /** Screenshot the graphical console (useful for splash / debugging). */
  screenshot(): HTMLCanvasElement | null {
    return this.v86?.screen_make_screenshot() ?? null;
  }
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
