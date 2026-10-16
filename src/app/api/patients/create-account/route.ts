import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin, findAuthUserByEmail } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"
import { sendWelcomeEmail, sendStaffLinkedAsPatientEmail } from "@/lib/email"

export async function POST(req: NextRequest) {
    try {
        const { patientId, email } = await req.json()

        if (!patientId || !email) {
            return NextResponse.json({ error: "Faltan datos requeridos (patientId, email)" }, { status: 400 })
        }

        // Initialize user client to get the current lab admin
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return req.cookies.getAll() },
                    setAll() { },
                },
            }
        )

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // Get patient info and lab info
        const { data: patient, error: patientError } = await supabaseAdmin
            .from("patients")
            .select("*, labs(name)")
            .eq("id", patientId)
            .single()

        if (patientError || !patient) {
            return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
        }

        // 1. Check if auth user already exists by email
        let authUserId = null
        let isExistingStaff = false
        const existingUser = await findAuthUserByEmail(email)

        if (existingUser) {
            authUserId = existingUser.id

            // Check if existing user is staff, doctor or admin
            const { data: existingProfile } = await supabaseAdmin
                .from("profiles")
                .select("role")
                .eq("id", authUserId)
                .maybeSingle()

            if (existingProfile && existingProfile.role !== "PATIENT") {
                // The user is an existing staff member / doctor / admin:
                // PRESERVE their staff password and their staff role!
                isExistingStaff = true
            } else {
                // Regular patient: set password to document_number
                await supabaseAdmin.auth.admin.updateUserById(authUserId, {
                    password: patient.document_number
                })
            }
        } else {
            // Create new auth user
            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password: patient.document_number,
                email_confirm: true,
                user_metadata: {
                    role: "PATIENT",
                    full_name: patient.full_name,
                    password_changed: false
                }
            })

            if (authError) throw authError
            authUserId = authData.user.id

            // Upsert profile for the patient user (role = PATIENT)
            await supabaseAdmin.from("profiles").upsert({
                id: authUserId,
                role: "PATIENT",
                full_name: patient.full_name,
                is_active: true
            }, { onConflict: "id" })
        }

        // 2. Link auth user to patient via patient_accounts
        const { error: linkError } = await supabaseAdmin.from("patient_accounts").upsert({
            user_id: authUserId,
            patient_id: patientId,
            lab_id: patient.lab_id
        }, { onConflict: "user_id, lab_id" }).select()

        if (linkError) throw linkError

        // 3. Update patient record with the email if missing
        if (!patient.email) {
            await supabaseAdmin.from("patients").update({ email }).eq("id", patientId)
        }

        // 4. Send Welcome Email via Resend
        const labName = (patient.labs as any)?.name || "DiagnostiQ"
        if (isExistingStaff) {
            await sendStaffLinkedAsPatientEmail(email, patient.full_name, labName)
        } else {
            await sendWelcomeEmail(email, patient.full_name, labName)
        }

        return NextResponse.json({
            success: true,
            isExistingStaff,
            message: isExistingStaff
                ? "La cuenta de personal fue vinculada como paciente sin modificar sus credenciales de acceso al sistema."
                : "Cuenta de portal creada exitosamente."
        })

    } catch (error: any) {
        console.error("Create account error:", error)
        return NextResponse.json({ error: error.message || "Error al crear la cuenta" }, { status: 500 })
    }
}

