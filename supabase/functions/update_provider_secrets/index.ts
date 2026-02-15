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

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { elevenlabs_api_key, openrouter_api_key } = await req.json();

    // In a production setup, these would be stored as Supabase Edge Function secrets
    // via the Supabase CLI: supabase secrets set ELEVENLABS_API_KEY=...
    // For now, this endpoint documents the intent. The actual secret management
    // should be done via Supabase Dashboard or CLI.
    //
    // This function can be used to verify the keys are valid by making test calls.

    const results: Record<string, string> = {};

    if (elevenlabs_api_key) {
      // Test the ElevenLabs key
      const testResponse = await fetch('https://api.elevenlabs.io/v1/models', {
        headers: { 'xi-api-key': elevenlabs_api_key },
      });
      results.elevenlabs = testResponse.ok ? 'valid' : 'invalid';
    }

    if (openrouter_api_key) {
      // Test the OpenRouter key
      const testResponse = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${openrouter_api_key}` },
      });
      results.openrouter = testResponse.ok ? 'valid' : 'invalid';
    }

    return new Response(
      JSON.stringify({
        message: 'API keys validated. Set them as Edge Function secrets via Supabase CLI or Dashboard.',
        hint: 'Run: supabase secrets set ELEVENLABS_API_KEY=<key> OPENROUTER_API_KEY=<key>',
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
