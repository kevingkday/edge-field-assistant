import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cloud, CloudOff, Lock, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import {
  FieldAssistantRouter,
  createChecklistFromSchema,
  detectDeviceCapability,
  downloadModelToOpfs,
  mergeStepIntoChecklistState,
  removeModelFromOpfs,
  type CapturedMediaEntry,
  type ChecklistItemState,
  type CustomModelEntry,
  type DeviceCapability,
  type FieldAppSchema,
  type ModelDownloadProgress,
  type StepEvaluationResult,
  type TelemetrySnapshot,
} from '@edge-field-assistant/core';
import { DesktopStudio } from './components/DesktopStudio';
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
import {
  BUILTIN_MODEL_ENTRY,
  DEFAULT_BUILTIN_MODEL_ID,
  loadActiveModelId,
  loadAndSyncModels,
  persistCustomModel,
  removeCustomModel,
  saveActiveModelId,
  toModelConfig,
} from './utils/modelSync';

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

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export default function App() {
  const isDesktop = useIsDesktop();
  const [desktopView, setDesktopView] = useState<'studio' | 'field'>('studio');

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

  const [customModels, setCustomModels] = useState<CustomModelEntry[]>([]);
  const [activeModelId, setActiveModelId] = useState<string>(() => loadActiveModelId());

  const availableModels = useMemo(
    () => [BUILTIN_MODEL_ENTRY, ...customModels],
    [customModels]
  );

  const activeModelConfig = useMemo(() => {
    const selected = availableModels.find((m) => m.id === activeModelId) || BUILTIN_MODEL_ENTRY;
    return toModelConfig(selected);
  }, [availableModels, activeModelId]);

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
      modelConfig: activeModelConfig,
      createWorker: () =>
        new Worker(
          new URL('@edge-field-assistant/core/worker', import.meta.url),
          { type: 'module' }
        ),
    });
  }

  // Load built-in schemas + D1 custom schemas + D1 custom models
  useEffect(() => {
    loadAndSyncSchemas().then(({ schemas: loaded, syncStatus: status }) => {
      setSyncStatus(status);
      if (loaded.length > 0) {
        setSchemas(loaded);
        setActiveSchemaId(loaded[0].id);
        setChecklist(createChecklistFromSchema(loaded[0]));
      }
    });

    loadAndSyncModels().then(({ models }) => {
      setCustomModels(models);
    });
  }, []);

  // Re-probe capability when active model or forceLocalWebGpu changes
  useEffect(() => {
    routerRef.current?.setModelConfig(activeModelConfig);
    detectDeviceCapability(activeModelConfig, { forceLocalWebGpu }).then(setCapability);
  }, [activeModelConfig, forceLocalWebGpu]);

  // Listen to online/offline events
  useEffect(() => {
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

  const handleSelectModel = (modelId: string) => {
    setActiveModelId(modelId);
    saveActiveModelId(modelId);
  };

  const handleSaveModelEntry = async (model: CustomModelEntry) => {
    const { models: nextModels, syncStatus: nextStatus } = await persistCustomModel(
      model,
      customModels,
      adminToken
    );
    setCustomModels(nextModels);
    setSyncStatus(nextStatus);
    handleSelectModel(model.id);
  };

  const handleDeleteModelEntry = async (modelId: string) => {
    const { models: nextModels, syncStatus: nextStatus } = await removeCustomModel(
      modelId,
      customModels,
      adminToken
    );
    setCustomModels(nextModels);
    setSyncStatus(nextStatus);
    if (activeModelId === modelId) {
      handleSelectModel(DEFAULT_BUILTIN_MODEL_ID);
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
      await downloadModelToOpfs((prog) => setDownloadProgress(prog), undefined, activeModelConfig);
      const cap = await detectDeviceCapability(activeModelConfig, { forceLocalWebGpu });
      setCapability(cap);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Model download failed');
    } finally {
      setDownloadingModel(false);
    }
  };

  const handleDeleteOpfsModel = async () => {
    await removeModelFromOpfs(activeModelConfig.filename);
    routerRef.current?.dispose();
    routerRef.current = new FieldAssistantRouter({
      wasmBaseUrl: '/wasm/',
      modelConfig: activeModelConfig,
      remoteEndpointUrl: remoteEndpointUrl || undefined,
      forceLocalWebGpu,
      createWorker: () =>
        new Worker(
          new URL('@edge-field-assistant/core/worker', import.meta.url),
          { type: 'module' }
        ),
    });
    const cap = await detectDeviceCapability(activeModelConfig, { forceLocalWebGpu });
    setCapability(cap);
  };

  const handleToggleForceLocalWebGpu = async (force: boolean) => {
    setForceLocalWebGpu(force);
    routerRef.current?.setForceLocalWebGpu(force);
    const cap = await detectDeviceCapability(activeModelConfig, { forceLocalWebGpu: force });
    setCapability(cap);
  };

  const handleEvaluateStep = async (
    frameBlob: Blob | null,
    transcript: string,
    overrideSchema?: FieldAppSchema,
    overrideChecklist?: ChecklistItemState[]
  ): Promise<StepEvaluationResult> => {
    if (!routerRef.current) {
      throw new Error('Inference router is not initialized.');
    }
    routerRef.current.setRemoteEndpoint(remoteEndpointUrl.trim() || undefined);
    setAnalyzingStep(true);
    try {
      const result = await routerRef.current.evaluateStep({
        schema: overrideSchema || activeSchema,
        checklist: overrideChecklist || checklist,
        transcript,
        imageBlob: frameBlob,
      });

      setLastResult(result);
      setStepCount((c) => c + 1);

      if (!overrideSchema) {
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
      }

      return result;
    } catch (err) {
      if (!overrideSchema) {
        alert(err instanceof Error ? err.message : 'Step evaluation failed');
      }
      throw err;
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

  const showDesktopStudio = isDesktop && desktopView === 'studio';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-badge">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="brand-title">Edge Field Assistant</div>
            <div className="brand-sub">
              {showDesktopStudio
                ? 'Desktop Studio · Schema Authoring & D1 Model Registry'
                : '100% Local WebGPU + OPFS Field Execution'}
            </div>
          </div>
        </div>

        <div className="topbar-controls">
          {!showDesktopStudio && (
            <select
              className="select"
              style={{ width: 'auto', minWidth: 200 }}
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
          )}

          {isDesktop && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={desktopView === 'studio' ? 'btn btn-primary' : 'btn'}
                onClick={() => setDesktopView('studio')}
              >
                <Monitor size={14} /> Studio
              </button>
              <button
                type="button"
                className={desktopView === 'field' ? 'btn btn-primary' : 'btn'}
                onClick={() => setDesktopView('field')}
              >
                <Smartphone size={14} /> Field Mode
              </button>
            </div>
          )}

          {syncStatus === 'synced' && (
            <span className="pill pill-green desktop-only" title="Synced with Cloudflare D1">
              <Cloud size={13} /> Synced
            </span>
          )}
          {syncStatus === 'offline_local' && (
            <span className="pill pill-amber desktop-only" title="Offline or local-only storage">
              <CloudOff size={13} /> Offline Local
            </span>
          )}
          {syncStatus === 'auth_required' && (
            <span className="pill pill-red" title="Set Admin Sync Token in Telemetry">
              <Lock size={13} /> Auth Required
            </span>
          )}

          <button type="button" className="btn" onClick={() => setTelemetryOpen(true)}>
            <Activity size={15} /> {isDesktop ? 'Telemetry' : 'Settings'}
          </button>
        </div>
      </header>

      <main className="main-container" style={showDesktopStudio ? { maxWidth: 1320 } : undefined}>
        {showDesktopStudio ? (
          <DesktopStudio
            schemas={schemas}
            activeSchema={activeSchema}
            syncStatus={syncStatus}
            onSelectSchema={handleSchemaSelect}
            onSaveSchema={handleSaveCustomSchema}
            onDeleteSchema={handleDeleteCustomSchema}
            onEvaluateWebGpu={(blob, txt, ovSchema, ovChecklist) =>
              handleEvaluateStep(blob, txt, ovSchema, ovChecklist)
            }
            customModels={customModels}
            activeModelId={activeModelId}
            onSelectModel={handleSelectModel}
            onSaveModel={handleSaveModelEntry}
            onDeleteModelEntry={handleDeleteModelEntry}
            capability={capability}
            downloadingModel={downloadingModel}
            downloadProgress={downloadProgress}
            onDownloadModel={handleDownloadModel}
            onClearOpfsModel={handleDeleteOpfsModel}
          />
        ) : (
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
            availableModels={availableModels}
            activeModelId={activeModelId}
            onSelectModel={handleSelectModel}
            onDownloadModel={handleDownloadModel}
            onDeleteModel={handleDeleteOpfsModel}
            onEvaluateStep={(blob, txt) => handleEvaluateStep(blob, txt).then(() => undefined)}
            onResetSession={() => handleSchemaSelect(activeSchema.id)}
            onExportSession={handleExportSession}
          />
        )}
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
        onDeleteModel={handleDeleteOpfsModel}
        onOpenSchemaBuilder={() => setSchemaModalOpen(true)}
        availableModels={availableModels}
        activeModelId={activeModelId}
        onSelectModel={handleSelectModel}
        onSaveCustomModel={handleSaveModelEntry}
        onDeleteCustomModel={handleDeleteModelEntry}
        jsonState={{ schemaId: activeSchema.id, extractedData, flags, checklist }}
        onClose={() => setTelemetryOpen(false)}
      />
    </div>
  );
}
