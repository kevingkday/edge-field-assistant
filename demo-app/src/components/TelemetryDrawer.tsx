import React, { useState } from 'react';
import { Activity, Copy, Check, Wifi, WifiOff, X } from 'lucide-react';
import { formatBytes, type TelemetrySnapshot } from '@edge-field-assistant/core';

interface TelemetryDrawerProps {
  isOpen: boolean;
  telemetry: TelemetrySnapshot;
  remoteEndpointUrl: string;
  onRemoteEndpointChange: (url: string) => void;
  jsonState: unknown;
  onClose: () => void;
}

export const TelemetryDrawer: React.FC<TelemetryDrawerProps> = ({
  isOpen,
  telemetry,
  remoteEndpointUrl,
  onRemoteEndpointChange,
  jsonState,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const serializedState = JSON.stringify(jsonState, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serializedState);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={18} color="#38bdf8" />
            <h2 style={{ margin: 0, fontSize: 16 }}>Edge Telemetry & State</h2>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last Step Latency</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
              {telemetry.lastLatencyMs !== null ? `${telemetry.lastLatencyMs} ms` : '—'}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>OPFS Model Size</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
              {formatBytes(telemetry.opfsCachedBytes)}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Active Backend</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
              {telemetry.activeBackend}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Network</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              {telemetry.isOnline ? <Wifi size={14} color="#34d399" /> : <WifiOff size={14} color="#f87171" />}
              {telemetry.isOnline ? 'Online' : 'Offline'} · {telemetry.stepCount} turns
            </div>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Optional Remote Vision Fallback URL
          </label>
          <input
            className="input"
            placeholder="https://your-micronode.example.com/api/walkthrough/evaluate"
            value={remoteEndpointUrl}
            onChange={(e) => onRemoteEndpointChange(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
              Live Extracted JSON State
            </span>
            <button type="button" className="btn" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="code-block" style={{ margin: 0, flex: 1 }}>
            {serializedState}
          </pre>
        </div>
      </div>
    </div>
  );
};
