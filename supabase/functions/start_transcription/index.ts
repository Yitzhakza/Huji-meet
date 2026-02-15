import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { meetingId, options } = await req.json();

    // Verify meeting belongs to user
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_id', user.id)
      .single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: 'Meeting not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get settings
    const { data: settings } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .single();

    const elevenlabsKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!elevenlabsKey) {
      return new Response(JSON.stringify({ error: 'ElevenLabs API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update meeting status
    await supabase
      .from('meetings')
      .update({ status: 'transcribing' })
      .eq('id', meetingId);

    // Create job record
    const jobId = crypto.randomUUID();
    await supabase.from('transcription_jobs').insert({
      id: jobId,
      meeting_id: meetingId,
      provider: 'elevenlabs',
      status: 'running',
    });

    // Get signed URL for the media file (long expiry for ElevenLabs to download)
    const { data: signedUrlData } = await supabase.storage
      .from('media')
      .createSignedUrl(meeting.media_path, 7200);

    if (!signedUrlData?.signedUrl) {
      await supabase.from('transcription_jobs').update({ status: 'failed', error: 'Could not create signed URL' }).eq('id', jobId);
      await supabase.from('meetings').update({ status: 'failed' }).eq('id', meetingId);
      throw new Error('Could not create signed URL for media file');
    }

    // Call ElevenLabs STT API using source_url with FormData
    const diarize = options?.diarize ?? settings?.elevenlabs_diarize_default ?? true;
    const tagAudioEvents = options?.tagAudioEvents ?? settings?.elevenlabs_tag_audio_events_default ?? false;
    const modelId = options?.modelId || settings?.elevenlabs_default_model_id || 'scribe_v2';

    const formData = new FormData();
    formData.append('cloud_storage_url', signedUrlData.signedUrl);
    formData.append('model_id', modelId);
    formData.append('diarize', String(diarize));
    formData.append('tag_audio_events', String(tagAudioEvents));
    if (options?.languageCode) {
      formData.append('language_code', options.languageCode);
    }

    console.log('Calling ElevenLabs STT with source_url, model:', modelId);

    const elevenLabsResponse = await fetch(
      'https://api.elevenlabs.io/v1/speech-to-text',
      {
        method: 'POST',
        headers: {
          'xi-api-key': elevenlabsKey,
        },
        body: formData,
      },
    );

    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      console.error('ElevenLabs error:', elevenLabsResponse.status, errorText);
      await supabase.from('transcription_jobs').update({
        status: 'failed',
        error: `${elevenLabsResponse.status}: ${errorText}`,
      }).eq('id', jobId);
      await supabase.from('meetings').update({ status: 'failed' }).eq('id', meetingId);

      return new Response(JSON.stringify({ error: `ElevenLabs API error: ${errorText}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await elevenLabsResponse.json();
    console.log('ElevenLabs response received, processing segments...');

    // Save raw response
    await supabase.from('transcription_jobs').update({
      status: 'completed',
      raw_response: result,
      provider_job_id: jobId,
    }).eq('id', jobId);

    // Normalize and save transcript segments
    const words = result.words || [];
    if (words.length > 0 && diarize) {
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
        const wordStart = Math.round((word.start ?? 0) * 1000);
        const wordEnd = Math.round((word.end ?? 0) * 1000);

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
    } else if (result.text) {
      await supabase.from('transcript_segments').insert({
        meeting_id: meetingId,
        speaker_id: 'speaker_0',
        speaker_label: 'Speaker 0',
        start_ms: 0,
        end_ms: Math.round((result.duration ?? 0) * 1000),
        text: result.text,
      });
    }

    // Update meeting status
    await supabase.from('meetings').update({
      status: 'ready',
      duration_seconds: result.duration ? Math.round(result.duration) : null,
    }).eq('id', meetingId);

    console.log('Transcription complete, meeting status set to ready');

    return new Response(
      JSON.stringify({ jobId, provider_job_id: jobId, status: 'completed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
