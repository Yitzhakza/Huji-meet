import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import { generateSummary } from '../lib/edge-functions';
import type { Meeting, Summary } from '../types/database';
import { Loader2, RefreshCw, Mail, ArrowLeft, ChevronDown } from 'lucide-react';

export default function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!id) return;
    const [meetingRes, summariesRes] = await Promise.all([
      supabase.from('meetings').select('*').eq('id', id).single(),
      supabase
        .from('summaries')
        .select('*')
        .eq('meeting_id', id)
        .order('version', { ascending: false }),
    ]);
    setMeeting(meetingRes.data);
    const sums = summariesRes.data ?? [];
    setSummaries(sums);
    if (sums.length > 0 && currentVersion === null) {
      setCurrentVersion(sums[0].version);
    }
    setLoading(false);
  }, [id, currentVersion]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerate = async () => {
    if (!id) return;
    setGenerating(true);
    setError('');
    try {
      const result = await generateSummary({
        meetingId: id,
        userInstructions: instructions || undefined,
        forceNewVersion: true,
      });
      setSummaries((prev) => [
        { id: result.summaryId, meeting_id: id, version: result.version, template_id: null, model_id: '', content_md: result.content_md, raw_response: null, created_at: new Date().toISOString() },
        ...prev,
      ]);
      setCurrentVersion(result.version);
      setInstructions('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    }
    setGenerating(false);
  };

  const activeSummary = summaries.find((s) => s.version === currentVersion);

  if (loading) {
    return <div className="loading-indicator"><Loader2 className="spin" size={24} /> Loading...</div>;
  }

  if (!meeting) {
    return <div className="empty-state">Meeting not found.</div>;
  }

  return (
    <div className="summary-page">
      <div className="page-header">
        <div className="header-left">
          <Link to={`/meeting/${id}`} className="btn btn-ghost">
            <ArrowLeft size={18} />
          </Link>
          <h1>Summary: {meeting.title || meeting.source_filename}</h1>
        </div>
        <div className="header-actions">
          <Link to={`/meeting/${id}/email`} className="btn btn-outline">
            <Mail size={18} /> Email
          </Link>
        </div>
      </div>

      {/* Generate / Regenerate controls */}
      <div className="summary-controls">
        <textarea
          className="instructions-input"
          placeholder="Optional instructions for summary generation..."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
        />
        <button onClick={handleGenerate} disabled={generating} className="btn btn-primary">
          {generating ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          {summaries.length === 0 ? 'Generate Summary' : 'Regenerate Summary'}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {/* Version selector */}
      {summaries.length > 1 && (
        <div className="version-selector">
          <label>
            Version:
            <div className="select-wrapper">
              <select
                value={currentVersion ?? ''}
                onChange={(e) => setCurrentVersion(Number(e.target.value))}
              >
                {summaries.map((s) => (
                  <option key={s.version} value={s.version}>
                    v{s.version} - {new Date(s.created_at).toLocaleString()}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
        </div>
      )}

      {/* Summary content */}
      {activeSummary ? (
        <div className="summary-content markdown-body">
          <ReactMarkdown>{activeSummary.content_md}</ReactMarkdown>
        </div>
      ) : (
        <div className="empty-state">
          <p>No summary yet. Click "Generate Summary" to create one.</p>
        </div>
      )}
    </div>
  );
}
