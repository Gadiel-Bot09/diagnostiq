"use server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

// Helper to get authenticated user on the server
async function getAuthUser() {
    const cookieStore = await cookies()
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // ignore
                    }
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()
    return user
}

export async function getPatientOrdersAction() {
    const user = await getAuthUser()
    if (!user) {
        throw new Error("No autorizado")
    }

    // 1. Obtener patient_ids asociados a este usuario
    const { data: accounts, error: accountsError } = await supabaseAdmin
        .from("patient_accounts")
        .select("patient_id")
        .eq("user_id", user.id)

    if (accountsError) {
        console.error("Error fetching patient accounts:", accountsError)
        return []
    }

    if (!accounts || accounts.length === 0) return []
    const patientIds = accounts.map(a => a.patient_id)

    // 2. Obtener las órdenes de esos patient_ids
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

    if (ordersError) {
        console.error("Error fetching orders:", ordersError)
        return []
    }

    return orders || []
}

export async function getPatientOrderDetailsAction(orderId: string) {
    const user = await getAuthUser()
    if (!user) {
        throw new Error("No autorizado")
    }

    // 1. Obtener patient_ids asociados a este usuario
    const { data: accounts } = await supabaseAdmin
        .from("patient_accounts")
        .select("patient_id")
        .eq("user_id", user.id)

    if (!accounts || accounts.length === 0) throw new Error("No hay cuenta de paciente asociada")
    const patientIds = accounts.map(a => a.patient_id)

    // 2. Obtener los detalles de la orden asegurándonos que pertenezca al paciente
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
        .eq("id", orderId)
        .single()

    if (error) {
        console.error("Error fetching order details:", error)
        throw new Error("Orden no encontrada")
    }

    if (!patientIds.includes(order.patient_id)) {
        throw new Error("No tienes permiso para ver esta orden")
    }

    return order
}
