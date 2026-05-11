import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Emulator, type EmulatorStatus } from '@/emulator/emulator';
import { detectCapabilities } from '@/emulator/capabilities';
import { StateStore } from '@/filesystem/state-store';
import { downloadBlob, uploadFileToGuest } from '@/filesystem/transfer';
import { resolveRelay, type RelaySource } from '@/network/relay';
import { BootScreen } from '@/ui/BootScreen';
import { Toolbar } from '@/ui/Toolbar';
import { Settings, type SettingsValue } from '@/ui/Settings';
import { Terminal, writeByteTo } from '@/terminal/Terminal';
import { loadImageManifest } from '@/boot/load-manifest';
import type { ImageManifest } from '@/boot/image-manifest';
import './app.css';

const SETTINGS_KEY = 'browser-linux.settings.v1';

const defaultSettings: SettingsValue = {
  memoryMiB: 128,
  relaySource: 'self' as RelaySource,
  relayUserUrl: '',
  autoSaveOnExit: true,
};

function loadSettings(): SettingsValue {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const p = JSON.parse(raw) as Partial<SettingsValue>;
    return { ...defaultSettings, ...p };
  } catch {
    return defaultSettings;
  }
}
function saveSettings(v: SettingsValue): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(v));
  } catch {
    /* ignore quota / SecurityError */
  }
}

export function App() {
  const caps = useMemo(() => detectCapabilities(), []);
  const [manifest, setManifest] = useState<ImageManifest | null>(null);
  const [settings, setSettings] = useState<SettingsValue>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<EmulatorStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ ratio: null as number | null, loaded: 0, total: 0 });
  const [hasSavedState, setHasSavedState] = useState(false);

  const emulatorRef = useRef<Emulator | null>(null);
  const termHostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const storeRef = useRef<StateStore | null>(null);

  // Load manifest + check saved state once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await loadImageManifest();
      if (cancelled) return;
      setManifest(m);
      const store = new StateStore(m.id);
      storeRef.current = store;
      const info = await store.getStateInfo();
      setHasSavedState(!!info);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-save on tab close.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!settings.autoSaveOnExit) return;
      const e = emulatorRef.current;
      const s = storeRef.current;
      if (!e || !s || e.getStatus() !== 'running') return;
      // We can't await here, but we can kick off the save. v86.save_state()
      // is synchronous in terms of snapshotting and returns a Promise that
      // resolves with a buffer; serialize and throw it at IDB fire-and-forget.
      void (async () => {
        try {
          const buf = await e.saveState();
          await s.saveState(buf);
        } catch (err) {
          console.warn('auto-save failed:', err);
        }
      })();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [settings.autoSaveOnExit]);

  const startVM = useCallback(async () => {
    if (!manifest) return;
    if (!caps.wasm) {
      setError('WebAssembly is unavailable in this browser.');
      return;
    }
    setError(null);

    const relay = resolveRelay(settings.relaySource, settings.relayUserUrl);
    const store = storeRef.current!;
    const savedState = await store.loadState().catch(() => null);

    const emulator = new Emulator({
      hdaUrl: manifest.hdaUrl,
      hdaSize: manifest.hdaSize,
      memoryMiB: settings.memoryMiB,
      ...(manifest.initialStateUrl ? { initialStateUrl: manifest.initialStateUrl } : {}),
      ...(relay.url ? { networkRelayUrl: relay.url } : {}),
      screenContainer: screenRef.current!,
      onStatus: (s, detail) => {
        setStatus(s);
        if (s === 'error' && detail) setError(detail);
      },
      onDownloadProgress: (ratio, loaded, total) => setProgress({ ratio, loaded, total }),
      onSerialOutput: (byte) => writeByteTo(termHostRef.current, byte),
    });
    emulatorRef.current = emulator;

    try {
      await emulator.start();
      // If the user had a snapshot, restore it as soon as v86 is up.
      if (savedState) {
        // Wait until v86 hits 'running' so its internal buffers exist.
        const untilRunning = () =>
          new Promise<void>((resolve) => {
            const id = setInterval(() => {
              if (emulator.getStatus() === 'running') {
                clearInterval(id);
                resolve();
              }
            }, 50);
          });
        await untilRunning();
        try {
          await emulator.restoreState(savedState);
        } catch (err) {
          console.warn('restore_state failed, continuing with fresh boot:', err);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [manifest, caps.wasm, settings]);

  const stopVM = useCallback(async () => {
    const e = emulatorRef.current;
    if (!e) return;
    await e.stop();
    emulatorRef.current = null;
  }, []);

  const saveState = useCallback(async () => {
    const e = emulatorRef.current;
    const s = storeRef.current;
    if (!e || !s) return;
    try {
      const buf = await e.saveState();
      await s.saveState(buf);
      setHasSavedState(true);
      // Also offer a manual download for portability.
      downloadBlob(new Blob([buf]), `${manifest?.id ?? 'vm'}.state.bin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [manifest]);

  const clearState = useCallback(async () => {
    const s = storeRef.current;
    if (!s) return;
    await s.clearState();
    setHasSavedState(false);
  }, []);

  const onUpload = useCallback(async (file: File) => {
    const e = emulatorRef.current;
    if (!e) return;
    try {
      await uploadFileToGuest(e, file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const running = status === 'running' || status === 'booting';

  return (
    <div className="bl-app">
      <Toolbar
        running={running}
        hasSavedState={hasSavedState}
        onStart={startVM}
        onStop={stopVM}
        onSaveState={saveState}
        onClearState={clearState}
        onUpload={onUpload}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="bl-stage">
        {/* v86 needs a container for its (hidden) VGA canvas even when we use serial TTY only */}
        <div ref={screenRef} className="bl-screen-host" aria-hidden>
          <div />
          <canvas />
        </div>
        <div className="bl-terminal-host" ref={termHostRef}>
          <Terminal emulator={emulatorRef.current} />
        </div>
        {(status === 'idle' ||
          status === 'loading-emulator' ||
          status === 'downloading-image' ||
          status === 'booting' ||
          status === 'error') && (
          <div className="bl-overlay">
            <BootScreen
              status={status}
              progressRatio={progress.ratio}
              bytesLoaded={progress.loaded}
              bytesTotal={progress.total}
              error={error}
              warnings={caps.warnings}
            />
          </div>
        )}
        {status === 'stopped' && (
          <div className="bl-overlay">
            <BootScreen
              status="stopped"
              progressRatio={null}
              bytesLoaded={0}
              bytesTotal={0}
              error={null}
              warnings={[]}
            />
          </div>
        )}
      </div>
      <Settings
        open={settingsOpen}
        value={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={(v) => {
          setSettings(v);
          saveSettings(v);
        }}
      />
    </div>
  );
}
