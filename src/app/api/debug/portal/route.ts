import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"

export async function GET(req: NextRequest) {
    try {
        // Get the current authenticated user from cookies
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
            return NextResponse.json({
                step: "auth",
                error: "No hay usuario autenticado en la sesión",
                authError,
            }, { status: 401 })
        }

        const result: any = {
            user_id: user.id,
            user_email: user.email,
            user_metadata: user.user_metadata,
        }

        // Check patient_accounts
        const { data: accounts, error: accountsError } = await supabaseAdmin
            .from("patient_accounts")
            .select("*")
            .eq("user_id", user.id)

        result.patient_accounts = accounts
        result.patient_accounts_error = accountsError

        if (!accounts || accounts.length === 0) {
            result.diagnosis = "❌ No existe un registro en patient_accounts para este user_id. Debes volver a dar clic en 'Crear Cuenta Portal' desde el laboratorio."
            return NextResponse.json(result)
        }

        const patientIds = accounts.map((a: any) => a.patient_id)
        result.patient_ids = patientIds

        // Check patients table
        const { data: patients, error: patientsError } = await supabaseAdmin
            .from("patients")
            .select("id, full_name, document_number, email, lab_id")
            .in("id", patientIds)

        result.patients = patients
        result.patients_error = patientsError

        // Check orders
        const { data: orders, error: ordersError } = await supabaseAdmin
            .from("orders")
            .select("id, order_number, status, patient_id, lab_id, ordered_at")
            .in("patient_id", patientIds)
            .order("ordered_at", { ascending: false })

        result.orders = orders
        result.orders_error = ordersError

        if (!orders || orders.length === 0) {
            result.diagnosis = "❌ Hay patient_accounts pero NO hay órdenes con esos patient_ids. Verifica que el patient_id en patient_accounts coincide con el patient_id en orders."
        } else {
            result.diagnosis = `✅ Todo correcto. Se encontraron ${orders.length} órdenes.`
        }

        return NextResponse.json(result)

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
