export interface Profile {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  created_at: string;
}

export type MeetingStatus = 'uploaded' | 'transcribing' | 'ready' | 'failed';

export interface Meeting {
  id: string;
  owner_id: string;
  title: string;
  source_filename: string;
  media_path: string;
  media_mime: string;
  duration_seconds: number | null;
  status: MeetingStatus;
  created_at: string;
  updated_at: string;
}

export type TranscriptionJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TranscriptionJob {
  id: string;
  meeting_id: string;
  provider: string;
  provider_job_id: string;
  status: TranscriptionJobStatus;
  error: string | null;
  raw_response: unknown;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegment {
  id: string;
  meeting_id: string;
  speaker_id: string;
  speaker_label: string;
  start_ms: number;
  end_ms: number;
  text: string;
  meta: unknown;
  created_at: string;
}

export interface Summary {
  id: string;
  meeting_id: string;
  version: number;
  template_id: string | null;
  model_id: string;
  content_md: string;
  raw_response: unknown;
  created_at: string;
}

export interface SummaryTemplate {
  id: string;
  name: string;
  system_prompt: string;
  user_prompt: string;
  output_format: string;
  is_default: boolean;
  created_at: string;
}

export interface AppSettings {
  id: number;
  elevenlabs_default_model_id: string | null;
  elevenlabs_diarize_default: boolean;
  elevenlabs_tag_audio_events_default: boolean;
  openrouter_default_model: string | null;
  openrouter_temperature: number;
  openrouter_max_tokens: number;
  gmail_sending_enabled: boolean;
  max_upload_mb: number;
  retention_days: number | null;
}

export interface EmailLog {
  id: string;
  meeting_id: string;
  sent_by: string;
  to_recipients: string[];
  cc_recipients: string[] | null;
  subject: string;
  include_transcript: boolean;
  status: 'sent' | 'failed';
  error: string | null;
  created_at: string;
}
