import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { createUploadUrl, startTranscription } from '../lib/edge-functions';
import { Mic, Square, X, Loader2, CheckCircle } from 'lucide-react';

type RecordingStep = 'idle' | 'recording' | 'uploading' | 'starting' | 'done' | 'error';

interface Props {
  onClose: () => void;
}

export default function RecordingModal({ onClose }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState<RecordingStep>('idle');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support audio recording. Make sure you are using HTTPS or localhost.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => handleRecordingComplete();

      recorder.start();
      setStep('recording');
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Microphone error: ${message}`);
      setStep('error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const handleRecordingComplete = async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const file = new File([blob], 'recording.webm', { type: 'audio/webm' });

    try {
      setStep('uploading');

      const { meetingId, storagePath } = await createUploadUrl({
        title: title || `Recording ${new Date().toLocaleString()}`,
        filename: 'recording.webm',
        mime: 'audio/webm',
      });

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(storagePath, file, { contentType: 'audio/webm', upsert: true });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      setStep('starting');
      await startTranscription({ meetingId });

      setStep('done');
      setTimeout(() => navigate(`/meeting/${meetingId}`), 1500);
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const cancelRecording = () => {
    cleanup();
    onClose();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && step === 'idle' && onClose()}>
      <div className="recording-modal">
        {step !== 'recording' && step !== 'uploading' && step !== 'starting' && step !== 'done' && (
          <button className="modal-close btn btn-ghost btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        )}

        {step === 'idle' && (
          <>
            <h2>Record Audio</h2>
            <label className="recording-title-label">
              Title (optional)
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Weekly standup"
              />
            </label>
            <button className="btn btn-primary btn-lg recording-start-btn" onClick={startRecording}>
              <Mic size={20} /> Start Recording
            </button>
          </>
        )}

        {step === 'recording' && (
          <div className="recording-active">
            <div className="recording-indicator">
              <span className="rec-dot" />
              <span className="rec-label">Recording</span>
            </div>
            <div className="recording-timer">{formatTime(duration)}</div>
            <div className="recording-actions">
              <button className="btn btn-primary btn-lg" onClick={stopRecording}>
                <Square size={18} /> Stop & Transcribe
              </button>
              <button className="btn btn-outline" onClick={cancelRecording}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'uploading' && (
          <div className="recording-processing">
            <Loader2 className="spin" size={32} />
            <p>Uploading recording...</p>
          </div>
        )}

        {step === 'starting' && (
          <div className="recording-processing">
            <Loader2 className="spin" size={32} />
            <p>Starting transcription...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="recording-done">
            <CheckCircle size={40} />
            <p>Transcription started! Redirecting...</p>
          </div>
        )}

        {step === 'error' && (
          <div className="recording-error">
            <p className="error-msg">{error}</p>
            <div className="recording-actions">
              <button className="btn btn-primary" onClick={() => { setStep('idle'); setError(''); }}>
                Try Again
              </button>
              <button className="btn btn-outline" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
