import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { supabase } from '../lib/supabase';
import { createUploadUrl, startTranscription } from '../lib/edge-functions';
import { Upload, FileAudio, Loader2, CheckCircle } from 'lucide-react';

const ACCEPTED_TYPES: Record<string, string[]> = {
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/x-m4a': ['.m4a'],
  'audio/mp4': ['.m4a'],
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
};

type UploadStep = 'select' | 'uploading' | 'starting' | 'done' | 'error';

export default function UploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('');
  const [step, setStep] = useState<UploadStep>('select');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    onDrop: (accepted) => {
      if (accepted.length > 0) {
        setFile(accepted[0]);
        if (!title) {
          setTitle(accepted[0].name.replace(/\.[^.]+$/, ''));
        }
      }
    },
  });

  const handleUpload = async () => {
    if (!file) return;

    try {
      setStep('uploading');
      setError('');

      // 1. Get meeting ID and storage path
      const { meetingId, storagePath } = await createUploadUrl({
        title: title || file.name,
        filename: file.name,
        mime: file.type,
      });

      // 2. Upload file directly via Supabase Storage client
      setProgress(50);
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(storagePath, file, { contentType: file.type, upsert: true });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }
      setProgress(100);

      // 3. Start transcription
      setStep('starting');
      await startTranscription({
        meetingId,
        options: language ? { languageCode: language } : undefined,
      });

      setStep('done');
      setTimeout(() => navigate(`/meeting/${meetingId}`), 1500);
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <div className="upload-page">
      <h1>Upload Recording</h1>

      {step === 'select' && (
        <>
          <div
            {...getRootProps()}
            className={`dropzone ${isDragActive ? 'dropzone-active' : ''} ${file ? 'dropzone-has-file' : ''}`}
          >
            <input {...getInputProps()} />
            {file ? (
              <div className="dropzone-file">
                <FileAudio size={32} />
                <span>{file.name}</span>
                <span className="file-size">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
              </div>
            ) : (
              <div className="dropzone-prompt">
                <Upload size={40} />
                <p>Drag & drop an audio/video file here, or click to browse</p>
                <p className="hint">Supported: MP3, WAV, M4A, MP4, MOV</p>
              </div>
            )}
          </div>

          <div className="upload-fields">
            <label>
              Meeting Title (optional)
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Weekly standup"
              />
            </label>
            <label>
              Language (optional)
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g. en, he, auto"
              />
            </label>
          </div>

          <button
            onClick={handleUpload}
            disabled={!file}
            className="btn btn-primary btn-lg"
          >
            <Upload size={18} /> Upload & Transcribe
          </button>
        </>
      )}

      {step === 'uploading' && (
        <div className="upload-progress">
          <Loader2 className="spin" size={32} />
          <p>Uploading... {progress}%</p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {step === 'starting' && (
        <div className="upload-progress">
          <Loader2 className="spin" size={32} />
          <p>Starting transcription...</p>
        </div>
      )}

      {step === 'done' && (
        <div className="upload-success">
          <CheckCircle size={40} />
          <p>Upload complete! Redirecting to meeting...</p>
        </div>
      )}

      {step === 'error' && (
        <div className="upload-error">
          <p className="error-msg">{error}</p>
          <button onClick={() => setStep('select')} className="btn btn-primary">
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
