import React, { useState } from 'react';
import { Cloud, CloudOff, Download, Edit3, Lock, Plus, Trash2, Upload, X } from 'lucide-react';
import type { FieldAppSchema, FieldSchemaItem } from '@edge-field-assistant/core';
import { BUILT_IN_SCHEMA_IDS, type SchemaSyncStatus } from '../utils/schemaSync';

interface SchemaBuilderProps {
  isOpen: boolean;
  activeSchema: FieldAppSchema;
  allSchemas: FieldAppSchema[];
  syncStatus: SchemaSyncStatus;
  onClose: () => void;
  onSaveSchema: (schema: FieldAppSchema) => Promise<void> | void;
  onDeleteSchema: (schemaId: string) => Promise<void> | void;
}

const createEmptyItem = (index: number): FieldSchemaItem => ({
  id: `item_${index + 1}`,
  label: '',
  category: 'General',
  promptHint: '',
  extractKeys: [],
  required: true,
});

export const SchemaBuilder: React.FC<SchemaBuilderProps> = ({
  isOpen,
  activeSchema,
  allSchemas,
  syncStatus,
  onClose,
  onSaveSchema,
  onDeleteSchema,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('custom');
  const [persona, setPersona] = useState('field inspection and data extraction copilot');
  const [description, setDescription] = useState('');
  const [flagLabel, setFlagLabel] = useState('Red Flags');
  const [items, setItems] = useState<FieldSchemaItem[]>([createEmptyItem(0)]);
  const [jsonInput, setJsonInput] = useState('');
  const [mode, setMode] = useState<'form' | 'import' | 'manage'>('form');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const customSchemas = allSchemas.filter((s) => !BUILT_IN_SCHEMA_IDS.has(s.id));

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDomain('custom');
    setPersona('field inspection and data extraction copilot');
    setDescription('');
    setFlagLabel('Red Flags');
    setItems([createEmptyItem(0)]);
    setError(null);
  };

  const loadSchemaIntoForm = (schema: FieldAppSchema) => {
    setEditingId(schema.id);
    setName(schema.name);
    setDomain(schema.domain || 'custom');
    setPersona(schema.persona || 'field inspection copilot');
    setDescription(schema.description || '');
    setFlagLabel(schema.flagLabel || 'Red Flags');
    setItems(
      schema.items.length > 0
        ? schema.items.map((item) => ({ ...item }))
        : [createEmptyItem(0)]
    );
    setMode('form');
    setError(null);
  };

  const handleAddItem = () => {
    setItems((prev) => [...prev, createEmptyItem(prev.length)]);
  };

  const handleRemoveItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, patch: Partial<FieldSchemaItem>) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Schema name is required.');
      return;
    }

    const validItems = items.filter((item) => item.label.trim());
    if (validItems.length === 0) {
      setError('Add at least one checklist item with a label.');
      return;
    }

    const generatedId = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const schema: FieldAppSchema = {
      id: editingId || generatedId || `custom-${Date.now()}`,
      version: '1.0.0',
      name: name.trim(),
      description: description.trim() || `Custom field workflow for ${name.trim()}`,
      domain: domain.trim() || 'custom',
      persona: persona.trim() || 'field inspection copilot',
      flagLabel: flagLabel.trim() || 'Red Flags',
      items: validItems.map((item, idx) => ({
        ...item,
        id:
          item.id.trim() ||
          item.label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_') ||
          `item_${idx + 1}`,
      })),
    };

    setSaving(true);
    try {
      await onSaveSchema(schema);
      resetForm();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleImportJson = async () => {
    setError(null);
    try {
      const parsed = JSON.parse(jsonInput) as FieldAppSchema;
      if (!parsed.id || !parsed.name || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        throw new Error('Schema JSON must include "id", "name", and a non-empty "items" array.');
      }
      setSaving(true);
      await onSaveSchema(parsed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON schema.');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    setJsonInput(text);
    setMode('import');
  };

  const handleExportActive = () => {
    const blob = new Blob([JSON.stringify(activeSchema, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSchema.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {editingId ? `Edit "${name || editingId}"` : 'Schema Builder & Cloud Sync'}
            </h2>
            {syncStatus === 'synced' && (
              <span className="pill pill-green" style={{ fontSize: 11 }}>
                <Cloud size={12} /> Synced to Cloudflare
              </span>
            )}
            {syncStatus === 'offline_local' && (
              <span className="pill pill-amber" style={{ fontSize: 11 }}>
                <CloudOff size={12} /> Saved Locally (Offline)
              </span>
            )}
            {syncStatus === 'auth_required' && (
              <span className="pill pill-red" style={{ fontSize: 11 }}>
                <Lock size={12} /> Auth Token Required
              </span>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={mode === 'form' ? 'btn btn-primary' : 'btn'}
            onClick={() => {
              if (mode !== 'form') resetForm();
              setMode('form');
            }}
          >
            + Visual Builder
          </button>
          <button
            type="button"
            className={mode === 'manage' ? 'btn btn-primary' : 'btn'}
            onClick={() => setMode('manage')}
          >
            Manage Custom ({customSchemas.length})
          </button>
          <button
            type="button"
            className={mode === 'import' ? 'btn btn-primary' : 'btn'}
            onClick={() => setMode('import')}
          >
            <Upload size={14} /> Import JSON
          </button>
          <button type="button" className="btn" onClick={handleExportActive}>
            <Download size={14} /> Export "{activeSchema.id}.json"
          </button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            <Upload size={14} /> Load .json File
            <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleFileUpload} />
          </label>
        </div>

        {error && (
          <div className="pill pill-red" style={{ marginBottom: 12, width: '100%', borderRadius: 10, padding: '8px 12px' }}>
            {error}
          </div>
        )}

        {mode === 'manage' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {customSchemas.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>
                No custom schemas yet. Create one in the Visual Builder or import a JSON schema.
              </div>
            ) : (
              customSchemas.map((schema) => (
                <div
                  key={schema.id}
                  className="card"
                  style={{
                    padding: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{schema.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {schema.id} · {schema.items.length} items · {schema.domain}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => loadSchemaIntoForm(schema)}
                    >
                      <Edit3 size={14} /> Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => onDeleteSchema(schema.id)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : mode === 'form' ? (
          <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Workflow Name *</label>
                <input
                  className="input"
                  placeholder="e.g. Solar Roof Pre-Site Audit"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Domain</label>
                <input
                  className="input"
                  placeholder="e.g. energy_audit"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>AI Persona</label>
              <input
                className="input"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Description</label>
                <input
                  className="input"
                  placeholder="Short description of this field workflow"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Flag Label</label>
                <input
                  className="input"
                  value={flagLabel}
                  onChange={(e) => setFlagLabel(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <strong style={{ fontSize: 13 }}>Checklist Items</strong>
              <button type="button" className="btn" onClick={handleAddItem}>
                <Plus size={14} /> Add Item
              </button>
            </div>

            {items.map((item, idx) => (
              <div
                key={idx}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                  <input
                    className="input"
                    placeholder="Item Label *"
                    value={item.label}
                    onChange={(e) => handleItemChange(idx, { label: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Category"
                    value={item.category}
                    onChange={(e) => handleItemChange(idx, { category: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleRemoveItem(idx)}
                    disabled={items.length === 1}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <input
                  className="input"
                  placeholder="Capture hint for operator (e.g. Snap inverter nameplate)"
                  value={item.promptHint}
                  onChange={(e) => handleItemChange(idx, { promptHint: e.target.value })}
                />
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              {editingId && (
                <button type="button" className="btn" onClick={resetForm}>
                  New Blank
                </button>
              )}
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update & Sync Schema' : 'Save & Activate Schema'}
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <textarea
              className="textarea"
              style={{ minHeight: 240, fontFamily: 'monospace', fontSize: 12 }}
              placeholder='Paste FieldAppSchema JSON here...'
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleImportJson} disabled={saving}>
                {saving ? 'Importing...' : 'Import & Activate'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
