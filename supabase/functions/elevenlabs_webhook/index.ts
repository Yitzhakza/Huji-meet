import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const url = new URL(req.url);
    const secret = url.searchParams.get('secret');
    const jobId = url.searchParams.get('job_id');

    // Verify webhook secret
    const expectedSecret = Deno.env.get('WEBHOOK_SECRET');
    if (expectedSecret && secret !== expectedSecret) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!jobId) {
      return new Response('Missing job_id', { status: 400 });
    }

    const payload = await req.json();

    // Get the job
    const { data: job } = await supabase
      .from('transcription_jobs')
      .select('*, meetings(*)')
      .eq('id', jobId)
      .single();

    if (!job) {
      return new Response('Job not found', { status: 404 });
    }

    const meetingId = job.meeting_id;

    if (payload.status === 'failed' || payload.error) {
      await supabase.from('transcription_jobs').update({
        status: 'failed',
        error: payload.error || 'Unknown error',
        raw_response: payload,
      }).eq('id', jobId);

      await supabase.from('meetings').update({ status: 'failed' }).eq('id', meetingId);
      return new Response('OK', { status: 200 });
    }

    // Save raw response
    await supabase.from('transcription_jobs').update({
      status: 'completed',
      raw_response: payload,
    }).eq('id', jobId);

    // Parse and normalize segments
    const words = payload.words || [];
    if (words.length > 0) {
      const segments: Array<{
        meeting_id: string;
        speaker_id: string;
        speaker_label: string;
        start_ms: number;
        end_ms: number;
        text: string;
      }> = [];

      let currentSpeaker = words[0].speaker_id ?? 'speaker_0';
      let segmentStart = Math.round((words[0].start ?? 0) * 1000);
      let segmentWords: string[] = [];
      let segmentEnd = segmentStart;

      for (const word of words) {
        const speaker = word.speaker_id ?? 'speaker_0';
        const wordEnd = Math.round((word.end ?? 0) * 1000);
        const wordStart = Math.round((word.start ?? 0) * 1000);

        if (speaker !== currentSpeaker) {
          segments.push({
            meeting_id: meetingId,
            speaker_id: currentSpeaker,
            speaker_label: `Speaker ${currentSpeaker.replace('speaker_', '')}`,
            start_ms: segmentStart,
            end_ms: segmentEnd,
            text: segmentWords.join(' '),
          });
          currentSpeaker = speaker;
          segmentStart = wordStart;
          segmentWords = [];
        }
        segmentWords.push(word.text ?? '');
        segmentEnd = wordEnd;
      }

      if (segmentWords.length > 0) {
        segments.push({
          meeting_id: meetingId,
          speaker_id: currentSpeaker,
          speaker_label: `Speaker ${currentSpeaker.replace('speaker_', '')}`,
          start_ms: segmentStart,
          end_ms: segmentEnd,
          text: segmentWords.join(' '),
        });
      }

      if (segments.length > 0) {
        await supabase.from('transcript_segments').insert(segments);
      }
    }

    // Update meeting
    await supabase.from('meetings').update({
      status: 'ready',
      duration_seconds: payload.duration ? Math.round(payload.duration) : null,
    }).eq('id', meetingId);

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
