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

        // Verify LAB_STAFF has permission for direct_results
        if (profile.role === "LAB_STAFF") {
            const { data: assignment } = await supabaseAdmin
                .from("staff_role_assignments")
                .select("custom_role_id")
                .eq("profile_id", user.id)
                .eq("lab_id", labId)
                .maybeSingle()

            if (!assignment?.custom_role_id) {
                return NextResponse.json({ error: "No tienes un rol asignado con permisos para resultados directos" }, { status: 403 })
            }

            const { data: perms } = await supabaseAdmin
                .from("role_permissions")
                .select("id")
                .eq("role_id", assignment.custom_role_id)
                .in("module", ["direct_results", "results"])
                .in("action", ["create", "upload"])

            if (!perms || perms.length === 0) {
                return NextResponse.json({ error: "Tu rol no tiene permiso para cargar resultados directos" }, { status: 403 })
            }
        }

        // 3. Parse request (supports both JSON for presigned direct MinIO uploads and FormData for legacy)
        const isJson = req.headers.get("content-type")?.includes("application/json")
        let documentType = ""
        let documentNumber = ""
        let fullName = ""
        let email: string | null = null
        let examName = ""
        let performedAt = ""
        let rawFiles: File[] = []
        let presignedFiles: { name: string; size: number; type?: string; storagePath: string; fileType?: string }[] = []

        if (isJson) {
            const body = await req.json()
            documentType = body.document_type || "CC"
            documentNumber = body.document_number
            fullName = body.full_name
            email = body.email || null
            examName = body.exam_name
            performedAt = body.performed_at
            presignedFiles = body.files || []
        } else {
            const formData = await req.formData()
            documentType = formData.get("document_type") as string
            documentNumber = formData.get("document_number") as string
            fullName = formData.get("full_name") as string
            email = formData.get("email") as string | null
            examName = formData.get("exam_name") as string
            rawFiles = formData.getAll("files") as File[]
            performedAt = formData.get("performed_at") as string
        }

        const totalFilesCount = isJson ? presignedFiles.length : rawFiles.length
        if (!documentNumber || !fullName || !examName || totalFilesCount === 0) {
            return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 })
        }

        // Fecha de realización de los exámenes (YYYY-MM-DD), obligatoria y no futura
        if (!performedAt || !/^\d{4}-\d{2}-\d{2}$/.test(performedAt) || isNaN(Date.parse(performedAt))) {
            return NextResponse.json({ error: "La fecha de realización de los exámenes es obligatoria" }, { status: 400 })
        }
        const todayCo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
        if (performedAt > todayCo) {
            return NextResponse.json({ error: "La fecha de realización no puede ser futura" }, { status: 400 })
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
        let loginEmail = realEmail || syntheticEmail(documentNumber)
        const hasRealEmail = !!realEmail

        let authUserId: string
        let isNewAuthUser = false

        // Try to create the auth user. If the email is already registered,
        // handle the conflict gracefully instead of using listUsers() which has pagination limits.
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: loginEmail,
            password: documentNumber,
            email_confirm: true,
            user_metadata: { role: "PATIENT", full_name: fullName, password_changed: false }
        })

        if (authError) {
            const isAlreadyExists = authError.message?.toLowerCase().includes("already registered")
                || authError.message?.toLowerCase().includes("already been registered")
                || authError.message?.toLowerCase().includes("user already exists")
                || (authError as any).code === "email_exists"

            if (!isAlreadyExists) throw authError

            // Try patient_accounts first to find the real patient auth user
            const { data: existingAccount } = await supabaseAdmin
                .from("patient_accounts")
                .select("user_id")
                .eq("patient_id", patient.id)
                .eq("lab_id", labId)
                .single()

            if (existingAccount) {
                // Check if this existing account belongs to a non-patient (admin/staff)
                const { data: accountProfile } = await supabaseAdmin
                    .from("profiles")
                    .select("role")
                    .eq("id", existingAccount.user_id)
                    .single()

                if (accountProfile && accountProfile.role !== "PATIENT") {
                    // The linked account is an admin/staff — use synthetic email for isolation
                    loginEmail = syntheticEmail(documentNumber)
                    const { data: newAuthData, error: newAuthError } = await supabaseAdmin.auth.admin.createUser({
                        email: loginEmail,
                        password: documentNumber,
                        email_confirm: true,
                        user_metadata: { role: "PATIENT", full_name: fullName, password_changed: false }
                    })
                    if (newAuthError) throw newAuthError
                    authUserId = newAuthData.user.id
                    isNewAuthUser = true
                } else {
                    authUserId = existingAccount.user_id
                    await supabaseAdmin.auth.admin.updateUserById(authUserId, { password: documentNumber })
                }
            } else {
                // No patient_accounts link yet — find existing auth user by email
                // First check if it's a non-patient profile (admin/staff)
                let foundUserId: string | null = null
                let page = 1
                while (!foundUserId) {
                    const { data: pageData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page })
                    if (!pageData?.users?.length) break
                    const found = pageData.users.find((u: any) => u.email === loginEmail)
                    if (found) { foundUserId = found.id; break }
                    if (pageData.users.length < 1000) break
                    page++
                }

                if (foundUserId) {
                    // Check if the found user is a non-patient (admin/staff)
                    const { data: foundProfile } = await supabaseAdmin
                        .from("profiles")
                        .select("role")
                        .eq("id", foundUserId)
                        .single()

                    if (foundProfile && foundProfile.role !== "PATIENT") {
                        // Non-patient user — use synthetic email to protect their account
                        loginEmail = syntheticEmail(documentNumber)
                        const { data: newAuthData, error: newAuthError } = await supabaseAdmin.auth.admin.createUser({
                            email: loginEmail,
                            password: documentNumber,
                            email_confirm: true,
                            user_metadata: { role: "PATIENT", full_name: fullName, password_changed: false }
                        })
                        if (newAuthError) throw newAuthError
                        authUserId = newAuthData.user.id
                        isNewAuthUser = true
                    } else {
                        authUserId = foundUserId
                        await supabaseAdmin.auth.admin.updateUserById(authUserId, { password: documentNumber })
                    }
                } else {
                    throw new Error(`Auth user with email ${loginEmail} not found after creation conflict`)
                }
            }
        } else {
            authUserId = authData.user.id
            isNewAuthUser = true
        }

        // Create profiles entry ONLY for genuinely new patient auth users (never overwrite admin roles)
        if (isNewAuthUser) {
            await supabaseAdmin.from("profiles").upsert({
                id: authUserId, role: "PATIENT", full_name: fullName, is_active: true
            }, { onConflict: "id" })

            // Only send welcome email if there is a real email address and this is a new patient
            if (isNewPatient && hasRealEmail) {
                const labRes = await supabaseAdmin.from("labs").select("name").eq("id", labId).single()
                await sendWelcomeEmail(loginEmail, fullName, labRes.data?.name || "DiagnostiQ")
            }
        }

        // Link auth user to patient account — check error explicitly
        const { error: linkError } = await supabaseAdmin.from("patient_accounts").upsert({
            user_id: authUserId,
            patient_id: patient.id,
            lab_id: labId,
        }, { onConflict: "user_id, lab_id" })
        if (linkError) {
            console.error("patient_accounts upsert error:", linkError)
            throw new Error(`No se pudo vincular la cuenta del paciente: ${linkError.message}`)
        }

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
                performed_at: performedAt,
                ordered_at: new Date().toISOString(),
            })
            .select()
            .single()

        if (orderError) throw orderError

        // 8. Upload PDFs to MinIO and save to result_files
        const { data: lab } = await supabaseAdmin.from("labs").select("name").eq("id", labId).single()
        const labName = lab?.name || "DiagnostiQ"

        if (isJson) {
            for (const pf of presignedFiles) {
                const lowerName = (pf.name || "").toLowerCase()
                const isDicom = lowerName.endsWith(".zip") || lowerName.endsWith(".dcm")
                const fileType = pf.fileType || (isDicom ? "DICOM_ZIP" : "PDF")
                const mimeType = pf.type || (isDicom ? "application/zip" : "application/pdf")

                const filePayload: any = {
                    order_id: order.id,
                    patient_id: patient.id,
                    lab_id: labId,
                    file_name: pf.name,
                    file_type: fileType,
                    storage_path: pf.storagePath,
                    mime_type: mimeType,
                    size_bytes: pf.size || 0,
                    uploaded_by: user.id,
                    storage_bucket: process.env.MINIO_BUCKET || "diagnostiq-results",
                    sha256: (pf as any).sha256 || crypto.createHash("sha256").update(`${order.id}-${pf.name}-${pf.size || 0}-${pf.storagePath}`).digest("hex"),
                    version: 1,
                    performed_at: performedAt,
                }

                let { error: insertError } = await supabaseAdmin.from("result_files").insert(filePayload)
                if (insertError && insertError.message && insertError.message.includes("file_type")) {
                    delete filePayload.file_type
                    const retry = await supabaseAdmin.from("result_files").insert(filePayload)
                    insertError = retry.error
                }
                if (insertError) {
                    console.error("Result file insert error:", insertError)
                    throw insertError
                }
            }
        } else {
            for (const file of rawFiles) {
                const buffer = Buffer.from(await file.arrayBuffer())
                const storagePath = `labs/${labId}/direct/${order.id}/${Date.now()}-${file.name}`

                const lowerName = file.name.toLowerCase()
                const isDicom = lowerName.endsWith(".zip") || lowerName.endsWith(".dcm")
                const fileType = isDicom ? "DICOM_ZIP" : "PDF"
                const mimeType = file.type || (isDicom ? "application/zip" : "application/pdf")

                await uploadToMinio(storagePath, buffer, mimeType)

                const sha256 = crypto.createHash("sha256").update(buffer).digest("hex")

                const filePayload: any = {
                    order_id: order.id,
                    patient_id: patient.id,
                    lab_id: labId,
                    file_name: file.name,
                    file_type: fileType,
                    storage_path: storagePath,
                    mime_type: mimeType,
                    size_bytes: buffer.length,
                    uploaded_by: user.id,
                    storage_bucket: process.env.MINIO_BUCKET || "diagnostiq-results",
                    sha256,
                    version: 1,
                    performed_at: performedAt,
                }

                let { error: insertError } = await supabaseAdmin.from("result_files").insert(filePayload)
                if (insertError && insertError.message && insertError.message.includes("file_type")) {
                    delete filePayload.file_type
                    const retry = await supabaseAdmin.from("result_files").insert(filePayload)
                    insertError = retry.error
                }
                if (insertError) {
                    console.error("Result file insert error:", insertError)
                    throw insertError
                }
            }
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
            filesUploaded: totalFilesCount,
        })

    } catch (error: any) {
        console.error("Direct upload error:", error)
        return NextResponse.json({ error: error.message || "Error al procesar la carga directa" }, { status: 500 })
    }
}
