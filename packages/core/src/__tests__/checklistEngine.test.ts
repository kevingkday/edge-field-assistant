import { describe, expect, it } from 'vitest';
import {
  buildStatelessTurnPrompt,
  createChecklistFromSchema,
  extractJsonObject,
  formatBytes,
  mergeStepIntoChecklistState,
  normalizeStepResult,
  type FieldAppSchema,
} from '../index.js';

const sampleSchema: FieldAppSchema = {
  id: 'twincover-cope',
  version: '1.0.0',
  name: 'TwinCover Commercial COPE',
  description: 'Commercial property underwriting walk-through',
  domain: 'insurance',
  persona: 'commercial insurance field inspection copilot',
  flagLabel: 'Underwriting Red Flags',
  items: [
    {
      id: 'electrical_panel',
      label: 'Main Electrical Panel & Amperage',
      category: 'Protection / Systems',
      promptHint: 'Capture main breaker amperage and manufacturer.',
      extractKeys: ['electrical_service'],
      required: true,
    },
    {
      id: 'fire_protection',
      label: 'Fire Protection & Sprinkler Riser',
      category: 'Protection',
      promptHint: 'Snap sprinkler riser tag.',
      extractKeys: ['fire_protection'],
      required: true,
    },
  ],
};

describe('checklistEngine', () => {
  it('initializes uncompleted checklist items from schema', () => {
    const checklist = createChecklistFromSchema(sampleSchema);
    expect(checklist).toHaveLength(2);
    expect(checklist[0].completed).toBe(false);
    expect(checklist[1].id).toBe('fire_protection');
  });

  it('builds a stateless prompt with schema persona and compact checklist', () => {
    const checklist = createChecklistFromSchema(sampleSchema);
    const prompt = buildStatelessTurnPrompt(
      sampleSchema,
      checklist,
      '200A Siemens panel, clean clearances'
    );
    expect(prompt).toContain('commercial insurance field inspection copilot');
    expect(prompt).toContain('TwinCover Commercial COPE');
    expect(prompt).toContain('200A Siemens panel, clean clearances');
    expect(prompt).toContain('electrical_panel');
    expect(prompt).toContain('underwriting red flags');
  });

  it('extracts JSON from fenced markdown output', () => {
    const raw = '```json\n{"detected_item":"200A Panel","checklist_item_id":"electrical_panel"}\n```';
    const parsed = extractJsonObject(raw);
    expect(parsed.detected_item).toBe('200A Panel');
    expect(parsed.checklist_item_id).toBe('electrical_panel');
  });

  it('normalizes step result and detects already-completed items', () => {
    const checklist = createChecklistFromSchema(sampleSchema);
    checklist[0].completed = true;

    const result = normalizeStepResult(
      {
        detected_item: 'Main Breaker Panel',
        checklist_item_id: 'electrical_panel',
        extracted_data: { electrical_service: '200A Siemens' },
        red_flags: [],
      },
      checklist,
      'On-Device WebGPU',
      'local_webgpu',
      412.6
    );

    expect(result.already_completed).toBe(true);
    expect(result.latencyMs).toBe(413);
    expect(result.backend).toBe('local_webgpu');
    expect(result.next_recommended_item).toBe('Fire Protection & Sprinkler Riser');
  });

  it('merges extracted data and deduplicates red flags', () => {
    const checklist = createChecklistFromSchema(sampleSchema);
    const result = normalizeStepResult(
      {
        detected_item: 'Electrical Panel',
        checklist_item_id: 'electrical_panel',
        extracted_data: { electrical_service: '200A' },
        red_flags: ['Missing deadfront screw', 'Missing deadfront screw'],
      },
      checklist,
      'On-Device WebGPU',
      'local_webgpu',
      350
    );

    const merged = mergeStepIntoChecklistState(
      checklist,
      { construction_type: 'Masonry' },
      ['Missing deadfront screw'],
      result,
      '2026-11-19T12:00:00.000Z'
    );

    expect(merged.checklist[0].completed).toBe(true);
    expect(merged.checklist[0].capturedAt).toBe('2026-11-19T12:00:00.000Z');
    expect(merged.extractedData).toEqual({
      construction_type: 'Masonry',
      electrical_service: '200A',
    });
    expect(merged.flags).toEqual(['Missing deadfront screw']);
  });

  it('formats byte sizes cleanly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024 * 1024 * 512)).toBe('512 MB');
  });
});
