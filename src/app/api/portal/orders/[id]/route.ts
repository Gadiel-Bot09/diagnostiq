import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
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

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        // Get patient IDs for this user
        const { data: accounts } = await supabaseAdmin
            .from("patient_accounts")
            .select("patient_id")
            .eq("user_id", user.id)

        if (!accounts || accounts.length === 0) {
            return NextResponse.json({ error: "No hay cuenta de paciente asociada" }, { status: 403 })
        }

        const patientIds = accounts.map((a: any) => a.patient_id)

        // Fetch the specific order
        const { data: order, error } = await supabaseAdmin
            .from("orders")
            .select(`
                id,
                patient_id,
                order_number,
                status,
                ordered_at,
                labs (name, phone, address),
                order_tests (
                    id,
                    tests (name, category, units, reference_range),
                    status,
                    result_summary_json
                ),
                result_files (id, file_name, version)
            `)
            .eq("id", id)
            .single()

        if (error) throw error

        // Security: ensure this order belongs to the authenticated patient
        if (!patientIds.includes(order.patient_id)) {
            return NextResponse.json({ error: "No tienes permiso para ver esta orden" }, { status: 403 })
        }

        return NextResponse.json(order)

    } catch (error: any) {
        console.error("Portal order detail error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
