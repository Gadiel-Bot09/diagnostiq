import { NextRequest, NextResponse } from "next/server"
import { uploadToMinio } from "@/lib/minio"
import { createServerClient } from "@supabase/ssr"
import { sendNewResultsEmail } from "@/lib/email"

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const file = formData.get("file") as File
        const orderId = formData.get("orderId") as string
        const patientId = formData.get("patientId") as string
        const labId = formData.get("labId") as string
        const version = formData.get("version") as string

        if (!file || !orderId || !patientId || !labId) {
            return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 })
        }

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return req.cookies.getAll() },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
                    },
                },
            }
        )

        // Verificamos que el usuario está logueado
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // Read file
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        
        const timestamp = Date.now()
        const extension = file.name.split('.').pop()
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
        const filePath = `${labId}/${patientId}/${orderId}/${timestamp}_${safeName}`

        // Upload to MinIO
        const uploadedPath = await uploadToMinio(filePath, buffer, file.type)

        // Insert into result_files in Supabase
        const { data: resultFile, error: dbError } = await supabase
            .from("result_files")
            .insert({
                order_id: orderId,
                patient_id: patientId,
                lab_id: labId,
                file_name: file.name,
                file_path: uploadedPath,
                file_type: file.type,
                file_size: file.size,
                uploaded_by: user.id,
                version: parseInt(version || "1", 10),
                storage_bucket: process.env.MINIO_BUCKET || "diagnostiq-results"
            })
            .select()
            .single()

        if (dbError) throw dbError

        // Update order status to COMPLETED
        const { data: updatedOrder, error: orderError } = await supabase
            .from("orders")
            .update({ status: "COMPLETED" })
            .eq("id", orderId)
            .select("order_number, patients(email, full_name), labs(name)")
            .single()

        if (!orderError && updatedOrder) {
            const patientEmail = (updatedOrder.patients as any)?.email
            const patientName = (updatedOrder.patients as any)?.full_name
            const labName = (updatedOrder.labs as any)?.name
            
            // Si el paciente tiene correo, enviamos notificación
            if (patientEmail) {
                await sendNewResultsEmail(patientEmail, patientName, labName, updatedOrder.order_number)
            }
        }

        // Log audit event
        await supabase.from("audit_events").insert({
            lab_id: labId,
            actor_id: user.id,
            action: "UPLOAD",
            entity_type: "RESULT_FILE",
            entity_id: resultFile.id,
            details: { file_name: file.name, order_id: orderId }
        })

        return NextResponse.json({ success: true, file: resultFile })

    } catch (error: any) {
        console.error("Upload error:", error)
        return NextResponse.json({ error: error.message || "Error al subir el archivo" }, { status: 500 })
    }
}
