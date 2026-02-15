import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { startTranscription } from '../lib/edge-functions';
import type { Meeting, TranscriptSegment } from '../types/database';
import { Loader2, Search, Download, Sparkles, Mail, RotateCcw, Pencil, Check, X } from 'lucide-react';

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerLabel, setNewSpeakerLabel] = useState('');
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    const [meetingRes, segmentsRes] = await Promise.all([
      supabase.from('meetings').select('*').eq('id', id).single(),
      supabase
        .from('transcript_segments')
        .select('*')
        .eq('meeting_id', id)
        .order('start_ms', { ascending: true }),
    ]);
    setMeeting(meetingRes.data);
    setSegments(segmentsRes.data ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll while transcribing
  useEffect(() => {
    if (meeting?.status !== 'transcribing') return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('meetings')
        .select('status')
        .eq('id', id!)
        .single();
      if (data?.status === 'ready' || data?.status === 'failed') {
        fetchData();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [meeting?.status, id, fetchData]);

  const handleSeek = (startMs: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = startMs / 1000;
      mediaRef.current.play();
    }
  };

  const handleRenameSpeaker = async (oldSpeakerId: string) => {
    if (!newSpeakerLabel.trim() || !id) return;
    await supabase
      .from('transcript_segments')
      .update({ speaker_label: newSpeakerLabel.trim() })
      .eq('meeting_id', id)
      .eq('speaker_id', oldSpeakerId);
    setSegments((prev) =>
      prev.map((s) =>
        s.speaker_id === oldSpeakerId ? { ...s, speaker_label: newSpeakerLabel.trim() } : s
      )
    );
    setEditingSpeaker(null);
    setNewSpeakerLabel('');
  };

  const handleRetryTranscription = async () => {
    if (!id) return;
    await startTranscription({ meetingId: id });
    fetchData();
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const exportTxt = () => {
    const text = segments
      .map((s) => `[${formatTime(s.start_ms)}] ${s.speaker_label}: ${s.text}`)
      .join('\n');
    download(text, `${meeting?.title || 'transcript'}.txt`, 'text/plain');
  };

  const exportJson = () => {
    const json = JSON.stringify(segments, null, 2);
    download(json, `${meeting?.title || 'transcript'}.json`, 'application/json');
  };

  const download = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredSegments = searchText.trim()
    ? segments.filter((s) => s.text.toLowerCase().includes(searchText.toLowerCase()))
    : segments;

  const uniqueSpeakers = [...new Map(segments.map((s) => [s.speaker_id, s.speaker_label])).entries()];

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!meeting?.media_path) return;
    supabase.storage
      .from('media')
      .createSignedUrl(meeting.media_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setMediaUrl(data.signedUrl);
      });
  }, [meeting?.media_path]);

  if (loading) {
    return <div className="loading-indicator"><Loader2 className="spin" size={24} /> Loading meeting...</div>;
  }

  if (!meeting) {
    return <div className="empty-state">Meeting not found.</div>;
  }

  return (
    <div className="meeting-page">
      <div className="page-header">
        <h1>{meeting.title || meeting.source_filename}</h1>
        <div className="header-actions">
          {meeting.status === 'ready' && (
            <>
              <Link to={`/meeting/${meeting.id}/summary`} className="btn btn-primary">
                <Sparkles size={18} /> Summary
              </Link>
              <Link to={`/meeting/${meeting.id}/email`} className="btn btn-outline">
                <Mail size={18} /> Email
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Media Player */}
      {mediaUrl && (
        <div className="media-player">
          {meeting.media_mime.startsWith('video/') ? (
            <video ref={mediaRef} src={mediaUrl} controls className="media-element" />
          ) : (
            <div className="audio-player-wrapper">
              <audio ref={mediaRef} src={mediaUrl} controls className="audio-element" />
            </div>
          )}
        </div>
      )}

      {/* Status states */}
      {meeting.status === 'uploaded' && (
        <div className="status-card">
          <p>File uploaded. Transcription has not started yet.</p>
          <button onClick={handleRetryTranscription} className="btn btn-primary">Start Transcription</button>
        </div>
      )}

      {meeting.status === 'transcribing' && (
        <div className="status-card status-transcribing">
          <Loader2 className="spin" size={24} />
          <p>Transcription in progress... This may take a few minutes.</p>
        </div>
      )}

      {meeting.status === 'failed' && (
        <div className="status-card status-failed">
          <p>Transcription failed.</p>
          <button onClick={handleRetryTranscription} className="btn btn-primary">
            <RotateCcw size={18} /> Retry
          </button>
        </div>
      )}

      {/* Transcript */}
      {meeting.status === 'ready' && segments.length > 0 && (
        <div className="transcript-section">
          <div className="transcript-toolbar">
            <div className="search-input">
              <Search size={18} />
              <input
                type="text"
                placeholder="Search transcript..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            <div className="export-buttons">
              <button onClick={exportTxt} className="btn btn-ghost btn-sm">
                <Download size={16} /> TXT
              </button>
              <button onClick={exportJson} className="btn btn-ghost btn-sm">
                <Download size={16} /> JSON
              </button>
            </div>
          </div>

          {/* Speaker labels */}
          <div className="speaker-labels">
            <h3>Speakers</h3>
            <div className="speaker-list">
              {uniqueSpeakers.map(([speakerId, label]) => (
                <div key={speakerId} className="speaker-chip">
                  {editingSpeaker === speakerId ? (
                    <div className="speaker-edit">
                      <input
                        type="text"
                        value={newSpeakerLabel}
                        onChange={(e) => setNewSpeakerLabel(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameSpeaker(speakerId)}
                        autoFocus
                      />
                      <button onClick={() => handleRenameSpeaker(speakerId)} className="btn btn-ghost btn-xs">
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingSpeaker(null)} className="btn btn-ghost btn-xs">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span>{label}</span>
                      <button
                        onClick={() => {
                          setEditingSpeaker(speakerId);
                          setNewSpeakerLabel(label);
                        }}
                        className="btn btn-ghost btn-xs"
                      >
                        <Pencil size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Segments */}
          <div className="transcript-segments">
            {filteredSegments.map((seg) => (
              <div
                key={seg.id}
                className="segment"
                onClick={() => handleSeek(seg.start_ms)}
              >
                <div className="segment-header">
                  <span className="segment-speaker">{seg.speaker_label}</span>
                  <span className="segment-time">
                    {formatTime(seg.start_ms)} - {formatTime(seg.end_ms)}
                  </span>
                </div>
                <p className="segment-text">{seg.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
