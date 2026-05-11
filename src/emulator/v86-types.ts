/**
 * Minimal, hand-rolled TypeScript types for v86 (BSD-2).
 *
 * v86 does not ship `.d.ts` files. The official reference is the README and
 * the `libv86.js` source. We type only the subset we actually use. If you need
 * more, extend here rather than scatter `as any` across the app.
 *
 * Source of truth: https://github.com/copy/v86 (README.md "API" section).
 */

export type V86FileDescriptor =
  | { url: string; async?: boolean; size?: number }
  | { buffer: ArrayBuffer | Uint8Array }
  | null;

export interface V86NetworkAdapter {
  /** WebSocket relay URL (wss://...). */
  relay_url: string;
}

export interface V86Options {
  wasm_path: string;
  memory_size: number;
  vga_memory_size?: number;
  screen_container?: HTMLElement | null;
  bios?: V86FileDescriptor;
  vga_bios?: V86FileDescriptor;
  cdrom?: V86FileDescriptor;
  hda?: V86FileDescriptor;
  initial_state?: V86FileDescriptor;
  filesystem?: {
    basefs?: string;
    baseurl?: string;
  };
  initrd?: V86FileDescriptor;
  bzimage?: V86FileDescriptor;
  cmdline?: string;
  autostart?: boolean;
  disable_keyboard?: boolean;
  disable_mouse?: boolean;
  disable_speaker?: boolean;
  network_relay_url?: string;
  acpi?: boolean;
  preserve_mac_from_state_image?: boolean;
  uart1?: boolean;
  uart2?: boolean;
  uart3?: boolean;
}

export type V86SerialData = number; // single byte
export type V86Event =
  | 'emulator-ready'
  | 'emulator-started'
  | 'emulator-stopped'
  | 'emulator-loaded'
  | 'download-progress'
  | 'download-error'
  | 'serial0-output-byte'
  | 'serial0-output-char' // legacy, still emitted
  | 'mouse-enable'
  | 'screen-set-size-graphical'
  | 'screen-set-size-text'
  | 'net0-send'
  | 'net0-receive';

export interface V86DownloadProgress {
  file_index: number;
  file_count: number;
  file_name: string;
  lengthComputable: boolean;
  total: number;
  loaded: number;
}

export interface V86Instance {
  run(): Promise<void> | void;
  stop(): Promise<void> | void;
  restart(): void;
  destroy?(): void;

  /** Send a single byte to serial0 (stdin of the kernel console). */
  serial0_send(data: string): void;

  /** Event bus. */
  add_listener(event: V86Event, cb: (data: unknown) => void): void;
  remove_listener(event: V86Event, cb: (data: unknown) => void): void;

  /** State save/restore — used for persistence. */
  save_state(): Promise<ArrayBuffer>;
  restore_state(state: ArrayBuffer): Promise<void> | void;

  /** Keyboard. */
  keyboard_send_scancodes(codes: number[]): void;
  keyboard_send_text(text: string): void;

  /** Screen. */
  screen_make_screenshot(): HTMLCanvasElement | null;
}

/**
 * v86 exposes a global `V86` constructor (sometimes `V86Starter` in older builds).
 * We do a runtime lookup in the loader.
 */
export type V86Ctor = new (opts: V86Options) => V86Instance;

declare global {
  interface Window {
    V86?: V86Ctor;
    V86Starter?: V86Ctor;
  }
}
