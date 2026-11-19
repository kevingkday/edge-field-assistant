# Edge Field Assistant

**Fast, Private, Offline Multimodal Field Assistant SDK (`@edge-field-assistant/core`) & Extensible PWA Showcase (`demo-app`).**

Extracted and generalized from TwinCover's Guided Field Walk-Through workflow, Edge Field Assistant runs multimodal vision, voice transcription, and structured JSON checklist extraction **100% locally in mobile and desktop browsers** via **WebGPU + OPFS + `@litert-lm/core`**, while supporting plug-and-play JSON schemas for any field domain.

---

## Architecture Overview

```text
edge-field-assistant/
├── packages/core/             # @edge-field-assistant/core SDK
│   └── src/
│       ├── types.ts           # Generic FieldAppSchema & StepEvaluationResult contracts
│       ├── modelManager.ts    # 3-state WebGPU/RAM capability router & OPFS streaming cache
│       ├── checklistEngine.ts # Stateless-turn prompt builder, JSON parser & state reducer
│       ├── inferenceWorker.ts # Off-main-thread Web Worker running @litert-lm/core (WebGPU)
│       └── fallbackRouter.ts  # Routes local WebGPU vs. optional remote vision endpoint
└── demo-app/                  # Offline-capable PWA showcase
    ├── public/
    │   ├── wasm/              # Self-hosted @litert-lm/core WASM assets
    │   └── schemas/           # Plug-and-play JSON schemas (TwinCover, Ocean Falls, TwinFlow)
    └── src/components/
        ├── FieldCaptureUI.tsx # Mobile-first camera (<=768px) + mic + live checklist UI
        ├── SchemaBuilder.tsx  # "+ New Custom Schema" modal & JSON import/export
        └── TelemetryDrawer.tsx# Live latency (ms), active backend, OPFS size, & JSON state
```

### Key Design Principles
1. **Stateless Single-Turn Vision**: Every frame is downscaled on-device to `<=768px` on its longest edge and evaluated in a fresh, single-turn `conversation` that is immediately deleted in `finally`, preventing mobile RAM exhaustion.
2. **3-State Capability Routing**:
   - `opfs_cached`: Model weights (`gemma-4-E2B-it-web.litertlm`) are cached in OPFS; inference runs 100% offline on WebGPU.
   - `ready_to_download`: WebGPU & OPFS are available; prompts operator to stream weights to OPFS.
   - `unsupported`: Hardware/browser lacks WebGPU, OPFS, or `>=4 GB` RAM; routes to an optional remote vision endpoint.
3. **Self-Hosted WASM**: `@litert-lm/core` WASM files are served from `/wasm/` and cached by the PWA Service Worker (`/sw.js`) for air-gapped field operation.

---

## Quickstart

```bash
npm install
npm run sync-wasm
npm run test
npm run build
npm run dev
```

Open `http://localhost:5173` in a WebGPU-enabled browser (Chrome/Edge desktop or Android).

---

## Embedding `@edge-field-assistant/core`

```ts
import {
  FieldAssistantRouter,
  createChecklistFromSchema,
  downscaleImageToMaxEdge,
  mergeStepIntoChecklistState,
  type FieldAppSchema,
} from '@edge-field-assistant/core';

const router = new FieldAssistantRouter({
  wasmBaseUrl: '/wasm/',
  remoteEndpointUrl: 'https://api.example.com/vision/evaluate', // optional fallback
  createWorker: () =>
    new Worker(new URL('@edge-field-assistant/core/worker', import.meta.url), {
      type: 'module',
    }),
});

const schema: FieldAppSchema = await fetch('/schemas/twincover-cope.json').then((r) => r.json());
let checklist = createChecklistFromSchema(schema);

const frame = await downscaleImageToMaxEdge(photoFile, 768);
const result = await router.evaluateStep({
  schema,
  checklist,
  transcript: '200A Siemens main breaker panel',
  imageBlob: frame,
});

const nextState = mergeStepIntoChecklistState(checklist, {}, [], result);
checklist = nextState.checklist;
```
