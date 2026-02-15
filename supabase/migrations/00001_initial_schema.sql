-- ============================================
-- Huji Meet - Full Database Schema
-- ============================================

-- gen_random_uuid() is available by default in Supabase (pgcrypto)

-- ============================================
-- Tables
-- ============================================

-- profiles (auto-created on auth signup)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- meetings
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  source_filename text not null,
  media_path text not null,
  media_mime text not null,
  duration_seconds int,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- transcription_jobs
create table public.transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  provider text not null default 'elevenlabs',
  provider_job_id text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  error text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- transcript_segments
create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  speaker_id text not null,
  speaker_label text not null,
  start_ms int not null,
  end_ms int not null,
  text text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- summary_templates
create table public.summary_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  system_prompt text not null,
  user_prompt text not null,
  output_format text not null default 'markdown',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- summaries
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  version int not null,
  template_id uuid references public.summary_templates(id) on delete set null,
  model_id text not null default '',
  content_md text not null,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

-- app_settings (singleton row)
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  elevenlabs_default_model_id text,
  elevenlabs_diarize_default boolean not null default true,
  elevenlabs_tag_audio_events_default boolean not null default false,
  openrouter_default_model text,
  openrouter_temperature numeric not null default 0.2,
  openrouter_max_tokens int not null default 1200,
  gmail_sending_enabled boolean not null default true,
  max_upload_mb int not null default 200,
  retention_days int
);

-- Insert singleton settings row
insert into public.app_settings (id) values (1);

-- email_logs
create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sent_by uuid not null references public.profiles(id) on delete cascade,
  to_recipients text[] not null,
  cc_recipients text[],
  subject text not null,
  include_transcript boolean not null default false,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- ============================================
-- Indexes
-- ============================================

create index idx_meetings_owner on public.meetings(owner_id);
create index idx_meetings_status on public.meetings(status);
create index idx_transcript_segments_meeting on public.transcript_segments(meeting_id);
create index idx_transcript_segments_meeting_start on public.transcript_segments(meeting_id, start_ms);
create index idx_transcription_jobs_meeting on public.transcription_jobs(meeting_id);
create index idx_transcription_jobs_provider on public.transcription_jobs(provider_job_id);
create index idx_summaries_meeting on public.summaries(meeting_id);
create index idx_email_logs_meeting on public.email_logs(meeting_id);

-- ============================================
-- RLS Policies
-- ============================================

alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.transcription_jobs enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.summaries enable row level security;
alter table public.summary_templates enable row level security;
alter table public.app_settings enable row level security;
alter table public.email_logs enable row level security;

-- profiles: users can read/update their own
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- meetings: owner-only CRUD
create policy "meetings_select_own" on public.meetings
  for select using (owner_id = auth.uid());
create policy "meetings_insert_own" on public.meetings
  for insert with check (owner_id = auth.uid());
create policy "meetings_update_own" on public.meetings
  for update using (owner_id = auth.uid());
create policy "meetings_delete_own" on public.meetings
  for delete using (owner_id = auth.uid());

-- transcription_jobs: accessible if meeting belongs to user
create policy "jobs_select_own" on public.transcription_jobs
  for select using (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );
create policy "jobs_insert_own" on public.transcription_jobs
  for insert with check (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );
create policy "jobs_update_own" on public.transcription_jobs
  for update using (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );

-- transcript_segments: accessible if meeting belongs to user
create policy "segments_select_own" on public.transcript_segments
  for select using (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );
create policy "segments_insert_own" on public.transcript_segments
  for insert with check (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );
create policy "segments_update_own" on public.transcript_segments
  for update using (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );

-- summaries: accessible if meeting belongs to user
create policy "summaries_select_own" on public.summaries
  for select using (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );
create policy "summaries_insert_own" on public.summaries
  for insert with check (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );

-- summary_templates: everyone can read, admins can write
create policy "templates_select_all" on public.summary_templates
  for select using (true);
create policy "templates_insert_admin" on public.summary_templates
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
create policy "templates_update_admin" on public.summary_templates
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
create policy "templates_delete_admin" on public.summary_templates
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- app_settings: everyone can read, admins can write
create policy "settings_select_all" on public.app_settings
  for select using (true);
create policy "settings_update_admin" on public.app_settings
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- email_logs: accessible if meeting belongs to user
create policy "email_logs_select_own" on public.email_logs
  for select using (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );
create policy "email_logs_insert_own" on public.email_logs
  for insert with check (
    exists (select 1 from public.meetings where meetings.id = meeting_id and meetings.owner_id = auth.uid())
  );

-- ============================================
-- Storage bucket
-- ============================================

insert into storage.buckets (id, name, public)
  values ('media', 'media', false);

-- Storage policies: users can manage their own folder
create policy "media_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "media_select_own" on storage.objects
  for select using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "media_delete_own" on storage.objects
  for delete using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================
-- Auto-create profile on signup
-- ============================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- Default summary template
-- ============================================

insert into public.summary_templates (name, system_prompt, user_prompt, output_format, is_default)
values (
  'Meeting Notes',
  'You are an assistant that writes concise, structured meeting notes. Use the transcript as the sole source of truth. If something is unclear, note it as unclear. Do not invent facts.',
  E'Create meeting notes in Markdown with these sections:\n\n1. Title\n2. Participants (infer from speakers; list as Speaker Label)\n3. Topics discussed (bullets)\n4. Decisions (bullets)\n5. Action items (bullets with owner if mentioned)\n6. Open questions / Risks\n7. Next steps\n8. 5-bullet executive recap\n\nTranscript:\n{{TRANSCRIPT}}\n\nOptional user instructions:\n{{INSTRUCTIONS}}',
  'markdown',
  true
);

-- ============================================
-- Updated_at trigger
-- ============================================

create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_meetings_updated_at
  before update on public.meetings
  for each row execute function public.update_updated_at();

create trigger set_jobs_updated_at
  before update on public.transcription_jobs
  for each row execute function public.update_updated_at();
