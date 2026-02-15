import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { sendEmail } from '../lib/edge-functions';
import type { Meeting } from '../types/database';
import { ArrowLeft, Send, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function EmailPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [preface, setPreface] = useState('');
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<'sent' | 'failed' | null>(null);
  const [error, setError] = useState('');

  const fetchMeeting = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from('meetings').select('*').eq('id', id).single();
    setMeeting(data);
    if (data) {
      setSubject(`Meeting Notes: ${data.title || data.source_filename}`);
    }
  }, [id]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  const handleSend = async () => {
    if (!id || !to.trim()) return;

    const toRecipients = to.split(',').map((e) => e.trim()).filter(Boolean);
    const ccRecipients = cc ? cc.split(',').map((e) => e.trim()).filter(Boolean) : undefined;

    setSending(true);
    setError('');
    setResult(null);

    try {
      const res = await sendEmail({
        meetingId: id,
        toRecipients,
        ccRecipients,
        subject,
        messagePreface: preface || undefined,
        includeTranscript,
      });
      setResult(res.status);
    } catch (err) {
      setResult('failed');
      setError(err instanceof Error ? err.message : 'Failed to send email');
    }
    setSending(false);
  };

  if (!meeting) {
    return <div className="loading-indicator"><Loader2 className="spin" size={24} /> Loading...</div>;
  }

  return (
    <div className="email-page">
      <div className="page-header">
        <Link to={`/meeting/${id}`} className="btn btn-ghost">
          <ArrowLeft size={18} />
        </Link>
        <h1>Email: {meeting.title || meeting.source_filename}</h1>
      </div>

      {result === 'sent' ? (
        <div className="success-card">
          <CheckCircle size={40} />
          <p>Email sent successfully!</p>
          <Link to={`/meeting/${id}`} className="btn btn-primary">Back to Meeting</Link>
        </div>
      ) : (
        <div className="email-form">
          <label>
            To (required, comma-separated)
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
              required
            />
          </label>

          <label>
            Cc (optional)
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="manager@example.com"
            />
          </label>

          <label>
            Subject
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>

          <label>
            Message preface (optional)
            <textarea
              value={preface}
              onChange={(e) => setPreface(e.target.value)}
              placeholder="Hi team, here are the notes from today's meeting..."
              rows={3}
            />
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeTranscript}
              onChange={(e) => setIncludeTranscript(e.target.checked)}
            />
            Include full transcript
          </label>

          {result === 'failed' && (
            <div className="error-card">
              <AlertCircle size={18} />
              <span>{error || 'Failed to send email'}</span>
            </div>
          )}

          <button onClick={handleSend} disabled={sending || !to.trim()} className="btn btn-primary btn-lg">
            {sending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            Send Email
          </button>
        </div>
      )}
    </div>
  );
}
