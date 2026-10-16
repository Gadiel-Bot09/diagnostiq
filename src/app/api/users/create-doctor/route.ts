import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin, findAuthUserByEmail } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"
import { sendStaffInvitationEmail } from "@/lib/email"

export async function POST(req: NextRequest) {
    try {
        // Auth: only LAB_ADMIN can create doctors
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll() { return req.cookies.getAll() }, setAll() { } } }
        )
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        const { data: adminProfile } = await supabaseAdmin
            .from("profiles")
            .select("role, lab_id, labs(name)")
            .eq("id", user.id)
            .single()

        if (!adminProfile || adminProfile.role !== "LAB_ADMIN") {
            return NextResponse.json({ error: "Solo un administrador puede crear médicos" }, { status: 403 })
        }

        const { full_name, email, password, specialty } = await req.json()

        if (!full_name || !email || !password) {
            return NextResponse.json({ error: "Nombre, email y contraseña son requeridos" }, { status: 400 })
        }

        const labName = (adminProfile.labs as any)?.name || "Laboratorio DiagnostiQ"

        let targetUserId: string
        let wasPatient = false

        // 1. Attempt to create auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { role: "DOCTOR", full_name }
        })

        if (!authError && authData?.user) {
            targetUserId = authData.user.id
        } else {
            const isAlreadyExists = authError?.message?.toLowerCase().includes("already registered")
                || authError?.message?.toLowerCase().includes("already been registered")
                || authError?.message?.toLowerCase().includes("user already exists")
                || (authError as any)?.code === "email_exists"

            if (!isAlreadyExists) {
                throw authError
            }

            const existingUser = await findAuthUserByEmail(email)
            if (!existingUser) {
                return NextResponse.json({
                    error: "Ya existe un usuario con este correo, pero no fue posible recuperar sus datos de autenticación."
                }, { status: 409 })
            }

            targetUserId = existingUser.id

            const { data: existingProfile } = await supabaseAdmin
                .from("profiles")
                .select("id, role, lab_id, full_name, is_active")
                .eq("id", targetUserId)
                .maybeSingle()

            if (existingProfile) {
                if (existingProfile.role === "SUPER_ADMIN" || existingProfile.role === "LAB_ADMIN") {
                    return NextResponse.json({
                        error: "Este correo pertenece a una cuenta administrativa del sistema."
                    }, { status: 400 })
                }

                if (existingProfile.lab_id === adminProfile.lab_id && existingProfile.role === "DOCTOR") {
                    return NextResponse.json({
                        error: "Este correo ya está registrado como médico en tu laboratorio. Puedes editar sus datos desde la lista de empleados."
                    }, { status: 400 })
                }
            }

            // Promote patient to DOCTOR
            wasPatient = true

            await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
                password,
                user_metadata: {
                    ...existingUser.user_metadata,
                    role: "DOCTOR",
                    full_name
                }
            })
        }

        // 2. Upsert profile
        const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
            id: targetUserId,
            full_name,
            role: "DOCTOR",
            lab_id: adminProfile.lab_id,
            is_active: true,
            specialty: specialty || null,
        })
        if (profileError) throw profileError

        // Also upsert in staff_profiles if table is used for specialty
        try {
            await supabaseAdmin.from("staff_profiles").upsert({
                id: targetUserId,
                specialty: specialty || null,
            }, { onConflict: "id" })
        } catch (_) {
            // Optional table, ignore if not present
        }

        // 3. Send invitation email
        await sendStaffInvitationEmail({
            toEmail: email,
            fullName: full_name,
            labName,
            roleTitle: `Médico ${specialty ? `(${specialty})` : ""}`.trim(),
            temporaryPassword: password,
            wasPatient
        })

        return NextResponse.json({
            success: true,
            user_id: targetUserId,
            wasPatient,
            message: wasPatient
                ? "El usuario ya existía como paciente. Ha sido configurado como médico del laboratorio exitosamente sin alterar su historial médico."
                : "Médico creado exitosamente."
        })

    } catch (error: any) {
        console.error("Create doctor error:", error)
        return NextResponse.json({ error: error.message || "Error al crear médico" }, { status: 500 })
    }
}

