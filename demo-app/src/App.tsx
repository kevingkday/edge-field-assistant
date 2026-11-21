import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cloud, CloudOff, Lock, Plus, ShieldCheck } from 'lucide-react';
import {
  FieldAssistantRouter,
  createChecklistFromSchema,
  detectDeviceCapability,
  downloadModelToOpfs,
  mergeStepIntoChecklistState,
  removeModelFromOpfs,
  type CapturedMediaEntry,
  type ChecklistItemState,
  type DeviceCapability,
  type FieldAppSchema,
  type ModelDownloadProgress,
  type StepEvaluationResult,
  type TelemetrySnapshot,
} from '@edge-field-assistant/core';
import { FieldCaptureUI } from './components/FieldCaptureUI';
import { SchemaBuilder } from './components/SchemaBuilder';
import { TelemetryDrawer } from './components/TelemetryDrawer';
import {
  loadAdminToken,
  loadAndSyncSchemas,
  persistSchema,
  removeCustomSchema,
  saveAdminToken,
  type SchemaSyncStatus,
} from './utils/schemaSync';

const FALLBACK_DEFAULT_SCHEMA: FieldAppSchema = {
  id: 'twincover-cope',
  version: '1.0.0',
  name: 'TwinCover Commercial COPE',
  description: 'Commercial property underwriting walk-through.',
  domain: 'insurance',
  persona: 'commercial insurance field underwriting copilot',
  flagLabel: 'Underwriting Red Flags',
  items: [
    {
      id: 'electrical_panel',
      label: 'Main Electrical Panel & Amperage',
      category: 'Protection / Systems',
      promptHint: 'Open panel door; capture main breaker amperage and manufacturer.',
      extractKeys: ['electrical_service'],
      required: true,
    },
  ],
};

