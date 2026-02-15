import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Meeting, MeetingStatus } from '../types/database';
import { Plus, Mic, Search, Eye, Sparkles, Mail, Trash2, Loader2 } from 'lucide-react';
import RecordingModal from '../components/RecordingModal';

export default function DashboardPage() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MeetingStatus | ''>('');
  const [showRecorder, setShowRecorder] = useState(false);

  const fetchMeetings = useCallback(async () => {
    if (!user) return;
    let query = supabase
      .from('meetings')
      .select('*')
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    if (search.trim()) {
      query = query.ilike('title', `%${search.trim()}%`);
    }

    const { data } = await query;
    setMeetings(data ?? []);
    setLoading(false);
  }, [user, statusFilter, search]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const handleDelete = async (meetingId: string) => {
    if (!confirm('Delete this meeting and all associated data?')) return;
    await supabase.from('meetings').delete().eq('id', meetingId);
    setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const statusBadge = (status: MeetingStatus) => {
    const classes: Record<MeetingStatus, string> = {
      uploaded: 'badge badge-gray',
      transcribing: 'badge badge-blue',
      ready: 'badge badge-green',
      failed: 'badge badge-red',
    };
    return <span className={classes[status]}>{status}</span>;
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1>My Meetings</h1>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={() => setShowRecorder(true)}>
            <Mic size={18} /> Record
          </button>
          <Link to="/upload" className="btn btn-primary">
            <Plus size={18} /> Upload New
          </Link>
        </div>
      </div>

      {showRecorder && <RecordingModal onClose={() => setShowRecorder(false)} />}

      <div className="filters-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search meetings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MeetingStatus | '')}
          className="filter-select"
        >
          <option value="">All statuses</option>
          <option value="uploaded">Uploaded</option>
          <option value="transcribing">Transcribing</option>
          <option value="ready">Ready</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {loading ? (
        <div className="loading-indicator"><Loader2 className="spin" size={24} /> Loading meetings...</div>
      ) : meetings.length === 0 ? (
        <div className="empty-state">
          <p>No meetings found.</p>
          <Link to="/upload" className="btn btn-primary">Upload your first recording</Link>
        </div>
      ) : (
        <div className="meetings-table-wrapper">
          <table className="meetings-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id}>
                  <td className="meeting-title">
                    <Link to={`/meeting/${m.id}`}>{m.title || m.source_filename}</Link>
                  </td>
                  <td>{statusBadge(m.status)}</td>
                  <td>{formatDuration(m.duration_seconds)}</td>
                  <td>{formatDate(m.created_at)}</td>
                  <td className="actions">
                    <Link to={`/meeting/${m.id}`} className="btn btn-ghost btn-sm" title="View">
                      <Eye size={16} />
                    </Link>
                    {m.status === 'ready' && (
                      <>
                        <Link to={`/meeting/${m.id}/summary`} className="btn btn-ghost btn-sm" title="Summary">
                          <Sparkles size={16} />
                        </Link>
                        <Link to={`/meeting/${m.id}/email`} className="btn btn-ghost btn-sm" title="Email">
                          <Mail size={16} />
                        </Link>
                      </>
                    )}
                    <button onClick={() => handleDelete(m.id)} className="btn btn-ghost btn-sm btn-danger" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
