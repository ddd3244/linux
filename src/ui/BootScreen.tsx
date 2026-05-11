import type { EmulatorStatus } from '@/emulator/emulator';
import './boot-screen.css';

interface Props {
  status: EmulatorStatus;
  progressRatio: number | null;
  bytesLoaded: number;
  bytesTotal: number;
  error: string | null;
  warnings: string[];
}

const LABEL: Record<EmulatorStatus, string> = {
  idle: 'Idle',
  'loading-emulator': 'Loading emulator…',
  'downloading-image': 'Downloading disk image…',
  booting: 'Booting kernel…',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

export function BootScreen({ status, progressRatio, bytesLoaded, bytesTotal, error, warnings }: Props) {
  const pct = progressRatio == null ? null : Math.min(100, Math.round(progressRatio * 100));

  return (
    <div className="bl-boot">
      <div className="bl-boot__logo">
        <pre>
{`   ___                                        __    _                   
  / _ )_______ _    _____ ___ ____             / /   (_)__  __ ____ __   
 / _  / __/ _ \\ |/|/ (_-</ -_) __/   ___       / /__ / / _ \\/ // /\\ \\ /   
/____/_/  \\___/__,__/___/\\__/_/     /___/      /____//_/_//_/\\_,_//_\\_\\   
`}
        </pre>
      </div>
      <div className="bl-boot__status">{LABEL[status]}</div>

      {pct != null && (
        <div className="bl-boot__bar" aria-label="download progress">
          <div className="bl-boot__bar-fill" style={{ width: `${pct}%` }} />
          <div className="bl-boot__bar-text">
            {pct}% ({fmtBytes(bytesLoaded)} / {fmtBytes(bytesTotal)})
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="bl-boot__warnings">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {error && <div className="bl-boot__error">{error}</div>}

      <div className="bl-boot__hint">
        Tip: first boot is ~30 MB (Alpine Linux). Subsequent boots use a saved state and
        come up in &lt; 1 s.
      </div>
    </div>
  );
}