export default function App() {
  const [schemas, setSchemas] = useState<FieldAppSchema[]>([FALLBACK_DEFAULT_SCHEMA]);
  const [activeSchemaId, setActiveSchemaId] = useState<string>('twincover-cope');

  const activeSchema = useMemo(
    () => schemas.find((s) => s.id === activeSchemaId) || schemas[0] || FALLBACK_DEFAULT_SCHEMA,
    [schemas, activeSchemaId]
  );

  const [checklist, setChecklist] = useState<ChecklistItemState[]>(() =>
    createChecklistFromSchema(FALLBACK_DEFAULT_SCHEMA)
  );
  const [extractedData, setExtractedData] = useState<Record<string, unknown>>({});
  const [flags, setFlags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<CapturedMediaEntry[]>([]);

  const [capability, setCapability] = useState<DeviceCapability>({
    state: 'unsupported',
    reason: 'Probing WebGPU & OPFS...',
    cachedSizeBytes: 0,
    hasWebGpu: false,
    hasOpfs: false,
    deviceMemoryGb: null,
  });
  const [downloadProgress, setDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [analyzingStep, setAnalyzingStep] = useState(false);
  const [lastResult, setLastResult] = useState<StepEvaluationResult | null>(null);
  const [handsFreeVoice, setHandsFreeVoice] = useState(true);

  const [remoteEndpointUrl, setRemoteEndpointUrl] = useState('');
  const [adminToken, setAdminToken] = useState(() => loadAdminToken());
  const [syncStatus, setSyncStatus] = useState<SchemaSyncStatus>('idle');
  const [forceLocalWebGpu, setForceLocalWebGpu] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);

  const routerRef = useRef<FieldAssistantRouter | null>(null);

  if (!routerRef.current) {
    routerRef.current = new FieldAssistantRouter({
      wasmBaseUrl: '/wasm/',
      createWorker: () =>
        new Worker(
          new URL('@edge-field-assistant/core/worker', import.meta.url),
          { type: 'module' }
        ),
    });
  }

  // Load built-in schemas + localStorage cache + Cloudflare D1/KV /api/schemas
  useEffect(() => {
    loadAndSyncSchemas().then(({ schemas: loaded, syncStatus: status }) => {
      setSyncStatus(status);
      if (loaded.length > 0) {
        setSchemas(loaded);
        setActiveSchemaId(loaded[0].id);
        setChecklist(createChecklistFromSchema(loaded[0]));
      }
    });
  }, []);

  // Probe hardware capability & listen to online/offline events
  useEffect(() => {
    detectDeviceCapability().then(setCapability);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      routerRef.current?.dispose();
    };
  }, []);

  const handleSchemaSelect = (schemaId: string) => {
    const next = schemas.find((s) => s.id === schemaId);
    if (!next) return;
    setActiveSchemaId(next.id);
    setChecklist(createChecklistFromSchema(next));
    setExtractedData({});
    setFlags([]);
    setPhotos([]);
    setLastResult(null);
  };

  const handleSaveCustomSchema = async (newSchema: FieldAppSchema) => {
    const { schemas: nextSchemas, syncStatus: nextStatus } = await persistSchema(
      newSchema,
      schemas,
      adminToken
    );
    setSchemas(nextSchemas);
    setSyncStatus(nextStatus);
    setActiveSchemaId(newSchema.id);
    setChecklist(createChecklistFromSchema(newSchema));
    setExtractedData({});
    setFlags([]);
    setPhotos([]);
    setLastResult(null);
  };

  const handleDeleteCustomSchema = async (schemaId: string) => {
    const { schemas: nextSchemas, syncStatus: nextStatus } = await removeCustomSchema(
      schemaId,
      schemas,
      adminToken
    );
    setSchemas(nextSchemas);
    setSyncStatus(nextStatus);
    if (activeSchemaId === schemaId && nextSchemas.length > 0) {
      setActiveSchemaId(nextSchemas[0].id);
      setChecklist(createChecklistFromSchema(nextSchemas[0]));
      setExtractedData({});
      setFlags([]);
      setPhotos([]);
      setLastResult(null);
    }
  };

  const speakFeedback = (text: string, force = false) => {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (!handsFreeVoice && !force) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.03;
      window.speechSynthesis.speak(utter);
    } catch {
      // ignore TTS restriction
    }
  };

  const handleDownloadModel = async () => {
    setDownloadingModel(true);
    setDownloadProgress({ percent: 0, receivedBytes: 0, totalBytes: 0 });
    try {
      await downloadModelToOpfs((prog) => setDownloadProgress(prog));
      const cap = await detectDeviceCapability({}, { forceLocalWebGpu });
      setCapability(cap);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Model download failed');
    } finally {
      setDownloadingModel(false);
    }
  };

  const handleDeleteModel = async () => {
    await removeModelFromOpfs();
    routerRef.current?.dispose();
    routerRef.current = new FieldAssistantRouter({
      wasmBaseUrl: '/wasm/',
      remoteEndpointUrl: remoteEndpointUrl || undefined,
      forceLocalWebGpu,
      createWorker: () =>
        new Worker(
          new URL('@edge-field-assistant/core/worker', import.meta.url),
          { type: 'module' }
        ),
    });
    const cap = await detectDeviceCapability({}, { forceLocalWebGpu });
    setCapability(cap);
  };

  const handleToggleForceLocalWebGpu = async (force: boolean) => {
    setForceLocalWebGpu(force);
    routerRef.current?.setForceLocalWebGpu(force);
    const cap = await detectDeviceCapability({}, { forceLocalWebGpu: force });
    setCapability(cap);
  };

  const handleEvaluateStep = async (frameBlob: Blob | null, transcript: string) => {
    if (!routerRef.current) return;
    routerRef.current.setRemoteEndpoint(remoteEndpointUrl.trim() || undefined);
    setAnalyzingStep(true);
    try {
      const result = await routerRef.current.evaluateStep({
        schema: activeSchema,
        checklist,
        transcript,
        imageBlob: frameBlob,
      });

      setLastResult(result);
      setStepCount((c) => c + 1);
      speakFeedback(result.spoken_feedback, result.already_completed);

      const merged = mergeStepIntoChecklistState(checklist, extractedData, flags, result);
      setChecklist(merged.checklist);
      setExtractedData(merged.extractedData);
      setFlags(merged.flags);

      if (frameBlob) {
        setPhotos((prev) => [
          ...prev,
          {
            id: `photo_${Date.now()}`,
            itemId: result.checklist_item_id || 'general',
            detectedItem: result.detected_item,
            filename: `${result.checklist_item_id || 'field'}_${Date.now()}.jpg`,
            blob: frameBlob,
            capturedAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Step evaluation failed');
    } finally {
      setAnalyzingStep(false);
    }
  };

  const handleExportSession = () => {
    const payload = {
      schemaId: activeSchema.id,
      schemaName: activeSchema.name,
      exportedAt: new Date().toISOString(),
      extractedData,
      flags,
      checklist: checklist.map(({ id, label, completed, capturedAt, extractedData: itemData }) => ({
        id,
        label,
        completed,
        capturedAt,
        extractedData: itemData,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSchema.id}-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const telemetry: TelemetrySnapshot = {
    lastLatencyMs: lastResult?.latencyMs ?? null,
    activeBackend: lastResult?.backend ?? 'none',
    engineLabel: lastResult?.engine ?? 'Idle',
    opfsCachedBytes: capability.cachedSizeBytes,
    capabilityState: capability.state,
    stepCount,
    isOnline,
    lastUpdatedAt: lastResult ? new Date().toISOString() : null,
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-badge">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="brand-title">Edge Field Assistant</div>
            <div className="brand-sub">100% Local WebGPU + OPFS Multimodal SDK</div>
          </div>
        </div>

        <div className="topbar-controls">
          <select
            className="select"
            style={{ width: 'auto', minWidth: 220 }}
            value={activeSchema.id}
            onChange={(e) => handleSchemaSelect(e.target.value)}
            aria-label="Select field workflow schema"
          >
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.items.length} steps)
              </option>
            ))}
          </select>

          <button type="button" className="btn" onClick={() => setSchemaModalOpen(true)}>
            <Plus size={15} /> New Custom Schema
          </button>

          {syncStatus === 'synced' && (
            <span className="pill pill-green" title="Schemas synced with Cloudflare D1/KV">
              <Cloud size={13} /> Synced to Cloudflare
            </span>
          )}
          {syncStatus === 'offline_local' && (
            <span className="pill pill-amber" title="Offline or local-only storage">
              <CloudOff size={13} /> Saved Locally (Offline)
            </span>
          )}
          {syncStatus === 'auth_required' && (
            <span className="pill pill-red" title="Set Admin Sync Token in Telemetry">
              <Lock size={13} /> Auth Token Required
            </span>
          )}

          <button type="button" className="btn" onClick={() => setTelemetryOpen(true)}>
            <Activity size={15} /> Telemetry
          </button>
        </div>
      </header>

      <main className="main-container">
        <FieldCaptureUI
          schema={activeSchema}
          checklist={checklist}
          extractedData={extractedData}
          flags={flags}
          photos={photos}
          capability={capability}
          downloadProgress={downloadProgress}
          downloadingModel={downloadingModel}
          analyzingStep={analyzingStep}
          lastResult={lastResult}
          handsFreeVoice={handsFreeVoice}
          onToggleHandsFreeVoice={() => setHandsFreeVoice((v) => !v)}
          onDownloadModel={handleDownloadModel}
          onDeleteModel={handleDeleteModel}
          onEvaluateStep={handleEvaluateStep}
          onResetSession={() => handleSchemaSelect(activeSchema.id)}
          onExportSession={handleExportSession}
        />
      </main>

      <SchemaBuilder
        isOpen={schemaModalOpen}
        activeSchema={activeSchema}
        allSchemas={schemas}
        syncStatus={syncStatus}
        onClose={() => setSchemaModalOpen(false)}
        onSaveSchema={handleSaveCustomSchema}
        onDeleteSchema={handleDeleteCustomSchema}
      />

      <TelemetryDrawer
        isOpen={telemetryOpen}
        telemetry={telemetry}
        remoteEndpointUrl={remoteEndpointUrl}
        onRemoteEndpointChange={(url) => {
          setRemoteEndpointUrl(url);
          routerRef.current?.setRemoteEndpoint(url.trim() || undefined);
        }}
        adminToken={adminToken}
        onAdminTokenChange={(token) => {
          setAdminToken(token);
          saveAdminToken(token);
        }}
        forceLocalWebGpu={forceLocalWebGpu}
        onToggleForceLocalWebGpu={handleToggleForceLocalWebGpu}
        onDeleteModel={handleDeleteModel}
        jsonState={{ schemaId: activeSchema.id, extractedData, flags, checklist }}
        onClose={() => setTelemetryOpen(false)}
      />
    </div>
  );
}
