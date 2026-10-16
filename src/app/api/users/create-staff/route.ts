import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin, findAuthUserByEmail } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"
import { sendStaffInvitationEmail } from "@/lib/email"

export async function POST(req: NextRequest) {
    try {
        // Auth: only LAB_ADMIN can create staff
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
            return NextResponse.json({ error: "Solo un administrador puede invitar personal" }, { status: 403 })
        }

        const { full_name, email, password, custom_role_id } = await req.json()

        if (!full_name || !email || !password) {
            return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 })
        }

        const labName = (adminProfile.labs as any)?.name || "Laboratorio DiagnostiQ"

        // Find custom role name if provided
        let customRoleName = "Personal de Laboratorio"
        if (custom_role_id) {
            const { data: customRole } = await supabaseAdmin
                .from("custom_roles")
                .select("id, name")
                .eq("id", custom_role_id)
                .eq("lab_id", adminProfile.lab_id)
                .single()
            if (customRole) {
                customRoleName = customRole.name
            }
        }

        let targetUserId: string
        let wasPatient = false

        // 1. Attempt to create new auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { role: "LAB_STAFF", full_name }
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

            // Look up existing auth user
            const existingUser = await findAuthUserByEmail(email)
            if (!existingUser) {
                return NextResponse.json({
                    error: "Ya existe un usuario con este correo, pero no fue posible recuperar sus datos de autenticación."
                }, { status: 409 })
            }

            targetUserId = existingUser.id

            // Check existing profile in profiles table
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

                if (existingProfile.lab_id === adminProfile.lab_id && existingProfile.role === "LAB_STAFF") {
                    return NextResponse.json({
                        error: "Este correo ya está registrado como personal en tu laboratorio. Puedes modificar sus permisos o asignación de rol desde la lista de empleados."
                    }, { status: 400 })
                }

                if (existingProfile.role === "LAB_STAFF" && existingProfile.lab_id !== adminProfile.lab_id) {
                    return NextResponse.json({
                        error: "Este correo ya está registrado como personal en otro laboratorio. Por seguridad, ingresa un correo diferente para este laboratorio."
                    }, { status: 400 })
                }
            }

            // The user exists as PATIENT (or without active staff profile in this lab)
            // Enable and promote to LAB_STAFF
            wasPatient = true

            // Update auth user password and metadata
            await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
                password,
                user_metadata: {
                    ...existingUser.user_metadata,
                    role: "LAB_STAFF",
                    full_name
                }
            })
        }

        // 2. Upsert profile for the staff member in this lab
        const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
            id: targetUserId,
            full_name,
            role: "LAB_STAFF",
            lab_id: adminProfile.lab_id,
            is_active: true,
        })
        if (profileError) throw profileError

        // 3. Assign Custom Role if provided
        if (custom_role_id) {
            await supabaseAdmin.from("staff_role_assignments").upsert({
                profile_id: targetUserId,
                lab_id: adminProfile.lab_id,
                custom_role_id: custom_role_id,
                assigned_by: user.id
            }, { onConflict: "profile_id, lab_id" })
        }

        // 4. Send Invitation Email via Resend
        await sendStaffInvitationEmail({
            toEmail: email,
            fullName: full_name,
            labName,
            roleTitle: customRoleName,
            temporaryPassword: password,
            wasPatient
        })

        return NextResponse.json({
            success: true,
            user_id: targetUserId,
            wasPatient,
            message: wasPatient
                ? "El usuario ya existía como paciente. Se ha habilitado exitosamente como personal del laboratorio sin alterar su historial médico anterior."
                : "Personal invitado exitosamente."
        })

    } catch (error: any) {
        console.error("Create staff error:", error)
        return NextResponse.json({ error: error.message || "Error al invitar al personal" }, { status: 500 })
    }
}

