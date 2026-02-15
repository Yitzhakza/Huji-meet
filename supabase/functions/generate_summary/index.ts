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
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { meetingId, templateId, modelId, userInstructions, forceNewVersion } = await req.json();

    // Verify meeting belongs to user and is ready
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_id', user.id)
      .eq('status', 'ready')
      .single();

    if (!meeting) {
      return new Response(JSON.stringify({ error: 'Meeting not found or not ready' }), {
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

    // Get template
    let template;
    if (templateId) {
      const { data } = await supabase
        .from('summary_templates')
        .select('*')
        .eq('id', templateId)
        .single();
      template = data;
    } else {
      const { data } = await supabase
        .from('summary_templates')
        .select('*')
        .eq('is_default', true)
        .single();
      template = data;
    }

    if (!template) {
      return new Response(JSON.stringify({ error: 'No summary template found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get transcript segments
    const { data: segments } = await supabase
      .from('transcript_segments')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('start_ms', { ascending: true });

    if (!segments || segments.length === 0) {
      return new Response(JSON.stringify({ error: 'No transcript segments found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build transcript text
    const formatTime = (ms: number) => {
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    };

    const transcriptText = segments
      .map((s: any) => `[${formatTime(s.start_ms)}] ${s.speaker_label}: ${s.text}`)
      .join('\n');

    // Prepare prompts
    const systemPrompt = template.system_prompt;
    const userPrompt = template.user_prompt
      .replace('{{TRANSCRIPT}}', transcriptText)
      .replace('{{INSTRUCTIONS}}', userInstructions || 'None');

    // Call OpenRouter
    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openrouterKey) {
      return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const model = modelId || settings?.openrouter_default_model || 'anthropic/claude-sonnet-4-5-20250929';
    const temperature = settings?.openrouter_temperature ?? 0.2;
    const maxTokens = settings?.openrouter_max_tokens ?? 1200;

    const openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('SUPABASE_URL') || '',
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!openrouterResponse.ok) {
      const errorText = await openrouterResponse.text();
      return new Response(JSON.stringify({ error: `OpenRouter error: ${errorText}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const llmResult = await openrouterResponse.json();
    const contentMd = llmResult.choices?.[0]?.message?.content || '';

    // Determine version number
    const { data: existingSummaries } = await supabase
      .from('summaries')
      .select('version')
      .eq('meeting_id', meetingId)
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = (existingSummaries?.[0]?.version ?? 0) + 1;

    // Insert summary
    const summaryId = crypto.randomUUID();
    await supabase.from('summaries').insert({
      id: summaryId,
      meeting_id: meetingId,
      version: nextVersion,
      template_id: template.id,
      model_id: model,
      content_md: contentMd,
      raw_response: llmResult,
    });

    return new Response(
      JSON.stringify({ summaryId, version: nextVersion, content_md: contentMd }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
