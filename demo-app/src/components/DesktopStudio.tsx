import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  Check,
  Cpu,
  Database,
  Download,
  FileJson,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  createChecklistFromSchema,
  downscaleImageToMaxEdge,
  formatBytes,
  mergeStepIntoChecklistState,
  type ChecklistItemState,
  type CustomModelEntry,
  type DeviceCapability,
  type FieldAppSchema,
  type FieldExtractSpec,
  type FieldSchemaItem,
  type ModelDownloadProgress,
  type StepEvaluationResult,
} from '@edge-field-assistant/core';
import { BUILT_IN_SCHEMA_IDS, type SchemaSyncStatus } from '../utils/schemaSync';
import {
  BUILTIN_MODEL_ENTRY,
  DEFAULT_BUILTIN_MODEL_ID,
  evaluateWithOllama,
} from '../utils/modelSync';

interface DesktopStudioProps {
  schemas: FieldAppSchema[];
  activeSchema: FieldAppSchema;
  syncStatus: SchemaSyncStatus;
  onSelectSchema: (schemaId: string) => void;
  onSaveSchema: (schema: FieldAppSchema) => Promise<void>;
  onDeleteSchema: (schemaId: string) => Promise<void>;
  onEvaluateWebGpu: (
    frameBlob: Blob | null,
    transcript: string,
    overrideSchema?: FieldAppSchema,
    overrideChecklist?: ChecklistItemState[]
  ) => Promise<StepEvaluationResult>;
  customModels: CustomModelEntry[];
  activeModelId: string;
  onSelectModel: (modelId: string) => void;
  onSaveModel: (model: CustomModelEntry) => Promise<void>;
  onDeleteModelEntry: (modelId: string) => Promise<void>;
  capability: DeviceCapability;
  downloadingModel: boolean;
  downloadProgress: ModelDownloadProgress | null;
  onDownloadModel: () => void;
  onClearOpfsModel: () => void;
}

const createEmptyStep = (index: number): FieldSchemaItem => ({
  id: `step_${index + 1}`,
  label: '',
  category: 'General',
  promptHint: '',
  extractKeys: [],
  fieldSpecs: [],
  required: true,
});

