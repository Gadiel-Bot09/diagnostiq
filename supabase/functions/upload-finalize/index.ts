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
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // High privilege to update orders/results
        )

        const payload = await req.json()
        const {
            order_id,
            patient_id,
            lab_id,
            storage_path,
            file_name,
            size_bytes,
            sha256,
            version
        } = payload

        // 1. Get patient details to check for document number and existing account
        const { data: patient, error: patientError } = await supabaseAdmin
            .from('patients')
            .select('document_number, email, lab_id, full_name')
            .eq('id', patient_id)
            .single()

        if (patientError || !patient) throw new Error('Patient not found')

        // 2. Check if patient already has an account
        const { data: existingAccount } = await supabaseAdmin
            .from('patient_accounts')
            .select('id')
            .eq('patient_id', patient_id)
            .eq('lab_id', lab_id)
            .single()

        if (!existingAccount) {
            // Auto-create auth user
            const defaultEmail = patient.email || `${patient.document_number}@diagnostiq.local`
            const password = patient.document_number

            const { data: newUser, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
                email: defaultEmail,
                password: password,
                email_confirm: true,
                user_metadata: { role: 'PATIENT' }
            })

            if (signUpError && signUpError.message !== 'User already registered') {
                throw signUpError
            }

            const userId = newUser.user?.id || (await supabaseAdmin.auth.admin.listUsers()).data.users.find(u => u.email === defaultEmail)?.id

            if (userId) {
                // Link patient to auth user
                await supabaseAdmin.from('patient_accounts').insert({
                    user_id: userId,
                    patient_id,
                    lab_id
                })

                // Ensure profile exists for search/RLS helpers
                await supabaseAdmin.from('profiles').upsert({
                    id: userId,
                    role: 'PATIENT' as any,
                    lab_id: null,
                    full_name: patient.full_name
                })
            }
        }

        // 3. Insert file metadata
        const { data: fileData, error: fileError } = await supabaseAdmin
            .from('result_files')
            .insert({
                lab_id,
                patient_id,
                order_id,
                storage_path,
                file_name,
                size_bytes,
                sha256,
                version,
                uploaded_by: (await supabaseAdmin.auth.getUser(req.headers.get('Authorization')?.split('Bearer ')[1] ?? '')).data.user?.id
            })
            .select()
            .single()

        if (fileError) throw fileError

        // 2. Update order status to COMPLETED
        const { error: orderError } = await supabaseAdmin
            .from('orders')
            .update({ status: 'COMPLETED' })
            .eq('id', order_id)

        if (orderError) throw orderError

        // 3. Register Audit Event
        const authHeader = req.headers.get('Authorization')!
        const token = authHeader.replace('Bearer ', '')
        const { data: { user } } = await supabaseAdmin.auth.getUser(token)

        await supabaseAdmin.from('audit_events').insert({
            lab_id,
            actor_user_id: user?.id,
            action: 'UPLOAD',
            entity_type: 'RESULT_FILE',
            entity_id: fileData.id,
            metadata_json: {
                order_id,
                version,
                file_name
            }
        })

        // 4. (Optional) Trigger notification function here or via Supabase Hook
        // await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, { ... })

        return new Response(JSON.stringify({ success: true, file: fileData }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
