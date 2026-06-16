import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const id = (await params).id
        if (!id) return NextResponse.json({ error: "Falta el ID del usuario" }, { status: 400 })

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll() { return req.cookies.getAll() }, setAll() { } } }
        )
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // Check if admin
        const { data: adminProfile } = await supabaseAdmin
            .from("profiles")
            .select("role, lab_id")
            .eq("id", user.id)
            .single()

        if (!adminProfile || adminProfile.role !== "LAB_ADMIN") {
            return NextResponse.json({ error: "Solo un administrador puede editar usuarios" }, { status: 403 })
        }

        // Parse request
        const { full_name, specialty, is_active, custom_role_id } = await req.json()

        // 1. Ensure user belongs to the same lab
        const { data: targetProfile, error: targetError } = await supabaseAdmin
            .from("profiles")
            .select("lab_id, role")
            .eq("id", id)
            .single()
            
        if (targetError || !targetProfile || targetProfile.lab_id !== adminProfile.lab_id) {
            return NextResponse.json({ error: "Usuario no encontrado o no pertenece a este laboratorio" }, { status: 404 })
        }

        // Prevent admin from disabling themselves
        if (id === user.id && is_active === false) {
            return NextResponse.json({ error: "No puedes inhabilitar tu propio usuario" }, { status: 400 })
        }

        // 2. Update profile basic info
        const { error: updateError } = await supabaseAdmin
            .from("profiles")
            .update({ 
                full_name: full_name !== undefined ? full_name : undefined,
                is_active: is_active !== undefined ? is_active : undefined 
            })
            .eq("id", id)

        if (updateError) throw updateError

        // 3. Update staff details (specialty) if DOCTOR
        if (targetProfile.role === "DOCTOR" && specialty !== undefined) {
            await supabaseAdmin
                .from("staff_profiles")
                .update({ specialty })
                .eq("id", id)
        }

        // 4. Update custom role if applicable
        if (targetProfile.role === "LAB_STAFF" && custom_role_id !== undefined) {
            // First check if role exists in this lab
            const { data: roleData } = await supabaseAdmin
                .from("custom_roles")
                .select("id")
                .eq("id", custom_role_id)
                .eq("lab_id", adminProfile.lab_id)
                .single()

            if (roleData) {
                // Update assignment
                const { error: assignError } = await supabaseAdmin
                    .from("staff_role_assignments")
                    .update({ custom_role_id })
                    .eq("profile_id", id)
                    
                if (assignError) throw assignError
            }
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error("Update user error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const id = (await params).id
        if (!id) return NextResponse.json({ error: "Falta el ID del usuario" }, { status: 400 })

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
            return NextResponse.json({ error: "Solo un administrador puede inactivar usuarios" }, { status: 403 })
        }

        if (id === user.id) {
            return NextResponse.json({ error: "No puedes inactivarte a ti mismo" }, { status: 400 })
        }

        const { data: targetProfile, error: targetError } = await supabaseAdmin
            .from("profiles")
            .select("lab_id")
            .eq("id", id)
            .single()

        if (targetError || !targetProfile || targetProfile.lab_id !== adminProfile.lab_id) {
            return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
        }

        // Perform Soft Delete by setting is_active = false
        const { error: updateError } = await supabaseAdmin
            .from("profiles")
            .update({ is_active: false })
            .eq("id", id)

        if (updateError) throw updateError

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error("Delete user error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
