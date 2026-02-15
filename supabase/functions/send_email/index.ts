import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';

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

    // Check if Gmail sending is enabled
    const { data: settings } = await supabase
      .from('app_settings')
      .select('gmail_sending_enabled')
      .eq('id', 1)
      .single();

    if (!settings?.gmail_sending_enabled) {
      return new Response(JSON.stringify({ error: 'Email sending is disabled' }), {
        status: 403,
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

    // Build email body
    let body = '';
    if (messagePreface) {
      body += messagePreface + '\n\n---\n\n';
    }
    body += summary.content_md;

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

        const transcriptText = segments
          .map((s: any) => `[${formatTime(s.start_ms)}] ${s.speaker_label}: ${s.text}`)
          .join('\n');

        body += '\n\n---\n\nFull Transcript:\n\n' + transcriptText;
      }
    }

    // Get the user's Google provider token for Gmail API
    // We need to get it from the user's session
    const { data: sessionData } = await supabase.auth.admin.getUserById(user.id);

    // The provider token should be passed from the client or stored
    // For now, we'll use the session's provider_token
    // The client must pass the provider_token
    const providerToken = req.headers.get('x-google-token');

    if (!providerToken) {
      // Try to get from identities
      return new Response(JSON.stringify({ error: 'Google access token required. Please re-authenticate.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Compose MIME email
    const toHeader = toRecipients.join(', ');
    const ccHeader = ccRecipients?.length ? ccRecipients.join(', ') : '';

    let rawEmail = `From: ${user.email}\r\n`;
    rawEmail += `To: ${toHeader}\r\n`;
    if (ccHeader) {
      rawEmail += `Cc: ${ccHeader}\r\n`;
    }
    rawEmail += `Subject: ${subject}\r\n`;
    rawEmail += `Content-Type: text/plain; charset=UTF-8\r\n`;
    rawEmail += `\r\n`;
    rawEmail += body;

    const encodedMessage = base64Encode(new TextEncoder().encode(rawEmail));

    // Send via Gmail API
    const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    const emailLogId = crypto.randomUUID();

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
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
