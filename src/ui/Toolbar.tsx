import { useRef } from 'react';
import './toolbar.css';

export interface ToolbarProps {
  running: boolean;
  hasSavedState: boolean;
  onStart: () => void;
  onStop: () => void;
  onSaveState: () => void;
  onClearState: () => void;
  onUpload: (file: File) => void;
  onOpenSettings: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bl-toolbar" role="toolbar" aria-label="VM controls">
      <div className="bl-toolbar__brand">browser linux</div>
      <div className="bl-toolbar__sep" />
      {!props.running ? (
        <button onClick={props.onStart} className="bl-btn bl-btn--primary">
          ▶ Start
        </button>
      ) : (
        <button onClick={props.onStop} className="bl-btn">
          ■ Stop
        </button>
      )}
      <button onClick={props.onSaveState} disabled={!props.running} className="bl-btn">
        💾 Save state
      </button>
      <button onClick={props.onClearState} disabled={!props.hasSavedState} className="bl-btn">
        🗑 Clear state
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={!props.running}
        className="bl-btn"
        title="Upload a file to /tmp inside the VM"
      >
        ⬆ Upload
      </button>
      <input
        ref={fileRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) props.onUpload(f);
          e.target.value = '';
        }}
      />
      <div className="bl-toolbar__spacer" />
      <button onClick={props.onOpenSettings} className="bl-btn" aria-label="Settings">
        ⚙ Settings
      </button>
    </div>
  );
}
