import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

export async function GET(req: NextRequest) {
    try {
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

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        // Get patient IDs for this user
        const { data: accounts, error: accountsError } = await supabaseAdmin
            .from("patient_accounts")
            .select("patient_id")
            .eq("user_id", user.id)

        if (accountsError) throw accountsError
        if (!accounts || accounts.length === 0) {
            return NextResponse.json([])
        }

        const patientIds = accounts.map((a: any) => a.patient_id)

        // Fetch orders using admin client (bypasses RLS)
        const { data: orders, error: ordersError } = await supabaseAdmin
            .from("orders")
            .select(`
                id,
                order_number,
                status,
                ordered_at,
                labs (name)
            `)
            .in("patient_id", patientIds)
            .order("ordered_at", { ascending: false })

        if (ordersError) throw ordersError

        return NextResponse.json(orders || [])

    } catch (error: any) {
        console.error("Portal orders error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
