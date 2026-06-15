import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createServerClient } from "@supabase/ssr"
import { uploadToMinio } from "@/lib/minio"
import { sendWelcomeEmail, sendDirectResultsEmail } from "@/lib/email"
import crypto from "crypto"

// Synthetic email for patients with no real email (allows Supabase Auth account creation)
function syntheticEmail(documentNumber: string): string {
    return `${documentNumber.trim()}@portal.diagnostiq`
}

export async function POST(req: NextRequest) {
    try {
        // 1. Authenticate lab user
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll() { return req.cookies.getAll() }, setAll() { } } }
        )
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // 2. Get lab_id from profiles
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("lab_id, role")
            .eq("id", user.id)
            .single()

        if (!profile || profile.role === "PATIENT") {
            return NextResponse.json({ error: "Solo el personal del laboratorio puede usar esta función" }, { status: 403 })
        }
        const labId = profile.lab_id

        // 3. Parse form data
        const formData = await req.formData()
        const documentType = formData.get("document_type") as string
        const documentNumber = formData.get("document_number") as string
        const fullName = formData.get("full_name") as string
        const email = formData.get("email") as string | null
        const examName = formData.get("exam_name") as string
        const files = formData.getAll("files") as File[]

        if (!documentNumber || !fullName || !examName || files.length === 0) {
            return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 })
        }

        // 4. Find or create patient
        let patient: any = null
        let isNewPatient = false

        const { data: existingPatient } = await supabaseAdmin
            .from("patients")
            .select("*")
            .eq("document_number", documentNumber)
            .eq("lab_id", labId)
            .single()

        if (existingPatient) {
            patient = existingPatient
        } else {
            const { data: newPatient, error: patientError } = await supabaseAdmin
                .from("patients")
                .insert({
                    full_name: fullName,
                    document_type: documentType || "CC",
                    document_number: documentNumber,
                    email: email || null,
                    lab_id: labId,
                })
                .select()
                .single()

            if (patientError) throw patientError
            patient = newPatient
            isNewPatient = true
        }

        // 5. Always create portal account (real email or synthetic — so all patients can log in)
        const realEmail = email || patient.email || null
        const loginEmail = realEmail || syntheticEmail(documentNumber)
        const hasRealEmail = !!realEmail

        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
        const existingAuthUser = existingUsers?.users?.find((u: any) => u.email === loginEmail)

        let authUserId: string

        if (existingAuthUser) {
            authUserId = existingAuthUser.id
            await supabaseAdmin.auth.admin.updateUserById(authUserId, { password: documentNumber })
        } else {
            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email: loginEmail,
                password: documentNumber,
                email_confirm: true,
                user_metadata: { role: "PATIENT", full_name: fullName, password_changed: false }
            })
            if (authError) throw authError
            authUserId = authData.user.id

            await supabaseAdmin.from("profiles").upsert({
                id: authUserId, role: "PATIENT", full_name: fullName, is_active: true
            }, { onConflict: "id" })

            // Only send welcome email if there is a real email address
            if (isNewPatient && hasRealEmail) {
                const labRes = await supabaseAdmin.from("labs").select("name").eq("id", labId).single()
                await sendWelcomeEmail(loginEmail, fullName, labRes.data?.name || "DiagnostiQ")
            }
        }

        // Link auth user to patient account
        await supabaseAdmin.from("patient_accounts").upsert({
            user_id: authUserId,
            patient_id: patient.id,
            lab_id: labId,
        }, { onConflict: "user_id, lab_id" })

        // Update patient email if it was missing and provided now
        if (!patient.email && email) {
            await supabaseAdmin.from("patients").update({ email }).eq("id", patient.id)
        }

        // 6. Generate order number
        const now = new Date()
        const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
        const timePart = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`
        const orderNumber = `${datePart}-D${timePart}`

        // 7. Create direct order
        const { data: order, error: orderError } = await supabaseAdmin
            .from("orders")
            .insert({
                order_number: orderNumber,
                patient_id: patient.id,
                lab_id: labId,
                status: "COMPLETED",
                is_direct: true,
                direct_exam_name: examName,
                ordered_at: new Date().toISOString(),
            })
            .select()
            .single()

        if (orderError) throw orderError

        // 8. Upload PDFs to MinIO and save to result_files
        const { data: lab } = await supabaseAdmin.from("labs").select("name").eq("id", labId).single()
        const labName = lab?.name || "DiagnostiQ"

        for (const file of files) {
            const buffer = Buffer.from(await file.arrayBuffer())
            const storagePath = `labs/${labId}/direct/${order.id}/${Date.now()}-${file.name}`

            await uploadToMinio(storagePath, buffer, file.type || "application/pdf")

            const sha256 = crypto.createHash("sha256").update(buffer).digest("hex")

            await supabaseAdmin.from("result_files").insert({
                order_id: order.id,
                lab_id: labId,
                file_name: file.name,
                storage_path: storagePath,
                mime_type: file.type || "application/pdf",
                size_bytes: buffer.length,
                sha256,
                version: 1,
            })
        }

        // 9. Send "results ready" email only if patient has a real email
        if (hasRealEmail) {
            await sendDirectResultsEmail(loginEmail, fullName, labName, examName, isNewPatient)
        }

        return NextResponse.json({
            success: true,
            isNewPatient,
            patient: { id: patient.id, full_name: fullName, document_number: documentNumber },
            order: { id: order.id, order_number: orderNumber },
            filesUploaded: files.length,
        })

    } catch (error: any) {
        console.error("Direct upload error:", error)
        return NextResponse.json({ error: error.message || "Error al procesar la carga directa" }, { status: 500 })
    }
}
