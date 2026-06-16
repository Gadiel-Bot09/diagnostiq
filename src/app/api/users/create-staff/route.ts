import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

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
            .select("role, lab_id")
            .eq("id", user.id)
            .single()

        if (!adminProfile || adminProfile.role !== "LAB_ADMIN") {
            return NextResponse.json({ error: "Solo un administrador puede invitar personal" }, { status: 403 })
        }

        const { full_name, email, password, custom_role_id } = await req.json()

        if (!full_name || !email || !password) {
            return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 })
        }

        // Create auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { role: "LAB_STAFF", full_name }
        })
        if (authError) throw authError

        const newUserId = authData.user.id

        // Create profile
        const { error: profileError } = await supabaseAdmin.from("profiles").insert({
            id: newUserId,
            full_name,
            role: "LAB_STAFF",
            lab_id: adminProfile.lab_id,
            is_active: true,
        })
        if (profileError) throw profileError

        // Assign Custom Role if provided
        if (custom_role_id) {
            // Validate the custom role belongs to the same lab
            const { data: customRole } = await supabaseAdmin
                .from("custom_roles")
                .select("id")
                .eq("id", custom_role_id)
                .eq("lab_id", adminProfile.lab_id)
                .single()

            if (customRole) {
                await supabaseAdmin.from("staff_role_assignments").insert({
                    profile_id: newUserId,
                    lab_id: adminProfile.lab_id,
                    custom_role_id: custom_role_id,
                    assigned_by: user.id
                })
            }
        }

        return NextResponse.json({ success: true, user_id: newUserId })

    } catch (error: any) {
        console.error("Create staff error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
