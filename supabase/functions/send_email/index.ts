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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { meetingId, toRecipients, ccRecipients, subject, messagePreface, includeTranscript } = await req.json();

    // Verify meeting belongs to user
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_id', user.id)
      .single();

    if (!meeting) {
      return new Response(JSON.stringify({ error: 'Meeting not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get latest summary
    const { data: summary } = await supabase
      .from('summaries')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (!summary) {
      return new Response(JSON.stringify({ error: 'No summary found for this meeting' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build email body as HTML
    let body = '';
    if (messagePreface) {
      body += `<p>${messagePreface.replace(/\n/g, '<br>')}</p><hr>`;
    }
    body += `<div>${summary.content_md.replace(/\n/g, '<br>')}</div>`;

    if (includeTranscript) {
      const { data: segments } = await supabase
        .from('transcript_segments')
        .select('*')
        .eq('meeting_id', meetingId)
        .order('start_ms', { ascending: true });

      if (segments && segments.length > 0) {
        const formatTime = (ms: number) => {
          const totalSec = Math.floor(ms / 1000);
          const m = Math.floor(totalSec / 60);
          const s = totalSec % 60;
          return `${m}:${String(s).padStart(2, '0')}`;
        };

        const transcriptHtml = segments
          .map((s: any) => `<b>[${formatTime(s.start_ms)}] ${s.speaker_label}:</b> ${s.text}`)
          .join('<br>');

        body += `<hr><h3>Full Transcript</h3><div style="font-size:14px">${transcriptHtml}</div>`;
      }
    }

    // Send via Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Huji Meet <onboarding@resend.dev>',
        to: toRecipients,
        cc: ccRecipients?.length ? ccRecipients : undefined,
        subject,
        html: body,
        reply_to: user.email,
      }),
    });

    const emailLogId = crypto.randomUUID();

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      await supabase.from('email_logs').insert({
        id: emailLogId,
        meeting_id: meetingId,
        sent_by: user.id,
        to_recipients: toRecipients,
        cc_recipients: ccRecipients || null,
        subject,
        include_transcript: includeTranscript ?? false,
        status: 'failed',
        error: errorText,
      });

      return new Response(JSON.stringify({ status: 'failed', emailLogId, error: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('email_logs').insert({
      id: emailLogId,
      meeting_id: meetingId,
      sent_by: user.id,
      to_recipients: toRecipients,
      cc_recipients: ccRecipients || null,
      subject,
      include_transcript: includeTranscript ?? false,
      status: 'sent',
    });

    return new Response(
      JSON.stringify({ status: 'sent', emailLogId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
