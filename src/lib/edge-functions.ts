import { supabase } from './supabase';

export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body, headers });
  if (error) throw error;
  return data as T;
}

// --- Upload ---

interface CreateUploadUrlResponse {
  meetingId: string;
  uploadUrl: string;
  storagePath: string;
}

export async function createUploadUrl(params: {
  title?: string;
  filename: string;
  mime: string;
}): Promise<CreateUploadUrlResponse> {
  return invokeEdgeFunction<CreateUploadUrlResponse>('create_upload_url', params);
}

// --- Transcription ---

interface StartTranscriptionResponse {
  jobId: string;
  provider_job_id: string;
  status: string;
}

export async function startTranscription(params: {
  meetingId: string;
  options?: {
    languageCode?: string;
    diarize?: boolean;
    tagAudioEvents?: boolean;
    modelId?: string;
  };
}): Promise<StartTranscriptionResponse> {
  return invokeEdgeFunction<StartTranscriptionResponse>('start_transcription', params);
}

// --- Summary ---

interface GenerateSummaryResponse {
  summaryId: string;
  version: number;
  content_md: string;
}

export async function generateSummary(params: {
  meetingId: string;
  templateId?: string;
  modelId?: string;
  userInstructions?: string;
  forceNewVersion?: boolean;
}): Promise<GenerateSummaryResponse> {
  return invokeEdgeFunction<GenerateSummaryResponse>('generate_summary', params);
}

// --- Email ---

interface SendEmailResponse {
  status: 'sent' | 'failed';
  emailLogId: string;
}

export async function sendEmail(params: {
  meetingId: string;
  toRecipients: string[];
  ccRecipients?: string[];
  subject: string;
  messagePreface?: string;
  includeTranscript: boolean;
}): Promise<SendEmailResponse> {
  // Get the Google provider token from the current session
  const { data: { session } } = await supabase.auth.getSession();
  const googleToken = session?.provider_token;

  return invokeEdgeFunction<SendEmailResponse>(
    'send_email',
    params,
    googleToken ? { 'x-google-token': googleToken } : undefined,
  );
}
