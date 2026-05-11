import { useState } from 'react';
import type { RelaySource } from '@/network/relay';
import './settings.css';

export interface SettingsValue {
  memoryMiB: number;
  relaySource: RelaySource;
  relayUserUrl: string;
  autoSaveOnExit: boolean;
}

interface Props {
  open: boolean;
  value: SettingsValue;
  onClose: () => void;
  onChange: (next: SettingsValue) => void;
}

export function Settings({ open, value, onClose, onChange }: Props) {
  const [local, setLocal] = useState<SettingsValue>(value);
  if (!open) return null;

  const save = () => {
    onChange(local);
    onClose();
  };

  return (
    <div className="bl-modal" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="bl-modal__backdrop" onClick={onClose} />
      <div className="bl-modal__panel">
        <header>
          <h2>Settings</h2>
          <button className="bl-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <label className="bl-field">
          <span>Memory (MiB)</span>
          <input
            type="number"
            min={128}
            max={512}
            step={64}
            value={local.memoryMiB}
            onChange={(e) =>
              setLocal({ ...local, memoryMiB: clampInt(e.target.value, 128, 512) })
            }
          />
          <small>Takes effect on next start. 128 is fine for a shell; 256–512 for building code.</small>
        </label>

        <fieldset className="bl-field">
          <legend>Network relay</legend>
          {(['none', 'self', 'public', 'user'] as const).map((src) => (
            <label key={src} className="bl-radio">
              <input
                type="radio"
                name="relay"
                checked={local.relaySource === src}
                onChange={() => setLocal({ ...local, relaySource: src })}
              />
              <RelayLabel src={src} />
            </label>
          ))}
          {local.relaySource === 'user' && (
            <input
              type="text"
              placeholder="wss://your-proxy.example.com/"
              value={local.relayUserUrl}
              onChange={(e) => setLocal({ ...local, relayUserUrl: e.target.value })}
            />
          )}
          <small>
            `self` expects a WebSocket proxy running at <code>/net/</code> on the same origin.
            See server/proxy in the README. `public` uses the community relay (slow, unreliable).
          </small>
        </fieldset>

        <label className="bl-field bl-field--checkbox">
          <input
            type="checkbox"
            checked={local.autoSaveOnExit}
            onChange={(e) => setLocal({ ...local, autoSaveOnExit: e.target.checked })}
          />
          <span>Auto-save state when closing the tab</span>
        </label>

        <footer>
          <button className="bl-btn" onClick={onClose}>Cancel</button>
          <button className="bl-btn bl-btn--primary" onClick={save}>Apply</button>
        </footer>
      </div>
    </div>
  );
}

function RelayLabel({ src }: { src: RelaySource }) {
  switch (src) {
    case 'none':
      return <span>No network (offline VM)</span>;
    case 'self':
      return <span>Self-hosted proxy (wss://…/net/)</span>;
    case 'public':
      return <span>Public v86 relay (slow, shared)</span>;
    case 'user':
      return <span>Custom WebSocket URL</span>;
  }
}

function clampInt(raw: string, lo: number, hi: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