export const DesktopStudio: React.FC<DesktopStudioProps> = ({
  schemas,
  activeSchema,
  syncStatus,
  onSelectSchema,
  onSaveSchema,
  onDeleteSchema,
  onEvaluateWebGpu,
  customModels,
  activeModelId,
  onSelectModel,
  onSaveModel,
  onDeleteModelEntry,
  capability,
  downloadingModel,
  downloadProgress,
  onDownloadModel,
  onClearOpfsModel,
}) => {
  const [studioTab, setStudioTab] = useState<'schema' | 'models'>('schema');
  const [draft, setDraft] = useState<FieldAppSchema>(() => structuredClone(activeSchema));
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [savingSchema, setSavingSchema] = useState(false);

  // Sandbox state
  const [sandboxChecklist, setSandboxChecklist] = useState<ChecklistItemState[]>(() =>
    createChecklistFromSchema(activeSchema)
  );
  const [sandboxExtracted, setSandboxExtracted] = useState<Record<string, unknown>>({});
  const [sandboxFlags, setSandboxFlags] = useState<string[]>([]);
  const [sandboxLastResult, setSandboxLastResult] = useState<StepEvaluationResult | null>(null);
  const [sandboxBlob, setSandboxBlob] = useState<Blob | null>(null);
  const [sandboxPreviewUrl, setSandboxPreviewUrl] = useState<string | null>(null);
  const [sandboxTranscript, setSandboxTranscript] = useState('');
  const [sandboxBackend, setSandboxBackend] = useState<'webgpu' | 'ollama'>('webgpu');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('gemma3:4b');
  const [evaluating, setEvaluating] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [copiedInspector, setCopiedInspector] = useState(false);

  // Model registry form state
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelUrl, setModelUrl] = useState('');
  const [modelSizeMb, setModelSizeMb] = useState('');
  const [modelDesc, setModelDesc] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [modelFormError, setModelFormError] = useState<string | null>(null);

  useEffect(() => {
    const cloned = structuredClone(activeSchema);
    setDraft(cloned);
    setRawJson(JSON.stringify(cloned, null, 2));
    setJsonError(null);
    setSandboxChecklist(createChecklistFromSchema(cloned));
    setSandboxExtracted({});
    setSandboxFlags([]);
    setSandboxLastResult(null);
  }, [activeSchema]);

  const allAvailableModels = useMemo(
    () => [BUILTIN_MODEL_ENTRY, ...customModels],
    [customModels]
  );

  const toggleRawMode = () => {
    if (!rawMode) {
      setRawJson(JSON.stringify(draft, null, 2));
      setJsonError(null);
      setRawMode(true);
    } else {
      try {
        const parsed = JSON.parse(rawJson) as FieldAppSchema;
        if (!parsed.id || !parsed.name || !Array.isArray(parsed.items)) {
          throw new Error('JSON must contain "id", "name", and "items" array.');
        }
        setDraft(parsed);
        setSandboxChecklist(createChecklistFromSchema(parsed));
        setJsonError(null);
        setRawMode(false);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
      }
    }
  };

  const handleNewBlankSchema = () => {
    const fresh: FieldAppSchema = {
      id: `custom-workflow-${Date.now().toString().slice(-4)}`,
      version: '1.0.0',
      name: 'New Field Workflow',
      description: 'Custom inspection & structured extraction workflow.',
      domain: 'custom',
      persona: 'field inspection and structured data extraction copilot',
      flagLabel: 'Red Flags',
      items: [createEmptyStep(0)],
    };
    setDraft(fresh);
    setRawJson(JSON.stringify(fresh, null, 2));
    setSandboxChecklist(createChecklistFromSchema(fresh));
    setSandboxExtracted({});
    setSandboxFlags([]);
    setSandboxLastResult(null);
    setJsonError(null);
  };

  const handleSaveDraft = async () => {
    let target = draft;
    if (rawMode) {
      try {
        target = JSON.parse(rawJson) as FieldAppSchema;
        setDraft(target);
        setJsonError(null);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
        return;
      }
    }

    if (!target.id.trim() || !target.name.trim()) {
      setJsonError('Schema "id" and "name" are required.');
      return;
    }
    const validItems = (target.items || []).filter((i) => i.label.trim());
    if (validItems.length === 0) {
      setJsonError('Add at least one checklist step with a label.');
      return;
    }

    const normalized: FieldAppSchema = {
      ...target,
      id: target.id.trim(),
      name: target.name.trim(),
      items: validItems.map((item, idx) => ({
        ...item,
        id:
          item.id.trim() ||
          item.label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_') ||
          `step_${idx + 1}`,
        extractKeys:
          item.fieldSpecs && item.fieldSpecs.length > 0
            ? item.fieldSpecs.map((f) => f.key.trim()).filter(Boolean)
            : item.extractKeys || [],
      })),
    };

    setSavingSchema(true);
    try {
      await onSaveSchema(normalized);
      setSandboxChecklist(createChecklistFromSchema(normalized));
    } finally {
      setSavingSchema(false);
    }
  };

  const updateStep = (idx: number, patch: Partial<FieldSchemaItem>) => {
    setDraft((prev) => {
      const nextItems = prev.items.map((item, i) => (i === idx ? { ...item, ...patch } : item));
      const next = { ...prev, items: nextItems };
      setSandboxChecklist((cur) => {
        const fresh = createChecklistFromSchema(next);
        return fresh.map((f) => {
          const existing = cur.find((c) => c.id === f.id);
          return existing ? { ...f, completed: existing.completed, extractedData: existing.extractedData } : f;
        });
      });
      return next;
    });
  };

  const addFieldSpec = (stepIdx: number) => {
    const step = draft.items[stepIdx];
    const nextSpecs: FieldExtractSpec[] = [
      ...(step.fieldSpecs || []),
      { key: `field_${(step.fieldSpecs?.length || 0) + 1}`, type: 'string' },
    ];
    updateStep(stepIdx, {
      fieldSpecs: nextSpecs,
      extractKeys: nextSpecs.map((f) => f.key),
    });
  };

  const updateFieldSpec = (stepIdx: number, specIdx: number, patch: Partial<FieldExtractSpec>) => {
    const step = draft.items[stepIdx];
    const nextSpecs = (step.fieldSpecs || []).map((spec, i) =>
      i === specIdx ? { ...spec, ...patch } : spec
    );
    updateStep(stepIdx, {
      fieldSpecs: nextSpecs,
      extractKeys: nextSpecs.map((f) => f.key.trim()).filter(Boolean),
    });
  };

  const removeFieldSpec = (stepIdx: number, specIdx: number) => {
    const step = draft.items[stepIdx];
    const nextSpecs = (step.fieldSpecs || []).filter((_, i) => i !== specIdx);
    updateStep(stepIdx, {
      fieldSpecs: nextSpecs,
      extractKeys: nextSpecs.map((f) => f.key.trim()).filter(Boolean),
    });
  };

  const handleSandboxFile = async (file: File) => {
    try {
      const downscaled = await downscaleImageToMaxEdge(file, 768);
      if (sandboxPreviewUrl) URL.revokeObjectURL(sandboxPreviewUrl);
      setSandboxBlob(downscaled);
      setSandboxPreviewUrl(URL.createObjectURL(downscaled));
      setSandboxError(null);
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : 'Failed to load test image');
    }
  };

  const handleEvaluateSandbox = async () => {
    setSandboxError(null);
    if (!sandboxBlob && !sandboxTranscript.trim()) {
      setSandboxError('Drop a test image or enter a field note first.');
      return;
    }

    setEvaluating(true);
    try {
      const result =
        sandboxBackend === 'ollama'
          ? await evaluateWithOllama({
              baseUrl: ollamaUrl,
              modelName: ollamaModel,
              schema: draft,
              checklist: sandboxChecklist,
              transcript: sandboxTranscript,
              imageBlob: sandboxBlob,
            })
          : await onEvaluateWebGpu(sandboxBlob, sandboxTranscript, draft, sandboxChecklist);

      setSandboxLastResult(result);
      const merged = mergeStepIntoChecklistState(
        sandboxChecklist,
        sandboxExtracted,
        sandboxFlags,
        result
      );
      setSandboxChecklist(merged.checklist);
      setSandboxExtracted(merged.extractedData);
      setSandboxFlags(merged.flags);
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : 'Sandbox evaluation failed');
    } finally {
      setEvaluating(false);
    }
  };

  const handleRegisterModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setModelFormError(null);
    if (!modelName.trim() || !modelUrl.trim()) {
      setModelFormError('Model name and .litertlm URL are required.');
      return;
    }
    if (!/^https?:\/\//i.test(modelUrl.trim())) {
      setModelFormError('URL must start with https:// or http://.');
      return;
    }

    const generatedId =
      modelId.trim() ||
      modelName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    setSavingModel(true);
    try {
      await onSaveModel({
        id: generatedId,
        name: modelName.trim(),
        url: modelUrl.trim(),
        size_mb: modelSizeMb.trim() ? Number(modelSizeMb) : null,
        description: modelDesc.trim() || null,
      });
      setModelId('');
      setModelName('');
      setModelUrl('');
      setModelSizeMb('');
      setModelDesc('');
    } catch (err) {
      setModelFormError(err instanceof Error ? err.message : 'Failed to save model');
    } finally {
      setSavingModel(false);
    }
  };

  const inspectorPayload = {
    schemaId: draft.id,
    lastEvaluation: sandboxLastResult,
    extractedData: sandboxExtracted,
    flags: sandboxFlags,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Studio Tab Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={studioTab === 'schema' ? 'btn btn-primary' : 'btn'}
            onClick={() => setStudioTab('schema')}
          >
            <Layers size={15} /> Schema Studio
          </button>
          <button
            type="button"
            className={studioTab === 'models' ? 'btn btn-primary' : 'btn'}
            onClick={() => setStudioTab('models')}
          >
            <Database size={15} /> Models ({allAvailableModels.length})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          <span>Sync:</span>
          <strong style={{ color: syncStatus === 'synced' ? '#34d399' : '#fbbf24' }}>
            {syncStatus === 'synced'
              ? 'Cloudflare D1'
              : syncStatus === 'auth_required'
                ? 'Token Required'
                : 'Local Cache'}
          </strong>
        </div>
      </div>

      {studioTab === 'models' ? (
        <div className="studio-grid">
          {/* Left: Registered Models & OPFS Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16 }}>OPFS Active Model & Custom Registry</h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Custom `.litertlm` models registered in D1 appear automatically in the mobile OPFS download selector.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {capability.state === 'ready_to_download' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={onDownloadModel}
                      disabled={downloadingModel}
                    >
                      <Download size={14} />
                      {downloadingModel && downloadProgress
                        ? `Downloading (${downloadProgress.percent}%)`
                        : 'Download Active to OPFS'}
                    </button>
                  )}
                  {capability.state === 'opfs_cached' && (
                    <button type="button" className="btn btn-danger" onClick={onClearOpfsModel}>
                      <Trash2 size={14} /> Clear OPFS ({formatBytes(capability.cachedSizeBytes)})
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allAvailableModels.map((model) => {
                  const isActive = model.id === activeModelId;
                  const isBuiltin = model.id === DEFAULT_BUILTIN_MODEL_ID;
                  return (
                    <div
                      key={model.id}
                      className={`checklist-item ${isActive ? 'done' : ''}`}
                      style={{ justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 14 }}>{model.name}</strong>
                          <span className="pill" style={{ fontSize: 11 }}>{model.id}</span>
                          {model.size_mb ? (
                            <span className="pill" style={{ fontSize: 11 }}>{model.size_mb} MB</span>
                          ) : null}
                          {isBuiltin && (
                            <span className="pill pill-green" style={{ fontSize: 11 }}>Built-in</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
                          {model.url}
                        </div>
                        {model.description && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                            {model.description}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                          type="button"
                          className={isActive ? 'btn btn-success' : 'btn'}
                          onClick={() => onSelectModel(model.id)}
                        >
                          <HardDrive size={14} />
                          {isActive ? 'Active' : 'Use Model'}
                        </button>
                        {!isBuiltin && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => onDeleteModelEntry(model.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Register New Custom Model */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Register Custom `.litertlm` Model</h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              Host your quantized LiteRT-LM bundle on Cloudflare R2 or Hugging Face with CORS enabled, then register its URL in D1.
            </p>
            {modelFormError && (
              <div className="pill pill-red" style={{ borderRadius: 10, padding: '8px 12px' }}>
                {modelFormError}
              </div>
            )}
            <form onSubmit={handleRegisterModel} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="field-label">Model Name *</label>
                <input
                  className="input"
                  placeholder="e.g. Gemma 4 E4B Fine-Tuned COPE"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
                <div>
                  <label className="field-label">Model ID (optional slug)</label>
                  <input
                    className="input"
                    placeholder="auto-generated-slug"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Size (MB)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="1850"
                    value={modelSizeMb}
                    onChange={(e) => setModelSizeMb(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="field-label">Download URL (.litertlm) *</label>
                <input
                  className="input"
                  placeholder="https://models.example.com/gemma-4-custom.litertlm"
                  value={modelUrl}
                  onChange={(e) => setModelUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Description</label>
                <textarea
                  className="textarea"
                  placeholder="Notes on quantization, target hardware, or domain tuning..."
                  value={modelDesc}
                  onChange={(e) => setModelDesc(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={savingModel}>
                <Plus size={15} /> {savingModel ? 'Saving to D1...' : 'Register Model in D1'}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="studio-grid">
          {/* Left / Main Workspace: Schema Studio + Test-Image Sandbox */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    className="select"
                    style={{ width: 'auto', minWidth: 230 }}
                    value={activeSchema.id}
                    onChange={(e) => onSelectSchema(e.target.value)}
                  >
                    {schemas.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.items.length} steps)
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={handleNewBlankSchema}>
                    <Plus size={14} /> New
                  </button>
                  {!BUILT_IN_SCHEMA_IDS.has(draft.id) && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => onDeleteSchema(draft.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" className="btn" onClick={toggleRawMode}>
                    <Code2 size={14} /> {rawMode ? 'Visual Editor' : 'Raw JSON'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveDraft}
                    disabled={savingSchema}
                  >
                    <Save size={14} /> {savingSchema ? 'Saving...' : 'Save Schema'}
                  </button>
                </div>
              </div>

              {jsonError && (
                <div className="pill pill-red" style={{ borderRadius: 10, padding: '8px 12px' }}>
                  {jsonError}
                </div>
              )}

              {rawMode ? (
                <textarea
                  className="code-block"
                  style={{ width: '100%', minHeight: 420, resize: 'vertical', color: 'var(--text)' }}
                  value={rawJson}
                  onChange={(e) => setRawJson(e.target.value)}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px', gap: 10 }}>
                    <div>
                      <label className="field-label">Workflow Name</label>
                      <input
                        className="input"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label">Schema ID</label>
                      <input
                        className="input"
                        value={draft.id}
                        onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label">Domain</label>
                      <input
                        className="input"
                        value={draft.domain}
                        onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <div>
                      <label className="field-label">AI Persona</label>
                      <input
                        className="input"
                        value={draft.persona}
                        onChange={(e) => setDraft({ ...draft, persona: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label">Flag Label</label>
                      <input
                        className="input"
                        value={draft.flagLabel || 'Red Flags'}
                        onChange={(e) => setDraft({ ...draft, flagLabel: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="field-label">Description</label>
                    <input
                      className="input"
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <strong style={{ fontSize: 13 }}>Checklist Steps & Strict Fields ({draft.items.length})</strong>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          items: [...prev.items, createEmptyStep(prev.items.length)],
                        }))
                      }
                    >
                      <Plus size={14} /> Add Step
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {draft.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="card"
                        style={{ padding: 12, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', flexDirection: 'column', gap: 8 }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px auto', gap: 8, alignItems: 'center' }}>
                          <input
                            className="input"
                            placeholder="Step label"
                            value={item.label}
                            onChange={(e) => updateStep(idx, { label: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="step_id"
                            value={item.id}
                            onChange={(e) => updateStep(idx, { id: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="Category"
                            value={item.category}
                            onChange={(e) => updateStep(idx, { category: e.target.value })}
                          />
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                items: prev.items.filter((_, i) => i !== idx),
                              }))
                            }
                            disabled={draft.items.length <= 1}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <input
                            className="input"
                            placeholder="Capture instruction / prompt hint"
                            value={item.promptHint}
                            onChange={(e) => updateStep(idx, { promptHint: e.target.value })}
                          />
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={Boolean(item.required)}
                              onChange={(e) => updateStep(idx, { required: e.target.checked })}
                            />
                            Required
                          </label>
                        </div>

                        {/* Strict Enum / Field Editor */}
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                              Strict Extraction Fields ({item.fieldSpecs?.length || 0})
                            </span>
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: '4px 8px', fontSize: 11 }}
                              onClick={() => addFieldSpec(idx)}
                            >
                              + Add Field / Enum
                            </button>
                          </div>

                          {(item.fieldSpecs || []).map((spec, sIdx) => (
                            <div
                              key={sIdx}
                              style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1.4fr auto', gap: 6, alignItems: 'center' }}
                            >
                              <input
                                className="input"
                                style={{ padding: '6px 8px', fontSize: 12 }}
                                placeholder="field_key"
                                value={spec.key}
                                onChange={(e) => updateFieldSpec(idx, sIdx, { key: e.target.value })}
                              />
                              <select
                                className="select"
                                style={{ padding: '6px 8px', fontSize: 12 }}
                                value={spec.type}
                                onChange={(e) =>
                                  updateFieldSpec(idx, sIdx, {
                                    type: e.target.value as FieldExtractSpec['type'],
                                  })
                                }
                              >
                                <option value="string">string</option>
                                <option value="integer">integer</option>
                                <option value="number">number</option>
                                <option value="boolean">boolean</option>
                                <option value="enum">enum</option>
                              </select>
                              <input
                                className="input"
                                style={{ padding: '6px 8px', fontSize: 12 }}
                                placeholder={
                                  spec.type === 'enum'
                                    ? 'comma-separated enum values'
                                    : 'description (optional)'
                                }
                                value={
                                  spec.type === 'enum'
                                    ? (spec.enumValues || []).join(', ')
                                    : spec.description || ''
                                }
                                onChange={(e) => {
                                  if (spec.type === 'enum') {
                                    updateFieldSpec(idx, sIdx, {
                                      enumValues: e.target.value
                                        .split(',')
                                        .map((v) => v.trim())
                                        .filter(Boolean),
                                    });
                                  } else {
                                    updateFieldSpec(idx, sIdx, { description: e.target.value });
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: '4px 6px' }}
                                onClick={() => removeFieldSpec(idx, sIdx)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live Test-Image Sandbox */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ImageIcon size={16} color="#38bdf8" />
                  <strong style={{ fontSize: 14 }}>Live Test-Image Sandbox</strong>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={sandboxBackend === 'webgpu' ? 'btn btn-primary' : 'btn'}
                    style={{ padding: '6px 10px', fontSize: 12 }}
                    onClick={() => setSandboxBackend('webgpu')}
                  >
                    <Cpu size={13} /> WebGPU (OPFS)
                  </button>
                  <button
                    type="button"
                    className={sandboxBackend === 'ollama' ? 'btn btn-primary' : 'btn'}
                    style={{ padding: '6px 10px', fontSize: 12 }}
                    onClick={() => setSandboxBackend('ollama')}
                  >
                    Local Ollama
                  </button>
                </div>
              </div>

              {sandboxBackend === 'ollama' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
                  <div>
                    <label className="field-label">Ollama Base URL</label>
                    <input
                      className="input"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                    />
                  </div>
                  <div>
                    <label className="field-label">Ollama Vision Model</label>
                    <input
                      className="input"
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      placeholder="gemma3:4b"
                    />
                  </div>
                </div>
              )}

              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleSandboxFile(file);
                }}
              >
                {sandboxPreviewUrl ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                    <img
                      src={sandboxPreviewUrl}
                      alt="Sandbox preview"
                      style={{ width: 84, height: 64, objectFit: 'cover', borderRadius: 8 }}
                    />
                    <div style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>
                      Ready ({formatBytes(sandboxBlob?.size || 0)} downscaled JPEG)
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (sandboxPreviewUrl) URL.revokeObjectURL(sandboxPreviewUrl);
                        setSandboxPreviewUrl(null);
                        setSandboxBlob(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    <Upload size={16} />
                    <span>Drop a local photo here, or click to browse...</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) handleSandboxFile(file);
                      }}
                    />
                  </label>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  className="input"
                  placeholder="Optional operator note (e.g. Vancouver Special, stucco exterior, ~2400 sqft)"
                  value={sandboxTranscript}
                  onChange={(e) => setSandboxTranscript(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-success"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={handleEvaluateSandbox}
                  disabled={evaluating}
                >
                  <Play size={14} /> {evaluating ? 'Evaluating...' : 'Evaluate Step'}
                </button>
              </div>

              {sandboxError && (
                <div className="pill pill-red" style={{ borderRadius: 10, padding: '8px 12px' }}>
                  {sandboxError}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Live Checklist Preview & JSON Output Inspector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>Live Checklist Preview</strong>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '5px 10px', fontSize: 12 }}
                  onClick={() => {
                    setSandboxChecklist(createChecklistFromSchema(draft));
                    setSandboxExtracted({});
                    setSandboxFlags([]);
                    setSandboxLastResult(null);
                  }}
                >
                  <RotateCcw size={13} /> Reset Preview
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sandboxChecklist.map((item) => (
                  <div key={item.id} className={`checklist-item ${item.completed ? 'done' : ''}`}>
                    <CheckCircle2
                      size={17}
                      color={item.completed ? '#10b981' : '#475569'}
                      style={{ flexShrink: 0, marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{item.label || item.id}</span>
                        <span className="pill" style={{ fontSize: 10, padding: '2px 7px' }}>
                          {item.category}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {item.promptHint}
                      </div>
                      {item.fieldSpecs && item.fieldSpecs.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                          {item.fieldSpecs.map((spec) => (
                            <span
                              key={spec.key}
                              className="pill"
                              style={{ fontSize: 10, padding: '2px 6px' }}
                            >
                              {spec.key}: {spec.type}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {sandboxFlags.length > 0 && (
              <div className="card" style={{ borderColor: 'rgba(245, 158, 11, 0.35)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#fbbf24', marginBottom: 6 }}>
                  <AlertTriangle size={15} /> {draft.flagLabel || 'Red Flags'} ({sandboxFlags.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sandboxFlags.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileJson size={15} color="#38bdf8" />
                  <strong style={{ fontSize: 13 }}>JSON Output Inspector</strong>
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '5px 10px', fontSize: 12 }}
                  onClick={async () => {
                    await navigator.clipboard.writeText(JSON.stringify(inspectorPayload, null, 2));
                    setCopiedInspector(true);
                    setTimeout(() => setCopiedInspector(false), 1500);
                  }}
                >
                  {copiedInspector ? <Check size={13} /> : <Copy size={13} />}
                  {copiedInspector ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="code-block" style={{ margin: 0, maxHeight: 340 }}>
                {JSON.stringify(inspectorPayload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
