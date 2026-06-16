import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const id = (await params).id
        if (!id) return NextResponse.json({ error: "Falta el ID del rol" }, { status: 400 })

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

        // 1. Update the role details
        const { error: updateError } = await supabaseAdmin
            .from("custom_roles")
            .update({ name, description })
            .eq("id", id)
            .eq("lab_id", adminProfile.lab_id) // ensure lab context

        if (updateError) {
            if (updateError.code === "23505") {
                return NextResponse.json({ error: "Ya existe un rol con ese nombre" }, { status: 400 })
            }
            throw updateError
        }

        // 2. Replace permissions
        // First, delete existing ones
        await supabaseAdmin
            .from("role_permissions")
            .delete()
            .eq("role_id", id)

        // Then, insert new ones
        if (permissions && Array.isArray(permissions) && permissions.length > 0) {
            const permsToInsert = permissions.map((p: any) => ({
                role_id: id,
                module: p.module,
                action: p.action
            }))

            const { error: permError } = await supabaseAdmin
                .from("role_permissions")
                .insert(permsToInsert)

            if (permError) throw permError
        }

        return NextResponse.json({ success: true })

    } catch (error: any) {
        console.error("Update role error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const id = (await params).id
        if (!id) return NextResponse.json({ error: "Falta el ID del rol" }, { status: 400 })

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

        // Validate if role is in use
        const { count, error: countError } = await supabaseAdmin
            .from("staff_role_assignments")
            .select("*", { count: "exact", head: true })
            .eq("custom_role_id", id)

        if (countError) throw countError

        if (count && count > 0) {
            return NextResponse.json({ error: "No se puede eliminar el rol porque está asignado a uno o más usuarios activos." }, { status: 400 })
        }

        // Delete the role (cascade will delete permissions if set up, but we'll do it manually just in case)
        await supabaseAdmin
            .from("role_permissions")
            .delete()
            .eq("role_id", id)

        const { error: deleteError } = await supabaseAdmin
            .from("custom_roles")
            .delete()
            .eq("id", id)
            .eq("lab_id", adminProfile.lab_id)

        if (deleteError) throw deleteError

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error("Delete role error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
