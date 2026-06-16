import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

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
            .select("role, lab_id")
            .eq("id", user.id)
            .single()

        if (!adminProfile || adminProfile.role !== "LAB_ADMIN") {
            return NextResponse.json({ error: "Solo un administrador puede crear médicos" }, { status: 403 })
        }

        const { full_name, email, password, specialty } = await req.json()

        if (!full_name || !email || !password) {
            return NextResponse.json({ error: "Nombre, email y contraseña son requeridos" }, { status: 400 })
        }

        // Create auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { role: "DOCTOR", full_name }
        })
        if (authError) throw authError

        // Upsert profile (Supabase auth triggers might already create a partial profile row)
        const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
            id: authData.user.id,
            full_name,
            role: "DOCTOR",
            lab_id: adminProfile.lab_id,
            is_active: true,
            specialty: specialty || null,
        })
        if (profileError) throw profileError

        return NextResponse.json({ success: true, user_id: authData.user.id })

    } catch (error: any) {
        console.error("Create doctor error:", error)

        let errorMessage = error.message
        if (errorMessage.includes("already been registered") || errorMessage.includes("already exists")) {
            errorMessage = "Ya existe un usuario registrado con este correo electrónico."
        }

        return NextResponse.json({ error: errorMessage }, { status: 500 })
    }
}
