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

        // Step 1: Find all patients with this document number (may belong to multiple labs)
        const { data: patients, error: patientError } = await supabaseAdmin
            .from("patients")
            .select("id, email, document_number, full_name, lab_id")
            .eq("document_number", docTrimmed)

        if (patientError || !patients || patients.length === 0) {
            return NextResponse.json({ error: "Paciente no encontrado. Consulta con tu laboratorio." }, { status: 404 })
        }

        const patientIds = patients.map(p => p.id)

        // Step 2: Look up patient_accounts to find the linked auth user_id
        // This is the single source of truth — it was written at account creation time
        const { data: accounts, error: accountsError } = await supabaseAdmin
            .from("patient_accounts")
            .select("user_id, patient_id, lab_id")
            .in("patient_id", patientIds)
            .limit(1)

        if (accountsError || !accounts || accounts.length === 0) {
            // No account found — auto-create one now using synthetic email
            // This handles patients that were created but whose portal account was not created yet
            const patient = patients[0]
            const loginEmail = patient.email || syntheticEmail(docTrimmed)

            // Try to create the auth user
            try {
                const { data: existingUserList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
                const existingUser = existingUserList?.users?.find(u => u.email === loginEmail)

                if (existingUser) {
                    // Auth user exists but patient_accounts was missing — recreate the link
                    await supabaseAdmin.from("patient_accounts").upsert({
                        user_id: existingUser.id,
                        patient_id: patient.id,
                        lab_id: patient.lab_id,
                    }, { onConflict: "user_id, lab_id" })

                    return NextResponse.json({ email: loginEmail })
                }
            } catch (_) { /* continue */ }

            return NextResponse.json({
                error: "No tienes cuenta de portal activa. Pide al laboratorio que active tu acceso.",
            }, { status: 404 })
        }

        const { user_id } = accounts[0]

        // Step 3: Get the exact email of the auth user by their user_id
        const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(user_id)

        if (authUserError || !authUser?.user) {
            return NextResponse.json({
                error: "Error al obtener la cuenta de acceso. Contacta al laboratorio.",
            }, { status: 500 })
        }

        const loginEmail = authUser.user.email!

        return NextResponse.json({ email: loginEmail })

    } catch (error: any) {
        console.error("Patient lookup error:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
