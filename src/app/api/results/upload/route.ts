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
        const performedAt = formData.get("performedAt") as string

        if (!file || !orderId || !patientId || !labId) {
            return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 })
        }

        // Fecha de realización de los exámenes (YYYY-MM-DD), obligatoria y no futura
        if (!performedAt || !/^\d{4}-\d{2}-\d{2}$/.test(performedAt) || isNaN(Date.parse(performedAt))) {
            return NextResponse.json({ error: "La fecha de realización de los exámenes es obligatoria" }, { status: 400 })
        }
        const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10) // hora Colombia
        if (performedAt > today) {
            return NextResponse.json({ error: "La fecha de realización no puede ser futura" }, { status: 400 })
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

        // Calculate SHA256
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

        const orderTestId = (formData.get("orderTestId") as string) || null
        const lowerName = file.name.toLowerCase()
        const isDicom = lowerName.endsWith(".zip") || lowerName.endsWith(".dcm")
        const fileType = (formData.get("fileType") as string) || (isDicom ? "DICOM_ZIP" : "PDF")

        // Insert into result_files in Supabase
        const filePayload: any = {
            order_id: orderId,
            patient_id: patientId,
            lab_id: labId,
            file_name: file.name,
            file_type: fileType,
            storage_path: uploadedPath,
            mime_type: file.type || (isDicom ? "application/zip" : "application/pdf"),
            size_bytes: file.size,
            uploaded_by: user.id,
            version: parseInt(version || "1", 10),
            storage_bucket: process.env.MINIO_BUCKET || "diagnostiq-results",
            sha256: hashHex,
            performed_at: performedAt,
        }
        if (orderTestId) {
            filePayload.order_test_id = orderTestId
        }

        let { data: resultFile, error: dbError } = await supabase
            .from("result_files")
            .insert(filePayload)
            .select()
            .single()

        // Graceful fallback if order_test_id or file_type column hasn't been added to result_files yet
        if (dbError && dbError.message && (dbError.message.includes("order_test_id") || dbError.message.includes("file_type"))) {
            if (dbError.message.includes("order_test_id")) delete filePayload.order_test_id
            if (dbError.message.includes("file_type")) delete filePayload.file_type
            const retry = await supabase
                .from("result_files")
                .insert(filePayload)
                .select()
                .single()
            resultFile = retry.data
            dbError = retry.error
        }

        if (dbError) throw dbError

        // If associated to a specific test, update order_tests status and result summary
        if (orderTestId && resultFile) {
            const summary = {
                file_id: resultFile.id,
                file_name: file.name,
                version: parseInt(version || "1", 10),
                size_bytes: file.size,
                uploaded_at: resultFile.uploaded_at || new Date().toISOString(),
                performed_at: performedAt,
            }

            await supabase
                .from("order_tests")
                .update({
                    status: "COMPLETED",
                    result_summary_json: summary,
                })
                .eq("id", orderTestId)
        }

        // Determine if all tests in the order are completed
        const { data: allOrderTests } = await supabase
            .from("order_tests")
            .select("id, status")
            .eq("order_id", orderId)

        let targetStatus = "COMPLETED"
        if (allOrderTests && allOrderTests.length > 0) {
            const hasPending = allOrderTests.some((t: any) => t.status !== "COMPLETED")
            targetStatus = hasPending ? "PROCESSING" : "COMPLETED"
        }

        // Update order status and performed_at
        const { data: updatedOrder, error: orderError } = await supabase
            .from("orders")
            .update({ status: targetStatus, performed_at: performedAt })
            .eq("id", orderId)
            .select("order_number, patients(email, full_name), labs(name)")
            .single()

        if (!orderError && updatedOrder && targetStatus === "COMPLETED") {
            const patientEmail = (updatedOrder.patients as any)?.email
            const patientName = (updatedOrder.patients as any)?.full_name
            const labName = (updatedOrder.labs as any)?.name
            
            // Si el paciente tiene correo y toda la orden está completada, enviamos notificación
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
            details: {
                file_name: file.name,
                order_id: orderId,
                order_test_id: orderTestId,
                performed_at: performedAt,
                order_status: targetStatus,
            }
        })

        return NextResponse.json({ success: true, file: resultFile, orderStatus: targetStatus })

    } catch (error: any) {
        console.error("Upload error:", error)
        return NextResponse.json({ error: error.message || "Error al subir el archivo" }, { status: 500 })
    }
}
