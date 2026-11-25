import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Mic,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  FieldAssistantRouter,
  createChecklistFromSchema,
  downscaleImageToMaxEdge,
  downloadModelToOpfs,
  formatBytes,
  mergeStepIntoChecklistState,
  type ChecklistItemState,
  type DeviceCapability,
  type FieldAppSchema,
  type ModelDownloadProgress,
  type StepEvaluationResult,
} from '@edge-field-assistant/core';

export interface CaptureCompletePayload {
  structuredData: Record<string, unknown>;
  transcript: string;
  mode: 'local-webgpu' | 'micronode-fallback';
  capturedAt: string;
  result: StepEvaluationResult;
}

export interface EmbedWidgetProps {
  mode: 'inline' | 'floating';
  schema: FieldAppSchema;
  router: FieldAssistantRouter;
  syncEndpointUrl?: string;
  syncApiKey?: string;
  webhookUrl?: string;
  onCaptureComplete?: (payload: CaptureCompletePayload) => void;
  initialOpen?: boolean;
  onRegisterControls?: (controls: { open: () => void; close: () => void }) => void;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SCOPED_CSS = `
.ofe-root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #f8fafc;
  box-sizing: border-box;
}
.ofe-root *, .ofe-root *::before, .ofe-root *::after {
  box-sizing: border-box;
}
.ofe-card {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 14px;
  padding: 14px;
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.45);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ofe-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 9998;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: linear-gradient(135deg, #0ea5e9, #6366f1);
  color: #ffffff;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(14, 165, 233, 0.35);
}
.ofe-floating-panel {
  position: fixed;
  right: 20px;
  bottom: 76px;
  z-index: 9999;
  width: min(390px, calc(100vw - 24px));
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}
.ofe-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #1e293b;
  color: #f8fafc;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ofe-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ofe-btn-primary {
  background: #0ea5e9;
  border-color: transparent;
  color: #04121d;
}
.ofe-btn-danger {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}
.ofe-textarea {
  width: 100%;
  min-height: 62px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #020617;
  color: #f8fafc;
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
}
.ofe-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: #1e293b;
  border: 1px solid rgba(148, 163, 184, 0.22);
}
`;

export const EmbedWidget: React.FC<EmbedWidgetProps> = ({
  mode,
  schema,
  router,
  syncEndpointUrl,
  syncApiKey,
  webhookUrl,
  onCaptureComplete,
  initialOpen = false,
  onRegisterControls,
}) => {
  const [open, setOpen] = useState(mode === 'inline' ? true : initialOpen);
  const [checklist, setChecklist] = useState<ChecklistItemState[]>(() =>
    createChecklistFromSchema(schema)
  );
  const [extractedData, setExtractedData] = useState<Record<string, unknown>>({});
  const [capability, setCapability] = useState<DeviceCapability | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [transcript, setTranscript] = useState('');
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    onRegisterControls?.({
      open: () => setOpen(true),
      close: () => setOpen(false),
    });
  }, [onRegisterControls]);

  useEffect(() => {
    router.getCapability().then(setCapability).catch(() => {});
  }, [router]);

  const handleDownloadModel = async () => {
    setDownloading(true);
    setErrorMsg(null);
    try {
      await downloadModelToOpfs((p) => setProgress(p));
      const cap = await router.getCapability();
      setCapability(cap);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Model download failed');
    } finally {
      setDownloading(false);
    }
  };

  const toggleVoice = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setErrorMsg('SpeechRecognition unavailable in this browser.');
      return;
    }
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let full = '';
      for (let i = 0; i < ev.results.length; i++) {
        full += ev.results[i][0].transcript + ' ';
      }
      setTranscript(full.trim());
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  };

  const runEvaluation = async (blob: Blob | null, note: string) => {
    setAnalyzing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const result = await router.evaluateStep({
        schema,
        checklist,
        transcript: note,
        imageBlob: blob,
      });

      const merged = mergeStepIntoChecklistState(checklist, extractedData, [], result);
      setChecklist(merged.checklist);
      setExtractedData(merged.extractedData);
      setStatusMsg(result.spoken_feedback);

      const capturedAt = new Date().toISOString();
      const captureMode: 'local-webgpu' | 'micronode-fallback' =
        result.backend === 'local_webgpu' ? 'local-webgpu' : 'micronode-fallback';

      const payload: CaptureCompletePayload = {
        structuredData: merged.extractedData,
        transcript: note,
        mode: captureMode,
        capturedAt,
        result,
      };

      onCaptureComplete?.(payload);

      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      }

      if (syncEndpointUrl) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (syncApiKey) headers.Authorization = `Bearer ${syncApiKey}`;
        fetch(syncEndpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            schemaId: schema.id,
            ...payload,
          }),
        }).catch(() => {});
      }

      setTranscript('');
      setPendingBlob(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Capture evaluation failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const downscaled = await downscaleImageToMaxEdge(file, 768);
      setPendingBlob(downscaled);
      await runEvaluation(downscaled, transcript);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Photo processing failed');
    }
  };

  const completedCount = checklist.filter((c) => c.completed).length;

  const panelBody = (
    <div className="ofe-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{schema.name}</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            {completedCount}/{checklist.length} steps ·{' '}
            {capability?.state === 'opfs_cached'
              ? `Local WebGPU (${formatBytes(capability.cachedSizeBytes)})`
              : capability?.state === 'ready_to_download'
                ? 'WebGPU Ready'
                : syncEndpointUrl
                  ? 'MicroNode Fallback'
                  : 'WebGPU Unavailable'}
          </div>
        </div>
        {mode === 'floating' && (
          <button type="button" className="ofe-btn" onClick={() => setOpen(false)}>
            <X size={14} />
          </button>
        )}
      </div>

      {capability?.state === 'ready_to_download' && (
        <button
          type="button"
          className="ofe-btn ofe-btn-primary"
          onClick={handleDownloadModel}
          disabled={downloading}
        >
          <Download size={14} />
          {downloading && progress
            ? `Streaming to OPFS (${progress.percent}%)`
            : 'Download Offline Model to OPFS'}
        </button>
      )}

      {capability?.state === 'opfs_cached' && (
        <div className="ofe-pill" style={{ color: '#34d399', alignSelf: 'flex-start' }}>
          <HardDrive size={12} /> Offline WebGPU Ready
        </div>
      )}

      {capability?.state === 'unsupported' && (
        <div className="ofe-pill" style={{ color: '#fbbf24', alignSelf: 'flex-start' }}>
          <Cpu size={12} /> {syncEndpointUrl ? 'Using MicroNode Fallback' : capability.reason}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoChange}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          className="ofe-btn ofe-btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={analyzing}
        >
          <Camera size={15} />
          {analyzing ? 'Analyzing...' : 'Snap Photo'}
        </button>
        <button
          type="button"
          className={`ofe-btn ${isListening ? 'ofe-btn-danger' : ''}`}
          onClick={toggleVoice}
          disabled={analyzing}
        >
          {isListening ? <Square size={14} /> : <Mic size={14} />}
          {isListening ? 'Stop Mic' : 'Speak Note'}
        </button>
      </div>

      <textarea
        className="ofe-textarea"
        placeholder="Speak or type field notes (e.g. Jane Doe at Acme Solar, jane@acme.com, 604-555-0199)..."
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
      />

      <button
        type="button"
        className="ofe-btn"
        disabled={analyzing || (!pendingBlob && !transcript.trim())}
        onClick={() => runEvaluation(pendingBlob, transcript)}
      >
        <Send size={14} /> {analyzing ? 'Extracting...' : 'Extract & Populate'}
      </button>

      {statusMsg && (
        <div style={{ fontSize: 12, color: '#34d399', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div style={{ fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.14)', padding: '6px 9px', borderRadius: 8 }}>
          {errorMsg}
        </div>
      )}
    </div>
  );

  return (
    <div className="ofe-root">
      <style>{SCOPED_CSS}</style>
      {mode === 'inline' ? (
        panelBody
      ) : (
        <>
          <button type="button" className="ofe-fab" onClick={() => setOpen((v) => !v)}>
            <Sparkles size={16} />
            {open ? 'Close TwinRover' : 'TwinRover AI'}
          </button>
          {open && <div className="ofe-floating-panel">{panelBody}</div>}
        </>
      )}
    </div>
  );
};
