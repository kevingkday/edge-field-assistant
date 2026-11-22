import React, { useEffect, useState } from 'react';
import { Activity, Copy, Check, Database, HardDrive, Layers, Plus, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { formatBytes, type CustomModelEntry, type TelemetrySnapshot } from '@edge-field-assistant/core';
import { DEFAULT_BUILTIN_MODEL_ID } from '../utils/modelSync';

interface TelemetryDrawerProps {
  isOpen: boolean;
  telemetry: TelemetrySnapshot;
  remoteEndpointUrl: string;
  onRemoteEndpointChange: (url: string) => void;
  adminToken: string;
  onAdminTokenChange: (token: string) => void;
  forceLocalWebGpu: boolean;
  onToggleForceLocalWebGpu: (force: boolean) => void;
  onDeleteModel: () => Promise<void> | void;
  onOpenSchemaBuilder: () => void;
  availableModels: CustomModelEntry[];
  activeModelId: string;
  onSelectModel: (modelId: string) => void;
  onSaveCustomModel: (model: CustomModelEntry) => Promise<void>;
  onDeleteCustomModel: (modelId: string) => Promise<void>;
  jsonState: unknown;
  onClose: () => void;
}

export const TelemetryDrawer: React.FC<TelemetryDrawerProps> = ({
  isOpen,
  telemetry,
  remoteEndpointUrl,
  onRemoteEndpointChange,
  adminToken,
  onAdminTokenChange,
  forceLocalWebGpu,
  onToggleForceLocalWebGpu,
  onDeleteModel,
  onOpenSchemaBuilder,
  availableModels,
  activeModelId,
  onSelectModel,
  onSaveCustomModel,
  onDeleteCustomModel,
  jsonState,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [newModelUrl, setNewModelUrl] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState<{
    usage: number;
    quota: number;
  } | null>(null);

  const refreshStorageEstimate = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        setStorageEstimate({
          usage: est.usage ?? 0,
          quota: est.quota ?? 0,
        });
      }
    } catch {
      // ignore storage estimate errors
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshStorageEstimate();
    }
  }, [isOpen, telemetry.opfsCachedBytes]);

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

  const handleDeleteModel = async () => {
    setDeleting(true);
    try {
      await onDeleteModel();
      await refreshStorageEstimate();
    } finally {
      setDeleting(false);
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

        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
              <HardDrive size={14} color="#38bdf8" />
              Origin Storage (OPFS Estimate)
            </div>
            <button
              type="button"
              className="btn btn-danger"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={handleDeleteModel}
              disabled={deleting || telemetry.opfsCachedBytes === 0}
            >
              <Trash2 size={13} />
              {deleting ? 'Deleting...' : 'Delete Cached Model'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {storageEstimate
              ? `${formatBytes(storageEstimate.usage)} used of ${formatBytes(storageEstimate.quota)} quota`
              : 'Storage estimate unavailable in this browser.'}
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>Force Local WebGPU</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Bypass navigator.deviceMemory &lt; 4 GB cap
              </div>
            </div>
            <input
              type="checkbox"
              checked={forceLocalWebGpu}
              onChange={(e) => onToggleForceLocalWebGpu(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
            />
          </label>
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

        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Admin Sync Token (Optional Bearer for /api/schemas & /api/models)
          </label>
          <input
            type="password"
            className="input"
            placeholder="Enter SCHEMA_ADMIN_TOKEN if configured on Cloudflare"
            value={adminToken}
            onChange={(e) => onAdminTokenChange(e.target.value)}
          />
        </div>

        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
              <Layers size={14} color="#38bdf8" />
              Schema Authoring
            </div>
            <button
              type="button"
              className="btn"
              style={{ padding: '6px 10px', fontSize: 12 }}
              onClick={() => {
                onClose();
                onOpenSchemaBuilder();
              }}
            >
              <Plus size={13} /> New / Manage Schemas
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Create, import, or edit custom inspection checklists and sync them to Cloudflare D1.
          </div>
        </div>

        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
            <Database size={14} color="#38bdf8" />
            Custom Model Registry (.litertlm)
          </div>
          <select
            className="select"
            style={{ fontSize: 12, padding: '8px 10px' }}
            value={activeModelId}
            onChange={(e) => onSelectModel(e.target.value)}
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {activeModelId !== DEFAULT_BUILTIN_MODEL_ID && (
            <button
              type="button"
              className="btn btn-danger"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => onDeleteCustomModel(activeModelId)}
            >
              <Trash2 size={13} /> Delete Selected Custom Model
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
            <input
              className="input"
              style={{ fontSize: 12, padding: '7px 10px' }}
              placeholder="Model name (e.g. Gemma 4 E4B R2)"
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                style={{ fontSize: 12, padding: '7px 10px' }}
                placeholder="https://.../model.litertlm"
                value={newModelUrl}
                onChange={(e) => setNewModelUrl(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '7px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                disabled={savingModel || !newModelName.trim() || !newModelUrl.trim()}
                onClick={async () => {
                  setSavingModel(true);
                  try {
                    const id = newModelName
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '');
                    await onSaveCustomModel({
                      id: id || `model-${Date.now()}`,
                      name: newModelName.trim(),
                      url: newModelUrl.trim(),
                    });
                    setNewModelName('');
                    setNewModelUrl('');
                  } finally {
                    setSavingModel(false);
                  }
                }}
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
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
