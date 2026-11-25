import React, { useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, MessageSquare, Send, Shield, X } from 'lucide-react';
import {
  getQueuedFeedbackCount,
  submitOrQueueFeedback,
  type FeedbackDiagnostics,
  type FeedbackRating,
} from '../utils/feedbackQueue';

interface FeedbackDrawerProps {
  isOpen: boolean;
  diagnostics: FeedbackDiagnostics;
  onClose: () => void;
}

const RATINGS: FeedbackRating[] = [
  'Worked Great',
  'Slow or Glitchy',
  "Didn't Load on My Device",
];

export const FeedbackDrawer: React.FC<FeedbackDrawerProps> = ({
  isOpen,
  diagnostics,
  onClose,
}) => {
  const [rating, setRating] = useState<FeedbackRating>('Worked Great');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [resultStatus, setResultStatus] = useState<'idle' | 'sent' | 'queued'>('idle');

  useEffect(() => {
    if (isOpen) {
      getQueuedFeedbackCount().then(setQueuedCount);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await submitOrQueueFeedback({
        rating,
        message: message.trim() || rating,
        email: email.trim() || undefined,
        diagnostics,
      });
      setResultStatus(res.status);
      setMessage('');
      const count = await getQueuedFeedbackCount();
      setQueuedCount(count);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={18} style={{ color: '#38bdf8' }} />
            <h2 style={{ margin: 0, fontSize: 16 }}>Send Tester Feedback</h2>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close feedback drawer">
            <X size={16} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          Help us improve TwinRover on your device. If you&apos;re offline, your feedback queues in IndexedDB and sends automatically when reconnected.
        </p>

        {queuedCount > 0 && (
          <div className="pill pill-amber" style={{ alignSelf: 'flex-start' }}>
            <CloudOff size={13} /> {queuedCount} feedback item{queuedCount === 1 ? '' : 's'} queued offline
          </div>
        )}

        {resultStatus !== 'idle' ? (
          <div
            className="card"
            style={{
              borderColor:
                resultStatus === 'sent' ? 'rgba(16, 185, 129, 0.45)' : 'rgba(245, 158, 11, 0.45)',
              background:
                resultStatus === 'sent' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6 }}>
              <CheckCircle2 size={16} />
              {resultStatus === 'sent' ? 'Feedback Sent — Thank You!' : 'Saved Offline in IndexedDB'}
            </div>
            <p style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--text-muted)' }}>
              {resultStatus === 'sent'
                ? 'Your rating and device diagnostics were recorded.'
                : 'Your feedback is safely queued and will send automatically once you are back online.'}
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => setResultStatus('idle')}
            >
              Send Another Note
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="field-label">Quick Rating</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {RATINGS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={rating === option ? 'btn btn-primary' : 'btn'}
                    style={{ fontSize: 12, padding: '7px 12px' }}
                    onClick={() => setRating(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="feedback-message">
                What were you trying to capture, and what would make this useful in your daily work?
              </label>
              <textarea
                id="feedback-message"
                className="textarea"
                rows={4}
                placeholder="e.g., Tested electrical panel OCR on iPhone 15 — worked offline, would love PDF export..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="feedback-email">
                Want us to follow up? (Optional email)
              </label>
              <input
                id="feedback-email"
                className="input"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="card" style={{ padding: 12, background: '#0b1220' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#34d399', marginBottom: 6 }}>
                <Shield size={13} /> Non-Sensitive Diagnostics Attached (No Photos or Transcripts)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'grid', gap: 3 }}>
                <div>hasWebGPU: <strong>{String(diagnostics.hasWebGPU)}</strong> · deviceMemory: <strong>{diagnostics.deviceMemory ?? 'unknown'} GB</strong></div>
                <div>activeSchemaId: <strong>{diagnostics.activeSchemaId}</strong> · latency: <strong>{diagnostics.inferenceLatencyMs != null ? `${diagnostics.inferenceLatencyMs} ms` : 'n/a'}</strong></div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  userAgent: {diagnostics.userAgent}
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <Send size={14} />
              {submitting ? 'Submitting...' : 'Send Feedback'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
