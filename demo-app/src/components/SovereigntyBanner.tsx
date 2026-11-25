import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';

export type RuntimeModeLabel = 'Gemma 4 WebGPU (Offline Ready)' | 'MicroNode Fallback';

interface SovereigntyBannerProps {
  runtimeMode: RuntimeModeLabel;
  onOpenUpgradeModal: () => void;
}

export const SovereigntyBanner: React.FC<SovereigntyBannerProps> = ({
  runtimeMode,
  onOpenUpgradeModal,
}) => {
  const isFallback = runtimeMode === 'MicroNode Fallback';

  return (
    <div className="sovereignty-banner" role="region" aria-label="Zero-Cloud Sovereignty Status">
      <div className="sovereignty-left">
        <span className="pill pill-green sovereignty-pill">
          <ShieldCheck size={13} />
          <span>100% Local On-Device AI • Zero Cloud Uploads</span>
        </span>
        <span
          className={`sovereignty-runtime ${isFallback ? 'is-fallback' : ''}`}
          title="Active FieldAssistantRouter runtime mode"
        >
          {runtimeMode}
        </span>
      </div>

      <button
        type="button"
        className="sovereignty-cta"
        onClick={onOpenUpgradeModal}
      >
        <span>Connect Team Sync &amp; Multi-PDF RAG (MicroNode)</span>
        <ArrowRight size={13} />
      </button>
    </div>
  );
};
