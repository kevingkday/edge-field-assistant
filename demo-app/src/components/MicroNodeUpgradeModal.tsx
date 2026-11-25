import React, { useState } from 'react';
import { CheckCircle2, Database, FileText, Server, Smartphone, X } from 'lucide-react';

interface MicroNodeUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LeadPayload {
  name: string;
  company: string;
  email: string;
  teamSize: string;
  source: string;
  createdAt: string;
}

const PENDING_LEADS_STORAGE_KEY = 'twinfield_pending_leads_v1';

function saveLeadLocally(lead: LeadPayload): void {
  try {
    const raw = localStorage.getItem(PENDING_LEADS_STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as LeadPayload[]) : [];
    const next = Array.isArray(existing) ? [...existing, lead] : [lead];
    localStorage.setItem(PENDING_LEADS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export const MicroNodeUpgradeModal: React.FC<MicroNodeUpgradeModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [teamSize, setTeamSize] = useState('6-20');
  const [submitting, setSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<'idle' | 'sent' | 'saved_offline'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !company.trim() || !email.trim()) {
      setError('Please fill in your name, company/organization, and email.');
      return;
    }

    const payload: LeadPayload = {
      name: name.trim(),
      company: company.trim(),
      email: email.trim(),
      teamSize,
      source: 'twinrover-sovereign-sandbox',
      createdAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        const resp = await fetch('https://oceanfalls.com/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (resp.ok) {
          setSubmitState('sent');
          return;
        }
      }
      saveLeadLocally(payload);
      setSubmitState('saved_offline');
    } catch {
      saveLeadLocally(payload);
      setSubmitState('saved_offline');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetAndClose = () => {
    setSubmitState('idle');
    setError(null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleResetAndClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Server size={18} style={{ color: '#38bdf8' }} />
              <h2 style={{ margin: 0, fontSize: 18 }}>MicroNode Team Upgrade</h2>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Keep 100% data sovereignty while unlocking team-wide sync, older-device fallback, and private document RAG.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={handleResetAndClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
          <div className="upgrade-feature">
            <Database size={16} style={{ color: '#34d399', flexShrink: 0 }} />
            <div>
              <strong style={{ fontSize: 13 }}>Team Capture Sync Across Devices</strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Automatically sync structured JSON checklists, photos, and audit trails across all staff phones and tablets.
              </div>
            </div>
          </div>

          <div className="upgrade-feature">
            <Smartphone size={16} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <div>
              <strong style={{ fontSize: 13 }}>Automatic Fallback for Older Phones</strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Devices without WebGPU seamlessly route through your private MicroNode without changing the field UI.
              </div>
            </div>
          </div>

          <div className="upgrade-feature">
            <FileText size={16} style={{ color: '#fbbf24', flexShrink: 0 }} />
            <div>
              <strong style={{ fontSize: 13 }}>100+ Page Internal PDF RAG</strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Search municipal bylaws, underwriting manuals, and equipment SOPs on an on-premise or BC-hosted MicroNode.
              </div>
            </div>
          </div>
        </div>

        {submitState === 'sent' ? (
          <div className="card" style={{ borderColor: 'rgba(16, 185, 129, 0.45)', background: 'rgba(16, 185, 129, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34d399', fontWeight: 700, marginBottom: 6 }}>
              <CheckCircle2 size={18} /> Request Received
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Thanks, {name}! Our team will reach out to <strong>{email}</strong> with MicroNode deployment options for {company}.
            </p>
          </div>
        ) : submitState === 'saved_offline' ? (
          <div className="card" style={{ borderColor: 'rgba(245, 158, 11, 0.45)', background: 'rgba(245, 158, 11, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fbbf24', fontWeight: 700, marginBottom: 6 }}>
              <CheckCircle2 size={18} /> Saved Locally (Offline Fallback)
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              You appear to be offline or the lead endpoint is currently unreachable. Your request for <strong>{company}</strong> has been saved locally on this device.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="field-label" htmlFor="lead-name">Name *</label>
                <input
                  id="lead-name"
                  className="input"
                  type="text"
                  placeholder="Alex Mercer"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="lead-company">Company / Organization *</label>
                <input
                  id="lead-company"
                  className="input"
                  type="text"
                  placeholder="Pacific Underwriting Ltd."
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.7fr', gap: 10 }}>
              <div>
                <label className="field-label" htmlFor="lead-email">Work Email *</label>
                <input
                  id="lead-email"
                  className="input"
                  type="email"
                  placeholder="alex@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="lead-team-size">Team Size</label>
                <select
                  id="lead-team-size"
                  className="select"
                  value={teamSize}
                  onChange={(e) => setTeamSize(e.target.value)}
                >
                  <option value="1-5">1–5 staff</option>
                  <option value="6-20">6–20 staff</option>
                  <option value="21-50">21–50 staff</option>
                  <option value="50+">50+ staff</option>
                </select>
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-ghost" onClick={handleResetAndClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Sending...' : 'Request MicroNode Demo'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
