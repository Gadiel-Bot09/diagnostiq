import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

// Converts a document number into a synthetic internal email for Supabase Auth
export function syntheticEmail(documentNumber: string): string {
    return `${documentNumber.trim()}@portal.diagnostiq`
}

export async function POST(req: NextRequest) {
    try {
        const { document_number, password } = await req.json()

        if (!document_number || !password) {
            return NextResponse.json({ error: "Número de documento y contraseña son requeridos" }, { status: 400 })
        }

        // Look up the patient by document number to find their email (real or synthetic)
        const { data: patient, error: patientError } = await supabaseAdmin
            .from("patients")
            .select("email, document_number, full_name")
            .eq("document_number", document_number.trim())
            .single()

        if (patientError || !patient) {
            return NextResponse.json({ error: "Paciente no encontrado. Consulta con tu laboratorio." }, { status: 404 })
        }

        // Use real email if available, otherwise use synthetic email
        const loginEmail = patient.email || syntheticEmail(document_number)

        return NextResponse.json({ email: loginEmail })

    } catch (error: any) {
        console.error("Patient lookup error:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
