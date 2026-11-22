/**
 * Core type definitions for the schema-driven Edge Field Assistant SDK.
 */

export interface FieldExtractSpec {
  /** Key name in extracted_data. */
  key: string;
  /** Expected value type for strict extraction. */
  type: 'string' | 'integer' | 'number' | 'boolean' | 'enum';
  /** Allowed values when type is 'enum'. */
  enumValues?: string[];
  /** Optional guidance for extracting this field. */
  description?: string;
}

export interface FieldSchemaItem {
  /** Unique identifier for this checklist item within the schema. */
  id: string;
  /** Human-readable title displayed in the field checklist. */
  label: string;
  /** Grouping category (e.g., "Construction", "Safety", "Qualification"). */
  category: string;
  /** Short capture instruction shown to the field operator. */
  promptHint: string;
  /** Optional target structured keys to extract for this item. */
  extractKeys?: string[];
  /** Optional strict field type & enum constraints for extracted_data. */
  fieldSpecs?: FieldExtractSpec[];
  /** Whether this item is required before completing the session. */
  required?: boolean;
}

export interface CustomModelEntry {
  id: string;
  name: string;
  url: string;
  size_mb?: number | null;
  description?: string | null;
  updated_at?: string;
}

export interface FieldAppSchema {
  /** Stable machine-readable schema identifier (e.g., "twincover-cope"). */
  id: string;
  /** Semantic version of the schema definition. */
  version: string;
  /** Display name for the app/workflow. */
  name: string;
  /** Short description of the field capture workflow. */
  description: string;
  /** Domain tag (e.g., "insurance", "facility_ops", "crm_intake", "custom"). */
  domain: string;
  /** Role persona injected into the multimodal prompt. */
  persona: string;
  /** Optional label for anomalies/warnings (defaults to "Red Flags"). */
  flagLabel?: string;
  /** Optional accent hex color for UI theming. */
  accentColor?: string;
  /** Ordered list of checklist items for this workflow. */
  items: FieldSchemaItem[];
}

export interface ChecklistItemState extends FieldSchemaItem {
  completed: boolean;
  capturedAt?: string;
  extractedData?: Record<string, unknown>;
}

export type CapabilityState = 'unsupported' | 'ready_to_download' | 'opfs_cached';

export interface DeviceCapability {
  state: CapabilityState;
  reason: string;
  cachedSizeBytes: number;
  hasWebGpu: boolean;
  hasOpfs: boolean;
  deviceMemoryGb: number | null;
}

export interface ModelDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface ModelConfig {
  filename: string;
  downloadUrl: string;
  minValidBytes: number;
  minMemoryGb: number;
}

export type InferenceBackend = 'local_webgpu' | 'remote_vision' | 'none';

export interface StepEvaluationInput {
  schema: FieldAppSchema;
  checklist: ChecklistItemState[];
  transcript: string;
  imageBlob?: Blob | null;
}

export interface StepEvaluationResult {
  detected_item: string;
  checklist_item_id: string | null;
  already_completed: boolean;
  extracted_data: Record<string, unknown>;
  red_flags: string[];
  spoken_feedback: string;
  next_recommended_item: string;
  engine: string;
  backend: InferenceBackend;
  latencyMs: number;
}

export interface CapturedMediaEntry {
  id: string;
  itemId: string;
  detectedItem: string;
  filename: string;
  blob: Blob;
  capturedAt: string;
}

export interface TelemetrySnapshot {
  lastLatencyMs: number | null;
  activeBackend: InferenceBackend;
  engineLabel: string;
  opfsCachedBytes: number;
  capabilityState: CapabilityState;
  stepCount: number;
  isOnline: boolean;
  lastUpdatedAt: string | null;
}
