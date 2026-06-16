import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

export async function POST(req: NextRequest) {
    try {
        // Auth: only LAB_ADMIN can create roles
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
            return NextResponse.json({ error: "Solo un administrador puede gestionar roles" }, { status: 403 })
        }

        const { name, description, permissions } = await req.json()

        if (!name) {
            return NextResponse.json({ error: "El nombre del rol es requerido" }, { status: 400 })
        }

        // 1. Create custom role
        const { data: newRole, error: roleError } = await supabaseAdmin
            .from("custom_roles")
            .insert({
                lab_id: adminProfile.lab_id,
                name,
                description,
                is_default: false
            })
            .select("id")
            .single()

        if (roleError) {
            // Usually duplicate name error
            if (roleError.code === "23505") {
                return NextResponse.json({ error: "Ya existe un rol con ese nombre en este laboratorio" }, { status: 400 })
            }
            throw roleError
        }

        // 2. Insert permissions if any
        if (permissions && Array.isArray(permissions) && permissions.length > 0) {
            const permsToInsert = permissions.map((p: any) => ({
                role_id: newRole.id,
                module: p.module,
                action: p.action
            }))

            const { error: permError } = await supabaseAdmin
                .from("role_permissions")
                .insert(permsToInsert)

            if (permError) throw permError
        }

        return NextResponse.json({ success: true, role_id: newRole.id })

    } catch (error: any) {
        console.error("Create role error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
