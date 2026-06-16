import { NextRequest, NextResponse } from "next/server"
import { getPresignedDownloadUrl } from "@/lib/minio"
import { createServerClient } from "@supabase/ssr"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url)
        const fileId = url.searchParams.get("fileId")

        if (!fileId) {
            return NextResponse.json({ error: "fileId requerido" }, { status: 400 })
        }

        // Authenticate user from cookies
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
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // Use admin client to bypass RLS and get file metadata
        const { data: file, error } = await supabaseAdmin
            .from("result_files")
            .select("storage_path, file_name, order_id, lab_id, orders(patient_id)")
            .eq("id", fileId)
            .single()

        if (error || !file) {
            console.error("File lookup error:", error)
            return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
        }

        // Security: check if user is lab staff or patient with access
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("role, lab_id")
            .eq("id", user.id)
            .single()

        const isLabUser = profile && profile.role !== "PATIENT"

        if (!isLabUser) {
            // For patients: verify the file's order belongs to their patient account
            const { data: accounts } = await supabaseAdmin
                .from("patient_accounts")
                .select("patient_id")
                .eq("user_id", user.id)

            const patientIds = (accounts || []).map((a: any) => a.patient_id)
            const orderPatientId = (file.orders as any)?.patient_id

            if (!orderPatientId || !patientIds.includes(orderPatientId)) {
                return NextResponse.json({ error: "Acceso denegado a este archivo" }, { status: 403 })
            }
        } else {
            // For lab users (including DOCTORS): ensure they belong to the file's lab
            if (profile.role !== "SUPER_ADMIN" && profile.lab_id !== file.lab_id) {
                return NextResponse.json({ error: "Acceso denegado a archivos de otro laboratorio" }, { status: 403 })
            }
        }

        // Generate MinIO presigned URL (valid for 1 hour)
        const storagePath = (file as any).storage_path || (file as any).file_path
        const downloadUrl = await getPresignedDownloadUrl(storagePath, 3600)

        // Log audit event
        await supabaseAdmin.from("audit_events").insert({
            lab_id: file.lab_id,
            actor_id: user.id,
            action: "DOWNLOAD",
            entity_type: "RESULT_FILE",
            entity_id: fileId,
            details: { file_name: file.file_name, order_id: file.order_id }
        })

        return NextResponse.json({ url: downloadUrl })

    } catch (error: any) {
        console.error("Download error:", error)
        return NextResponse.json({ error: "Error interno al generar la descarga" }, { status: 500 })
    }
}
