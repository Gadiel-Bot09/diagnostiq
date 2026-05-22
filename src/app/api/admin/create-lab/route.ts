import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

// This API Route uses the SERVICE ROLE key (server-side only)
// to create auth users bypassing email confirmation.
export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { lab_name, tax_id, lab_email, lab_phone, lab_address, plan, admin_name, admin_email, admin_password } = body

        // Validate required fields
        if (!lab_name || !tax_id || !lab_email || !admin_name || !admin_email || !admin_password) {
            return NextResponse.json({ error: "Faltan campos requeridos." }, { status: 400 })
        }

        // Create admin Supabase client with SERVICE ROLE
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // 1. Create the Lab record
        const { data: lab, error: labError } = await supabaseAdmin
            .from("labs")
            .insert({
                name: lab_name,
                tax_id,
                email: lab_email,
                phone: lab_phone || null,
                address: lab_address || null,
                plan: plan || "FREE",
                status: "ACTIVE",
            })
            .select()
            .single()

        if (labError) {
            if (labError.code === "23505") {
                return NextResponse.json({ error: "Ya existe un laboratorio con ese NIT." }, { status: 409 })
            }
            return NextResponse.json({ error: `Error creando el laboratorio: ${labError.message}` }, { status: 500 })
        }

        // 2. Create the Admin User in Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: admin_email,
            password: admin_password,
            email_confirm: true, // skip email confirmation
            user_metadata: {
                full_name: admin_name,
                lab_id: lab.id,
                role: "LAB_ADMIN",
            },
        })

        if (authError) {
            // Rollback: delete the lab we just created
            await supabaseAdmin.from("labs").delete().eq("id", lab.id)

            if (authError.message.includes("already registered")) {
                return NextResponse.json({ error: "Ya existe un usuario con ese correo." }, { status: 409 })
            }
            return NextResponse.json({ error: `Error creando el usuario admin: ${authError.message}` }, { status: 500 })
        }

        const userId = authData.user.id

        // 3. Upsert the Profile — the on_auth_user_created trigger may have already
        //    inserted a bare profile row. We UPSERT to set lab_id, role, and full_name.
        const { error: profileError } = await supabaseAdmin
            .from("profiles")
            .upsert({
                id: userId,
                role: "LAB_ADMIN",
                lab_id: lab.id,
                full_name: admin_name,
                is_active: true,
            }, { onConflict: "id" })

        if (profileError) {
            // Rollback both
            await supabaseAdmin.auth.admin.deleteUser(userId)
            await supabaseAdmin.from("labs").delete().eq("id", lab.id)
            return NextResponse.json({ error: `Error actualizando el perfil: ${profileError.message}` }, { status: 500 })
        }

        // 4. Create a default "Administrador" custom role with ALL permissions for this lab
        const { data: customRole, error: roleError } = await supabaseAdmin
            .from("custom_roles")
            .insert({
                lab_id: lab.id,
                name: "Administrador",
                description: "Rol predeterminado con acceso completo",
                is_default: true,
            })
            .select()
            .single()

        if (!roleError && customRole) {
            // Add all permissions to the default admin role
            const modules = ["orders", "patients", "results", "reports", "staff", "settings", "audit"]
            const actions = ["view", "create", "edit", "delete", "upload", "export", "invite"]
            const permissions = modules.flatMap(m => actions.map(a => ({ role_id: customRole.id, module: m, action: a })))

            await supabaseAdmin.from("role_permissions").insert(permissions)
        }

        return NextResponse.json({
            success: true,
            lab: { id: lab.id, name: lab.name },
            admin: { id: userId, email: admin_email },
        })

    } catch (error: any) {
        console.error("[CREATE_LAB_ERROR]", error)
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 })
    }
}
