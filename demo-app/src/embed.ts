import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  FieldAssistantRouter,
  type FieldAppSchema,
} from '@edge-field-assistant/core';
import { EmbedWidget, type CaptureCompletePayload } from './components/EmbedWidget';

export interface SyncEndpointConfig {
  url: string;
  apiKey?: string;
}

export interface OceanFallsEdgeConfig {
  /** CSS selector, DOM element, or "floating" for a bottom-right drawer button. */
  mount: string | HTMLElement;
  /** Inline FieldAppSchema JSON object. */
  schema?: FieldAppSchema;
  /** URL to fetch a FieldAppSchema JSON (resolved relative to widget.js if relative). */
  schemaUrl?: string;
  /** Optional MicroNode /v1/field-sync endpoint URL or { url, apiKey }. */
  syncEndpoint?: string | SyncEndpointConfig;
  /** Optional destination webhook URL to POST captured structured JSON. */
  webhookUrl?: string;
  /** Callback fired immediately after capture evaluation completes. */
  onCaptureComplete?: (payload: CaptureCompletePayload) => void;
  /** Start floating drawer open (default false). */
  defaultOpen?: boolean;
}

export interface OceanFallsEdgeInstance {
  destroy: () => void;
  open: () => void;
  close: () => void;
}

const DEFAULT_EMBED_SCHEMA: FieldAppSchema = {
  id: 'twinflow-lead-intake',
  version: '1.0.0',
  name: 'TwinFlow Field Lead Intake',
  description: 'Business card OCR and spoken lead intake.',
  domain: 'crm_intake',
  persona: 'B2B field sales engineer and CRM intake specialist',
  flagLabel: 'Deal Blockers & Risks',
  items: [
    {
      id: 'business_card_ocr',
      label: 'Business Card OCR & Spoken Lead Notes',
      category: 'Contact Capture',
      promptHint: 'Snap a business card or speak name, company, email, phone, and notes.',
      extractKeys: ['name', 'company', 'email', 'phone', 'notes'],
      required: true,
    },
  ],
};

function getWidgetBaseUrl(): string {
  try {
    return new URL('.', import.meta.url).href;
  } catch {
    return typeof window !== 'undefined' ? `${window.location.origin}/` : '/';
  }
}

function createCrossOriginSafeWorker(): Worker {
  const workerUrl = new URL('@edge-field-assistant/core/worker', import.meta.url);
  if (typeof window === 'undefined' || workerUrl.origin === window.location.origin) {
    return new Worker(workerUrl, { type: 'module' });
  }
  const blob = new Blob([`import ${JSON.stringify(workerUrl.href)};`], {
    type: 'application/javascript',
  });
  const blobUrl = URL.createObjectURL(blob);
  return new Worker(blobUrl, { type: 'module' });
}

async function resolveSchema(config: OceanFallsEdgeConfig, baseUrl: string): Promise<FieldAppSchema> {
  if (config.schema) return config.schema;
  if (config.schemaUrl) {
    const resolvedUrl = new URL(config.schemaUrl, baseUrl).href;
    const resp = await fetch(resolvedUrl);
    if (!resp.ok) {
      throw new Error(`Failed to load schema from ${resolvedUrl} (HTTP ${resp.status})`);
    }
    return (await resp.json()) as FieldAppSchema;
  }
  return DEFAULT_EMBED_SCHEMA;
}

export async function init(config: OceanFallsEdgeConfig): Promise<OceanFallsEdgeInstance> {
  if (typeof document === 'undefined') {
    throw new Error('OceanFallsEdge.init() requires a browser DOM.');
  }

  const baseUrl = getWidgetBaseUrl();
  const wasmBaseUrl = new URL('wasm/', baseUrl).href;
  const schema = await resolveSchema(config, baseUrl);

  const syncUrl =
    typeof config.syncEndpoint === 'string'
      ? config.syncEndpoint
      : config.syncEndpoint?.url;
  const syncApiKey =
    typeof config.syncEndpoint === 'object' ? config.syncEndpoint?.apiKey : undefined;

  const router = new FieldAssistantRouter({
    wasmBaseUrl,
    remoteEndpointUrl: syncUrl || undefined,
    remoteHeaders: syncApiKey ? { Authorization: `Bearer ${syncApiKey}` } : undefined,
    createWorker: createCrossOriginSafeWorker,
  });

  const isFloating = config.mount === 'floating';
  let container: HTMLElement | null = null;
  let createdContainer = false;

  if (isFloating) {
    container = document.createElement('div');
    container.dataset.oceanfallsEdge = 'floating';
    document.body.appendChild(container);
    createdContainer = true;
  } else if (typeof config.mount === 'string') {
    container = document.querySelector<HTMLElement>(config.mount);
    if (!container) {
      throw new Error(`OceanFallsEdge.init(): mount selector "${config.mount}" not found.`);
    }
  } else if (config.mount instanceof HTMLElement) {
    container = config.mount;
  } else {
    throw new Error('OceanFallsEdge.init(): invalid "mount" target.');
  }

  let controls: { open: () => void; close: () => void } = {
    open: () => {},
    close: () => {},
  };

  const root = ReactDOM.createRoot(container);
  root.render(
    React.createElement(EmbedWidget, {
      mode: isFloating ? 'floating' : 'inline',
      schema,
      router,
      syncEndpointUrl: syncUrl,
      syncApiKey,
      webhookUrl: config.webhookUrl,
      onCaptureComplete: config.onCaptureComplete,
      initialOpen: config.defaultOpen,
      onRegisterControls: (c) => {
        controls = c;
      },
    })
  );

  return {
    destroy: () => {
      root.unmount();
      router.dispose();
      if (createdContainer && container?.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
    open: () => controls.open(),
    close: () => controls.close(),
  };
}

declare global {
  interface Window {
    OceanFallsEdge?: {
      init: typeof init;
    };
  }
}

if (typeof window !== 'undefined') {
  window.OceanFallsEdge = { init };
}

export default { init };
