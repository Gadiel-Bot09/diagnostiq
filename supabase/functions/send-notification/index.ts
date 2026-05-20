import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { email, patientName, orderNumber, labName } = await req.json()

        if (!email || !patientName || !orderNumber) {
            throw new Error('Missing required fields')
        }

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
                from: 'DiagnostiQ <notifications@diagnostiq.health>',
                to: [email],
                subject: `Resultados Listos - Orden #${orderNumber}`,
                html: `
          <h1>Hola ${patientName},</h1>
          <p>Tus resultados médicos de la orden <strong>#${orderNumber}</strong> en <strong>${labName || 'DiagnostiQ'}</strong> ya están disponibles en el portal.</p>
          <p>Puedes acceder a ellos iniciando sesión con tu correo electrónico.</p>
          <br />
          <a href="${Deno.env.get('APP_URL')}/portal/login" style="background-color: #0070f3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Ir al Portal de Pacientes</a>
          <p>Si no esperabas este correo, por favor contáctanos.</p>
        `,
            }),
        })

        const data = await res.json()

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
