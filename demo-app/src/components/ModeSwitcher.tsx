import React from 'react';
import { Building2, CreditCard, Mic } from 'lucide-react';

export interface StarterMode {
  key: 'inspection' | 'ocr' | 'voice';
  title: string;
  subtitle: string;
  schemaId: string;
  alternateSchemaId?: string;
}

export const STARTER_MODES: StarterMode[] = [
  {
    key: 'inspection',
    title: 'Property & Facility Inspection',
    subtitle: 'Gauges, electrical panels, hazards & exteriors + voice',
    schemaId: 'twincover-cope',
    alternateSchemaId: 'oceanfalls-facility',
  },
  {
    key: 'ocr',
    title: 'Business Card & Document OCR',
    subtitle: 'Business cards, invoices & policy headers + notes',
    schemaId: 'twinflow-lead-intake',
  },
  {
    key: 'voice',
    title: 'Offline Voice-to-Action-Notes',
    subtitle: 'Messy field/meeting notes → summary, actions & dates',
    schemaId: 'general-voice-notes',
  },
];

interface ModeSwitcherProps {
  activeSchemaId: string;
  onSelectSchema: (schemaId: string) => void;
}

export const ModeSwitcher: React.FC<ModeSwitcherProps> = ({
  activeSchemaId,
  onSelectSchema,
}) => {
  const isInspectionActive =
    activeSchemaId === 'twincover-cope' || activeSchemaId === 'oceanfalls-facility';

  return (
    <div className="mode-switcher" role="tablist" aria-label="Starter workflow modes">
      {STARTER_MODES.map((mode) => {
        const isActive =
          mode.key === 'inspection'
            ? isInspectionActive
            : activeSchemaId === mode.schemaId;

        const Icon =
          mode.key === 'inspection'
            ? Building2
            : mode.key === 'ocr'
              ? CreditCard
              : Mic;

        return (
          <div
            key={mode.key}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            className={`mode-tab ${isActive ? 'is-active' : ''}`}
            onClick={() => onSelectSchema(mode.schemaId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSchema(mode.schemaId);
              }
            }}
          >
            <div className="mode-tab-header">
              <span className="mode-tab-icon">
                <Icon size={16} />
              </span>
              <span className="mode-tab-title">{mode.title}</span>
            </div>
            <div className="mode-tab-sub">{mode.subtitle}</div>
            {mode.key === 'inspection' && isActive && (
              <div className="mode-sub-pills" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={`mode-sub-pill ${activeSchemaId === 'twincover-cope' ? 'is-selected' : ''}`}
                  onClick={() => onSelectSchema('twincover-cope')}
                >
                  Commercial COPE
                </button>
                <button
                  type="button"
                  className={`mode-sub-pill ${activeSchemaId === 'oceanfalls-facility' ? 'is-selected' : ''}`}
                  onClick={() => onSelectSchema('oceanfalls-facility')}
                >
                  Facility Ops
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
