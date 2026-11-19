import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Cpu,
  Download,
  FileJson,
  HardDrive,
  Mic,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  downscaleImageToMaxEdge,
  formatBytes,
  type CapturedMediaEntry,
  type ChecklistItemState,
  type DeviceCapability,
  type FieldAppSchema,
  type ModelDownloadProgress,
  type StepEvaluationResult,
} from '@edge-field-assistant/core';

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

interface FieldCaptureUIProps {
  schema: FieldAppSchema;
  checklist: ChecklistItemState[];
  extractedData: Record<string, unknown>;
  flags: string[];
  photos: CapturedMediaEntry[];
  capability: DeviceCapability;
  downloadProgress: ModelDownloadProgress | null;
  downloadingModel: boolean;
  analyzingStep: boolean;
  lastResult: StepEvaluationResult | null;
  handsFreeVoice: boolean;
  onToggleHandsFreeVoice: () => void;
  onDownloadModel: () => void;
  onDeleteModel: () => void;
  onEvaluateStep: (frameBlob: Blob | null, transcript: string) => Promise<void>;
  onResetSession: () => void;
  onExportSession: () => void;
}

export const FieldCaptureUI: React.FC<FieldCaptureUIProps> = ({
  schema,
  checklist,
  extractedData,
  flags,
  photos,
  capability,
  downloadProgress,
  downloadingModel,
  analyzingStep,
  lastResult,
  handsFreeVoice,
  onToggleHandsFreeVoice,
  onDownloadModel,
  onDeleteModel,
  onEvaluateStep,
  onResetSession,
  onExportSession,
}) => {
  const [transcript, setTranscript] = useState('');
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const completedCount = checklist.filter((item) => item.completed).length;
  const progressPct =
    checklist.length > 0 ? Math.round((completedCount / checklist.length) * 100) : 0;

  const toggleSpeechRecognition = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('SpeechRecognition is unavailable in this browser. Type your field note directly.');
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let full = '';
      for (let i = 0; i < event.results.length; i++) {
        full += event.results[i][0].transcript + ' ';
      }
      setTranscript(full.trim());
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const downscaled = await downscaleImageToMaxEdge(file, 768);
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      setPendingBlob(downscaled);
      setPendingPreviewUrl(URL.createObjectURL(downscaled));
      await onEvaluateStep(downscaled, transcript);
      setTranscript('');
      setPendingBlob(null);
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      setPendingPreviewUrl(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Photo processing failed';
      alert(msg);
    }
  };

  const handleSubmitStep = async () => {
    if (!pendingBlob && !transcript.trim()) {
      alert('Snap a photo or enter/speak a field note first.');
      return;
    }
    await onEvaluateStep(pendingBlob, transcript);
    setTranscript('');
    setPendingBlob(null);
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
      setPendingPreviewUrl(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 3-State Capability & OPFS Model Bar */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {capability.state === 'opfs_cached' ? (
            <span className="pill pill-green">
              <HardDrive size={14} /> On-Device WebGPU Ready ({formatBytes(capability.cachedSizeBytes)})
            </span>
          ) : capability.state === 'ready_to_download' ? (
            <span className="pill pill-amber">
              <Cpu size={14} /> WebGPU Ready — Model Not Cached
            </span>
          ) : (
            <span className="pill pill-red">
              <Cpu size={14} /> {capability.reason}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {capability.state === 'ready_to_download' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onDownloadModel}
              disabled={downloadingModel}
            >
              <Download size={15} />
              {downloadingModel && downloadProgress
                ? `Streaming to OPFS (${downloadProgress.percent}%)`
                : 'Download Gemma 4 E2B to OPFS'}
            </button>
          )}
          {capability.state === 'opfs_cached' && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onDeleteModel}
              title="Remove cached model from OPFS"
            >
              <Trash2 size={14} /> Clear OPFS Model
            </button>
          )}
        </div>
      </div>

      {/* Main Mobile-First Capture & Checklist Grid */}
      <div className="grid-2">
        {/* Left Column: Camera, Voice, and AI Feedback */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{schema.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{schema.description}</div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={onToggleHandsFreeVoice}
                title="Toggle Hands-Free Voice Feedback"
              >
                {handsFreeVoice ? <Volume2 size={15} /> : <VolumeX size={15} />}
                {handsFreeVoice ? 'TTS On' : 'TTS Off'}
              </button>
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handlePhotoSelected}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '14px 12px', fontSize: 14 }}
                onClick={() => cameraInputRef.current?.click()}
                disabled={analyzingStep}
              >
                <Camera size={18} />
                {analyzingStep ? 'Analyzing Frame...' : 'Snap Field Photo'}
              </button>

              <button
                type="button"
                className={isListening ? 'btn btn-danger' : 'btn'}
                style={{ padding: '14px 12px', fontSize: 14 }}
                onClick={toggleSpeechRecognition}
                disabled={analyzingStep}
              >
                {isListening ? <Square size={16} /> : <Mic size={18} />}
                {isListening ? 'Stop Mic' : 'Voice Note'}
              </button>
            </div>

            {pendingPreviewUrl && (
              <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <img
                  src={pendingPreviewUrl}
                  alt="Downscaled capture preview"
                  style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }}
                />
              </div>
            )}

            <textarea
              className="textarea"
              placeholder="Speak or type field observations (e.g., '200A Siemens main panel, clean 36 inch clearance')..."
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Stateless turn: max 768px frame + checklist JSON
              </span>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleSubmitStep}
                disabled={analyzingStep || (!pendingBlob && !transcript.trim())}
              >
                <Send size={15} />
                {analyzingStep ? 'Running...' : 'Evaluate Step'}
              </button>
            </div>
          </div>

          {/* Live AI Feedback Banner */}
          {lastResult && (
            <div
              className="card"
              style={{
                borderColor: lastResult.already_completed
                  ? 'rgba(245, 158, 11, 0.5)'
                  : 'rgba(16, 185, 129, 0.45)',
                background: lastResult.already_completed
                  ? 'rgba(245, 158, 11, 0.08)'
                  : 'rgba(16, 185, 129, 0.07)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>
                  {lastResult.already_completed ? 'Already Captured' : `Detected: ${lastResult.detected_item}`}
                </strong>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {lastResult.engine} · {lastResult.latencyMs} ms
                </span>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: 13 }}>{lastResult.spoken_feedback}</p>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Next recommended: <strong>{lastResult.next_recommended_item}</strong>
              </div>
            </div>
          )}

          {/* Extracted Data & Flags */}
          {(Object.keys(extractedData).length > 0 || flags.length > 0) && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.keys(extractedData).length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                    Extracted Structured Data
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {Object.entries(extractedData).map(([k, v]) => (
                      <span key={k} className="pill">
                        <span style={{ color: 'var(--text-muted)' }}>{k}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {flags.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#f87171', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} /> {schema.flagLabel || 'Red Flags'} ({flags.length})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#fecaca' }}>
                    {flags.map((flag) => (
                      <li key={flag}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Live Checklist & Evidence */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                Live Checklist ({completedCount}/{checklist.length})
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {progressPct}% complete · {photos.length} photo{photos.length === 1 ? '' : 's'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onExportSession}>
                <FileJson size={14} /> Export JSON
              </button>
              <button type="button" className="btn btn-ghost" onClick={onResetSession} title="Reset checklist">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {checklist.map((item) => (
              <div key={item.id} className={`checklist-item ${item.completed ? 'done' : ''}`}>
                <div style={{ paddingTop: 2, color: item.completed ? 'var(--success)' : 'var(--text-muted)' }}>
                  <CheckCircle2 size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{item.label}</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.category}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                    {item.promptHint}
                  </div>
                  {item.extractedData && Object.keys(item.extractedData).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {Object.entries(item.extractedData).map(([k, v]) => (
                        <span key={k} className="pill pill-green" style={{ fontSize: 11 }}>
                          {k}: {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
