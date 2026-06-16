import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

export async function GET(req: NextRequest) {
    try {
        // 1. Authenticate and verify DOCTOR role
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll() { return req.cookies.getAll() }, setAll() { } } }
        )
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("role, lab_id")
            .eq("id", user.id)
            .single()

        if (!profile || !["DOCTOR", "LAB_ADMIN", "LAB_STAFF"].includes(profile.role)) {
            return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
        }

        // 2. Get document number from query
        const url = new URL(req.url)
        const documentNumber = url.searchParams.get("document_number")?.trim()

        if (!documentNumber) {
            return NextResponse.json({ error: "document_number es requerido" }, { status: 400 })
        }

        // 3. Find patient in this lab
        const { data: patient, error: patientError } = await supabaseAdmin
            .from("patients")
            .select("id, full_name, document_number, document_type, email")
            .eq("document_number", documentNumber)
            .eq("lab_id", profile.lab_id)
            .single()

        if (patientError || !patient) {
            return NextResponse.json({ error: "Paciente no encontrado en este laboratorio" }, { status: 404 })
        }

        // 4. Fetch all completed orders for this patient, newest first
        const { data: orders, error: ordersError } = await supabaseAdmin
            .from("orders")
            .select(`
                id,
                order_number,
                status,
                ordered_at,
                is_direct,
                direct_exam_name,
                order_tests (
                    id,
                    tests (name, category)
                ),
                result_files (id, file_name, mime_type, size_bytes)
            `)
            .eq("patient_id", patient.id)
            .eq("lab_id", profile.lab_id)
            .eq("status", "COMPLETED")
            .order("ordered_at", { ascending: false })

        if (ordersError) throw ordersError

        return NextResponse.json({ patient, orders: orders || [] })

    } catch (error: any) {
        console.error("Doctor patient-results error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
