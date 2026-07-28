import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
    try {
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Fetch auth users using the Admin API
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers()
        if (authError) throw authError

        // Fetch profiles
        const { data: profilesData, error: profilesError } = await supabaseAdmin
            .from("profiles")
            .select("id, full_name, role, is_active, created_at, lab_id, labs(name)")
            .order("created_at", { ascending: false })
            
        if (profilesError) throw profilesError

        // Merge them
        const mergedUsers = profilesData.map(profile => {
            const authUser = authData.users.find(u => u.id === profile.id)
            return {
                ...profile,
                email: authUser?.email || "Sin correo"
            }
        })

        return NextResponse.json(mergedUsers)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json()
        const { id, full_name, email } = body

        if (!id || (!full_name && !email)) {
            return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Update Auth User Email if provided
        if (email) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, { email })
            if (authError) throw authError
        }

        // Update Profile Name if provided
        if (full_name) {
            const { error: profileError } = await supabaseAdmin
                .from("profiles")
                .update({ full_name })
                .eq("id", id)
            if (profileError) throw profileError
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
