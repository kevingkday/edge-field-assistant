import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  Code2,
  Copy,
  Cpu,
  CreditCard,
  ExternalLink,
  FileJson,
  Lock,
  Mic,
  Moon,
  Server,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { MicroNodeUpgradeModal } from './MicroNodeUpgradeModal';

interface LandingPageProps {
  onNavigateApp: (path: string) => void;
}

const THEME_STORAGE_KEY = 'twinrover_landing_theme_v1';

const EMBED_SNIPPET = `<script src="https://twinrover.com/widget.js"></script>
<script>
  window.OceanFallsEdge.init({
    mount: 'floating',
    schemaUrl: 'https://twinrover.com/schemas/twinflow-lead-intake.json'
  });
</script>`;

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigateApp }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [copied, setCopied] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(EMBED_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleAppLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigateApp(path);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className={`landing-root ${theme === 'light' ? 'theme-light' : ''}`}>
      {/* Sticky Top Navbar */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <a href="/" className="landing-brand" aria-label="TwinRover Home">
            <span className="brand-badge">
              <ShieldCheck size={18} />
            </span>
            <span className="landing-brand-text">
              <strong>TwinRover</strong>
              <span className="landing-brand-by">by Ocean Falls</span>
            </span>
          </a>

          <nav className="landing-nav-links" aria-label="Primary navigation">
            <a
              href="#how-it-works"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('how-it-works');
              }}
            >
              How It Works
            </a>
            <a
              href="#embed-sdk"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('embed-sdk');
              }}
            >
              Embed SDK
            </a>
            <a
              href="#micronode-sync"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('micronode-sync');
              }}
            >
              MicroNode Sync
            </a>
            <a
              href="https://www.oceanfalls.com/security-brief.html"
              target="_blank"
              rel="noreferrer"
              className="landing-external-link"
            >
              Security Brief <ExternalLink size={12} />
            </a>
          </nav>

          <div className="landing-nav-actions">
            <button
              type="button"
              className="landing-theme-toggle"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <a
              href="/app"
              className="landing-btn landing-btn-primary"
              onClick={(e) => handleAppLinkClick(e, '/app')}
            >
              Try It Now — Free <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </header>

      <main className="landing-main">
        {/* 1. Hero Section */}
        <section className="landing-hero">
          <div className="landing-eyebrow">
            <Lock size={12} />
            <span>100% ON-DEVICE AI • ZERO CLOUD UPLOADS • AIRPLANE-MODE READY</span>
          </div>

          <h1 className="landing-h1">Offline Field AI That Never Leaves Your Device.</h1>

          <p className="landing-subhead">
            Turn any smartphone or laptop into a private vision and voice assistant. Capture
            inspections, business cards, and field notes with zero cell signal—and sync securely to
            your private Ocean Falls MicroNode.
          </p>

          <div className="landing-hero-ctas">
            <a
              href="/app"
              className="landing-btn landing-btn-primary landing-btn-lg"
              onClick={(e) => handleAppLinkClick(e, '/app')}
            >
              Launch Free Edge Sandbox <ArrowRight size={16} />
            </a>
            <button
              type="button"
              className="landing-btn landing-btn-secondary landing-btn-lg"
              onClick={() => scrollToSection('embed-sdk')}
            >
              <Code2 size={16} /> Embed on Your Website
            </button>
          </div>
        </section>

        {/* 2. How It Works 3-Card Flow */}
        <section id="how-it-works" className="landing-section">
          <div className="landing-section-header">
            <span className="landing-section-kicker">HOW IT WORKS</span>
            <h2>Zero-Cloud Sovereignty from Capture to Sync</h2>
          </div>

          <div className="landing-grid-3">
            <div className="landing-card">
              <div className="landing-card-icon landing-icon-cyan">
                <Cpu size={20} />
              </div>
              <h3>1. Pocket Inference (100% Offline)</h3>
              <p>
                Runs quantized multimodal AI (Gemma 4 via WebGPU) directly on your device&apos;s
                chip. Zero bytes touch public cloud APIs.
              </p>
            </div>

            <div className="landing-card">
              <div className="landing-card-icon landing-icon-emerald">
                <FileJson size={20} />
              </div>
              <h3>2. Instant Structured Output</h3>
              <p>
                Converts photos and spoken field notes into clean JSON checklists, inspection logs,
                or CRM leads in seconds.
              </p>
            </div>

            <div className="landing-card">
              <div className="landing-card-icon landing-icon-amber">
                <Server size={20} />
              </div>
              <h3>3. Sovereign MicroNode Sync</h3>
              <p>
                Reconnect to sync team records, fall back seamlessly on older phones, and search 100+
                page internal PDFs on your private MicroNode.
              </p>
            </div>
          </div>
        </section>

        {/* 3. Interactive Starter Workflows */}
        <section className="landing-section">
          <div className="landing-section-header">
            <span className="landing-section-kicker">TRY IT NOW • ZERO SETUP</span>
            <h2>Interactive Starter Workflows</h2>
            <p className="landing-section-desc">
              Pick a workflow to launch the offline sandbox pre-configured with a domain schema and
              sample test photos.
            </p>
          </div>

          <div className="landing-grid-3">
            <a
              href="/app?mode=inspection"
              className="landing-card landing-workflow-card"
              onClick={(e) => handleAppLinkClick(e, '/app?mode=inspection')}
            >
              <div className="landing-workflow-top">
                <span className="landing-card-icon landing-icon-cyan">
                  <Building2 size={20} />
                </span>
                <span className="landing-launch-tag">
                  Launch <ArrowRight size={13} />
                </span>
              </div>
              <h3>Property &amp; Insurance Inspections</h3>
              <p>
                Snap electrical panels, gauges, roofs, and safety hazards with hands-free voice
                observations.
              </p>
              <div className="landing-schema-tag">twincover-cope / oceanfalls-facility</div>
            </a>

            <a
              href="/app?mode=ocr"
              className="landing-card landing-workflow-card"
              onClick={(e) => handleAppLinkClick(e, '/app?mode=ocr')}
            >
              <div className="landing-workflow-top">
                <span className="landing-card-icon landing-icon-emerald">
                  <CreditCard size={20} />
                </span>
                <span className="landing-launch-tag">
                  Launch <ArrowRight size={13} />
                </span>
              </div>
              <h3>Business Card &amp; Document OCR</h3>
              <p>
                Capture business cards, invoices, or policy headers and dictate immediate CRM
                follow-up notes.
              </p>
              <div className="landing-schema-tag">twinflow-lead-intake</div>
            </a>

            <a
              href="/app?mode=notes"
              className="landing-card landing-workflow-card"
              onClick={(e) => handleAppLinkClick(e, '/app?mode=notes')}
            >
              <div className="landing-workflow-top">
                <span className="landing-card-icon landing-icon-amber">
                  <Mic size={20} />
                </span>
                <span className="landing-launch-tag">
                  Launch <ArrowRight size={13} />
                </span>
              </div>
              <h3>Offline Voice-to-Action-Notes</h3>
              <p>
                Speak messy field or meeting notes and extract structured summaries, action items,
                entities, and dates.
              </p>
              <div className="landing-schema-tag">general-voice-notes</div>
            </a>
          </div>
        </section>

        {/* 4. Developer & Partner Embed Section */}
        <section id="embed-sdk" className="landing-section">
          <div className="landing-embed-panel">
            <div className="landing-embed-copy">
              <span className="landing-section-kicker">DEVELOPER &amp; PARTNER SDK</span>
              <h2>Add Offline Edge AI to Any Website in 5 Lines</h2>
              <p>
                Drop TwinRover&apos;s standalone <code>widget.js</code> into your existing CRM,
                inspection portal, or municipal form. Runs locally on WebGPU with zero backend
                changes required.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 18 }}>
                <a href="/embed-demo.html" className="landing-btn landing-btn-primary">
                  View Live CRM Embed Demo <ArrowRight size={14} />
                </a>
                <a
                  href="/app"
                  className="landing-btn landing-btn-secondary"
                  onClick={(e) => handleAppLinkClick(e, '/app')}
                >
                  Open Full Sandbox
                </a>
              </div>
            </div>

            <div className="landing-code-wrap">
              <div className="landing-code-header">
                <span>index.html</span>
                <button
                  type="button"
                  className="landing-copy-btn"
                  onClick={handleCopySnippet}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="landing-code-block">
                <code>{EMBED_SNIPPET}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* 5. Free vs. MicroNode Team Upgrade Comparison */}
        <section id="micronode-sync" className="landing-section">
          <div className="landing-section-header">
            <span className="landing-section-kicker">DEPLOYMENT TIERS</span>
            <h2>Start Free on Any Device. Scale with MicroNode.</h2>
          </div>

          <div className="landing-grid-2">
            <div className="landing-card landing-tier-card">
              <div className="landing-tier-badge">FREE SANDBOX</div>
              <h3>TwinRover Edge</h3>
              <p className="landing-tier-sub">
                Ideal for individual inspectors, brokers, and evaluations.
              </p>
              <ul className="landing-tier-list">
                <li>
                  <Check size={15} /> On-device WebGPU inference (Gemma 4)
                </li>
                <li>
                  <Check size={15} /> Unlimited offline photo &amp; voice captures
                </li>
                <li>
                  <Check size={15} /> 3 built-in starter schemas + JSON export
                </li>
                <li>
                  <Check size={15} /> <code>0 bytes</code> external cloud egress
                </li>
              </ul>
              <a
                href="/app"
                className="landing-btn landing-btn-secondary landing-tier-cta"
                onClick={(e) => handleAppLinkClick(e, '/app')}
              >
                Launch Free Sandbox <ArrowRight size={14} />
              </a>
            </div>

            <div className="landing-card landing-tier-card landing-tier-featured">
              <div className="landing-tier-badge landing-tier-badge-accent">
                MANAGED TEAM &amp; ENTERPRISE
              </div>
              <h3>Ocean Falls MicroNode</h3>
              <p className="landing-tier-sub">
                Private on-premise or BC-hosted sovereign hardware for teams.
              </p>
              <ul className="landing-tier-list">
                <li>
                  <Check size={15} /> Multi-device team sync &amp; shared audit trails
                </li>
                <li>
                  <Check size={15} /> Automatic fallback for older / low-RAM phones
                </li>
                <li>
                  <Check size={15} /> Multi-document visual RAG (100+ page PDFs)
                </li>
                <li>
                  <Check size={15} /> BC FIPPA / OCAP® sovereign hardware &amp; SLA
                </li>
              </ul>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
                <button
                  type="button"
                  className="landing-btn landing-btn-primary landing-tier-cta"
                  onClick={() => setUpgradeModalOpen(true)}
                >
                  Request MicroNode Team Demo <ArrowRight size={14} />
                </button>
                <a
                  href="https://www.oceanfalls.com/site-assessment.html"
                  target="_blank"
                  rel="noreferrer"
                  className="landing-secondary-link"
                >
                  Or book a Site Assessment on oceanfalls.com <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span>
            <strong>TwinRover</strong> — Sovereign Edge Field Assistant • Powered by{' '}
            <a href="https://www.oceanfalls.com" target="_blank" rel="noreferrer">
              Ocean Falls
            </a>
          </span>
          <div className="landing-footer-links">
            <a
              href="/app"
              onClick={(e) => handleAppLinkClick(e, '/app')}
            >
              Edge Sandbox
            </a>
            <a href="/embed-demo.html">Embed Demo</a>
            <a
              href="https://www.oceanfalls.com/security-brief.html"
              target="_blank"
              rel="noreferrer"
            >
              Security Brief
            </a>
          </div>
        </div>
      </footer>

      <MicroNodeUpgradeModal
        isOpen={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
      />
    </div>
  );
};
