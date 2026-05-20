import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { result_file_id } = await req.json()

    if (!result_file_id) {
      throw new Error('result_file_id is required')
    }

    // 1. Get file metadata and validate access (RLS will handle access control)
    const { data: fileData, error: fileError } = await supabaseClient
      .from('result_files')
      .select('storage_path, lab_id, patient_id')
      .eq('id', result_file_id)
      .single()

    if (fileError || !fileData) {
      return new Response(JSON.stringify({ error: 'File not found or access denied' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    // 2. Generate signed URL from private storage bucket
    const { data: signedUrlData, error: signedUrlError } = await supabaseClient
      .storage
      .from('diagnostiq-results')
      .createSignedUrl(fileData.storage_path, 300) // 5 minutes validity

    if (signedUrlError) {
      throw signedUrlError
    }

    // 3. Register audit event (optional: could also use a trigger on a new audit table)
    const { data: { user } } = await supabaseClient.auth.getUser()
    await supabaseClient.from('audit_events').insert({
      lab_id: fileData.lab_id,
      actor_user_id: user?.id,
      action: 'DOWNLOAD',
      entity_type: 'RESULT_FILE',
      entity_id: result_file_id,
      metadata_json: { storage_path: fileData.storage_path }
    })

    return new Response(
      JSON.stringify({ signedUrl: signedUrlData.signedUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
