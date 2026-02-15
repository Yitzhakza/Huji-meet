import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { AppSettings, SummaryTemplate } from '../types/database';
import { Save, Plus, Trash2, Loader2, Star } from 'lucide-react';

type Tab = 'providers' | 'templates' | 'limits' | 'email';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('providers');

  return (
    <div className="admin-page">
      <h1>Admin Settings</h1>
      <div className="admin-tabs">
        {(['providers', 'templates', 'limits', 'email'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'providers' && <ProvidersTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'limits' && <LimitsTab />}
      {tab === 'email' && <EmailTab />}
    </div>
  );
}

function ProvidersTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single();
    if (data) setSettings(data);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage('');

    // Save non-secret settings
    const { error } = await supabase
      .from('app_settings')
      .update({
        elevenlabs_default_model_id: settings.elevenlabs_default_model_id,
        elevenlabs_diarize_default: settings.elevenlabs_diarize_default,
        elevenlabs_tag_audio_events_default: settings.elevenlabs_tag_audio_events_default,
        openrouter_default_model: settings.openrouter_default_model,
        openrouter_temperature: settings.openrouter_temperature,
        openrouter_max_tokens: settings.openrouter_max_tokens,
      })
      .eq('id', 1);

    // Save secrets via edge function (they should never be in the frontend DB)
    if (elevenlabsKey || openrouterKey) {
      await supabase.functions.invoke('update_provider_secrets', {
        body: {
          elevenlabs_api_key: elevenlabsKey || undefined,
          openrouter_api_key: openrouterKey || undefined,
        },
      });
    }

    setSaving(false);
    setMessage(error ? `Error: ${error.message}` : 'Settings saved!');
    setElevenlabsKey('');
    setOpenrouterKey('');
  };

  if (!settings) return <div className="loading-indicator"><Loader2 className="spin" size={20} /></div>;

  return (
    <div className="admin-section">
      <h2>ElevenLabs</h2>
      <label>
        API Key (leave blank to keep current)
        <input type="password" value={elevenlabsKey} onChange={(e) => setElevenlabsKey(e.target.value)} placeholder="sk-..." />
      </label>
      <label>
        Default Model ID
        <input
          type="text"
          value={settings.elevenlabs_default_model_id ?? ''}
          onChange={(e) => setSettings({ ...settings, elevenlabs_default_model_id: e.target.value || null })}
          placeholder="e.g. scribe_v1"
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.elevenlabs_diarize_default}
          onChange={(e) => setSettings({ ...settings, elevenlabs_diarize_default: e.target.checked })}
        />
        Diarize by default
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.elevenlabs_tag_audio_events_default}
          onChange={(e) => setSettings({ ...settings, elevenlabs_tag_audio_events_default: e.target.checked })}
        />
        Tag audio events by default
      </label>

      <h2>OpenRouter</h2>
      <label>
        API Key (leave blank to keep current)
        <input type="password" value={openrouterKey} onChange={(e) => setOpenrouterKey(e.target.value)} placeholder="sk-..." />
      </label>
      <label>
        Default Model
        <input
          type="text"
          value={settings.openrouter_default_model ?? ''}
          onChange={(e) => setSettings({ ...settings, openrouter_default_model: e.target.value || null })}
          placeholder="e.g. anthropic/claude-sonnet-4-5-20250929"
        />
      </label>
      <label>
        Temperature
        <input
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={settings.openrouter_temperature}
          onChange={(e) => setSettings({ ...settings, openrouter_temperature: parseFloat(e.target.value) || 0 })}
        />
      </label>
      <label>
        Max Tokens
        <input
          type="number"
          value={settings.openrouter_max_tokens}
          onChange={(e) => setSettings({ ...settings, openrouter_max_tokens: parseInt(e.target.value) || 1200 })}
        />
      </label>

      {message && <p className={message.startsWith('Error') ? 'error-msg' : 'success-msg'}>{message}</p>}
      <button onClick={saveSettings} disabled={saving} className="btn btn-primary">
        {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />} Save Provider Settings
      </button>
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<SummaryTemplate[]>([]);
  const [editing, setEditing] = useState<SummaryTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase.from('summary_templates').select('*').order('created_at');
    setTemplates(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    if (!editing) return;
    if (editing.id) {
      await supabase.from('summary_templates').update({
        name: editing.name,
        system_prompt: editing.system_prompt,
        user_prompt: editing.user_prompt,
        output_format: editing.output_format,
      }).eq('id', editing.id);
    } else {
      await supabase.from('summary_templates').insert({
        name: editing.name,
        system_prompt: editing.system_prompt,
        user_prompt: editing.user_prompt,
        output_format: editing.output_format,
      });
    }
    setEditing(null);
    fetch();
  };

  const setDefault = async (templateId: string) => {
    // Clear all defaults first
    await supabase.from('summary_templates').update({ is_default: false }).neq('id', '');
    await supabase.from('summary_templates').update({ is_default: true }).eq('id', templateId);
    fetch();
  };

  const remove = async (templateId: string) => {
    if (!confirm('Delete this template?')) return;
    await supabase.from('summary_templates').delete().eq('id', templateId);
    fetch();
  };

  const blankTemplate: SummaryTemplate = {
    id: '',
    name: '',
    system_prompt: '',
    user_prompt: '',
    output_format: 'markdown',
    is_default: false,
    created_at: '',
  };

  if (loading) return <div className="loading-indicator"><Loader2 className="spin" size={20} /></div>;

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>Summary Templates</h2>
        <button onClick={() => setEditing(blankTemplate)} className="btn btn-primary btn-sm">
          <Plus size={16} /> New Template
        </button>
      </div>

      {editing && (
        <div className="template-editor">
          <label>
            Name
            <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label>
            System Prompt
            <textarea rows={4} value={editing.system_prompt} onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })} />
          </label>
          <label>
            User Prompt
            <textarea rows={6} value={editing.user_prompt} onChange={(e) => setEditing({ ...editing, user_prompt: e.target.value })} />
          </label>
          <label>
            Output Format
            <input type="text" value={editing.output_format} onChange={(e) => setEditing({ ...editing, output_format: e.target.value })} />
          </label>
          <div className="editor-actions">
            <button onClick={save} className="btn btn-primary btn-sm"><Save size={16} /> Save</button>
            <button onClick={() => setEditing(null)} className="btn btn-ghost btn-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="templates-list">
        {templates.map((t) => (
          <div key={t.id} className="template-card">
            <div className="template-info">
              <strong>{t.name}</strong>
              {t.is_default && <span className="badge badge-green">Default</span>}
            </div>
            <div className="template-actions">
              <button onClick={() => setEditing(t)} className="btn btn-ghost btn-xs">Edit</button>
              {!t.is_default && (
                <button onClick={() => setDefault(t.id)} className="btn btn-ghost btn-xs"><Star size={14} /> Set Default</button>
              )}
              <button onClick={() => remove(t.id)} className="btn btn-ghost btn-xs btn-danger"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LimitsTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('id', 1).single().then(({ data }) => {
      if (data) setSettings(data);
    });
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .update({
        max_upload_mb: settings.max_upload_mb,
        retention_days: settings.retention_days,
      })
      .eq('id', 1);
    setSaving(false);
    setMessage(error ? `Error: ${error.message}` : 'Saved!');
  };

  if (!settings) return <div className="loading-indicator"><Loader2 className="spin" size={20} /></div>;

  return (
    <div className="admin-section">
      <h2>Upload & Retention Limits</h2>
      <label>
        Max Upload Size (MB)
        <input
          type="number"
          value={settings.max_upload_mb}
          onChange={(e) => setSettings({ ...settings, max_upload_mb: parseInt(e.target.value) || 200 })}
        />
      </label>
      <label>
        Retention Days (blank = forever)
        <input
          type="number"
          value={settings.retention_days ?? ''}
          onChange={(e) => setSettings({ ...settings, retention_days: e.target.value ? parseInt(e.target.value) : null })}
        />
      </label>
      {message && <p className={message.startsWith('Error') ? 'error-msg' : 'success-msg'}>{message}</p>}
      <button onClick={save} disabled={saving} className="btn btn-primary">
        {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />} Save Limits
      </button>
    </div>
  );
}

function EmailTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('id', 1).single().then(({ data }) => {
      if (data) setSettings(data);
    });
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .update({ gmail_sending_enabled: settings.gmail_sending_enabled })
      .eq('id', 1);
    setSaving(false);
    setMessage(error ? `Error: ${error.message}` : 'Saved!');
  };

  if (!settings) return <div className="loading-indicator"><Loader2 className="spin" size={20} /></div>;

  return (
    <div className="admin-section">
      <h2>Email Settings</h2>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.gmail_sending_enabled}
          onChange={(e) => setSettings({ ...settings, gmail_sending_enabled: e.target.checked })}
        />
        Enable Gmail sending
      </label>
      <p className="hint">When enabled, users can send meeting summaries via their Google account. Requires Gmail send scope on login.</p>
      {message && <p className={message.startsWith('Error') ? 'error-msg' : 'success-msg'}>{message}</p>}
      <button onClick={save} disabled={saving} className="btn btn-primary">
        {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />} Save Email Settings
      </button>
    </div>
  );
}
