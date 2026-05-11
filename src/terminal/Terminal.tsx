import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

import type { Emulator } from '@/emulator/emulator';

interface TerminalProps {
  emulator: Emulator | null;
  /**
   * The terminal decodes bytes as UTF-8. Kernel messages before userland may
   * emit partial sequences; TextDecoder with stream:true handles that.
   */
}

/**
 * xterm.js bound to v86's serial0.
 *
 * - Incoming: subscribe via `emulator.config.onSerialOutput` in App; we expose
 *   a `writeByte` method through a ref callback pattern below so App can push
 *   bytes as they arrive without re-rendering.
 * - Outgoing: xterm onData → emulator.sendSerial.
 * - Resize: FitAddon + ResizeObserver. We also notify the guest via `stty`
 *   when the user resizes.
 */
export function Terminal({ emulator }: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);

  // Expose a byte sink globally on the element so App can wire the emulator
  // callback without prop drilling a function-ref.
  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily:
        '"JetBrains Mono", "Fira Code", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 14,
      lineHeight: 1.1,
      theme: {
        background: '#0b0d12',
        foreground: '#e6e6e6',
        cursor: '#7fff7f',
        selectionBackground: '#3a3f4b',
      },
      scrollback: 5000,
      convertEol: false,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(hostRef.current);
    fit.fit();
    term.focus();
    const hostEl = hostRef.current; // capture for cleanup

    termRef.current = term;
    fitRef.current = fit;
    decoderRef.current = new TextDecoder('utf-8', { fatal: false });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const cols = term.cols;
        const rows = term.rows;
        // Best-effort: tell the guest about new size. Harmless if not a shell.
        emulator?.sendSerial(`stty cols ${cols} rows ${rows}\n`);
      } catch {
        /* ignore */
      }
    });
    ro.observe(hostEl);

    // Outgoing: xterm -> VM
    const dataSub = term.onData((data) => {
      emulator?.sendSerial(data);
    });

    // Paste handler: when user pastes big multi-line text, xterm already
    // delivers it via onData, but some keybindings (Ctrl-V in Firefox without
    // bracketed-paste support) skip it. Bind explicit DOM paste.
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text) {
        emulator?.sendSerial(text);
        e.preventDefault();
      }
    };
    hostRef.current.addEventListener('paste', onPaste);

    // Copy handler: native Ctrl+Shift+C / Cmd+C work via xterm's default
    // selection -> clipboard wiring. Nothing needed here for writing.

    // Expose a byte-level writer that App will call per serial byte.
    const bytes = new Uint8Array(1);
    (hostEl as HTMLDivElement & { __writeByte?: (b: number) => void }).__writeByte = (
      b: number,
    ) => {
      bytes[0] = b;
      const chunk = decoderRef.current!.decode(bytes, { stream: true });
      if (chunk) term.write(chunk);
    };

    return () => {
      dataSub.dispose();
      ro.disconnect();
      hostEl.removeEventListener('paste', onPaste);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      decoderRef.current = null;
    };
  }, [emulator]);

  return <div className="bl-term" ref={hostRef} />;
}

/**
 * Helper for App: push a single serial byte into the terminal DOM node.
 * Using a DOM-level hook avoids re-rendering xterm on every byte.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function writeByteTo(el: HTMLElement | null, byte: number): void {
  if (!el) return;
  const fn = (el as HTMLElement & { __writeByte?: (b: number) => void }).__writeByte;
  fn?.(byte);
}
