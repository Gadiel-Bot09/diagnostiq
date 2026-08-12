import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

// Converts a document number into a synthetic internal email for Supabase Auth
export function syntheticEmail(documentNumber: string): string {
    return `${documentNumber.trim()}@portal.diagnostiq`
}

export async function POST(req: NextRequest) {
    try {
        const { document_number, password } = await req.json()

        if (!document_number || !password) {
            return NextResponse.json({ error: "Número de documento y contraseña son requeridos" }, { status: 400 })
        }

        const docTrimmed = document_number.trim()

        // Step 1: Look up the patient(s) by document number
        const { data: patients, error: patientError } = await supabaseAdmin
            .from("patients")
            .select("id, email, document_number, full_name, lab_id")
            .eq("document_number", docTrimmed)

        if (patientError || !patients || patients.length === 0) {
            return NextResponse.json({ error: "Paciente no encontrado. Consulta con tu laboratorio." }, { status: 404 })
        }

        // Step 2: Figure out what email was actually used to create the Supabase Auth account.
        // The auth account was created with the SYNTHETIC email if the patient had no real email
        // at the time of account creation, OR with the real email if one was provided.
        // We must look up the auth users to find who actually exists.

        // First try the synthetic email (most common path — document_number@portal.diagnostiq)
        const syntheticLoginEmail = syntheticEmail(docTrimmed)

        // Check if a user exists under the synthetic email
        const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
        
        // Find auth user whose email matches the synthetic one
        const syntheticAuthUser = allUsers?.users?.find(u => u.email === syntheticLoginEmail)
        
        if (syntheticAuthUser) {
            // Auth account uses synthetic email — return that so Supabase login works
            return NextResponse.json({ email: syntheticLoginEmail })
        }

        // If no synthetic user, look for a patient with a real email that has an auth account
        for (const patient of patients) {
            if (patient.email) {
                const realAuthUser = allUsers?.users?.find(u => u.email === patient.email)
                if (realAuthUser) {
                    return NextResponse.json({ email: patient.email })
                }
            }
        }

        // If we reach here, no auth account exists yet — patient needs account creation
        return NextResponse.json({ 
            error: "No tienes cuenta de portal activa. Pide al laboratorio que active tu acceso.",
        }, { status: 404 })

    } catch (error: any) {
        console.error("Patient lookup error:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
