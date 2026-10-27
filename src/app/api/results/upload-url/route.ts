import { NextRequest, NextResponse } from "next/server"
import {
    getPresignedUploadUrl,
    createMultipartUpload,
    getPresignedPartUrls,
    completeMultipartUpload,
    abortMultipartUpload,
} from "@/lib/minio"
import { createServerClient } from "@supabase/ssr"

const MULTIPART_THRESHOLD = 10 * 1024 * 1024 // 10 MB
const PART_SIZE = 10 * 1024 * 1024 // 10 MB chunks

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { action } = body

        // Authenticate with Supabase
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

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // Handle multipart completion
        if (action === "complete") {
            const { uploadId, filePath, parts } = body
            if (!uploadId || !filePath || !parts || !Array.isArray(parts)) {
                return NextResponse.json({ error: "Faltan parámetros para completar multipart upload" }, { status: 400 })
            }
            await completeMultipartUpload(filePath, uploadId, parts)
            return NextResponse.json({ success: true, filePath })
        }

        // Handle multipart abort
        if (action === "abort") {
            const { uploadId, filePath } = body
            if (uploadId && filePath) {
                await abortMultipartUpload(filePath, uploadId).catch(() => {})
            }
            return NextResponse.json({ aborted: true })
        }

        // Initialize upload (Action: "init" or default)
        const { orderId, patientId, labId, fileName, fileSize, performedAt } = body

        if (!orderId || !patientId || !labId || !fileName) {
            return NextResponse.json({ error: "Faltan datos requeridos (orderId, patientId, labId, fileName)" }, { status: 400 })
        }

        // Validate date
        if (performedAt) {
            const todayCo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
            if (performedAt > todayCo) {
                return NextResponse.json({ error: "La fecha de realización no puede ser futura" }, { status: 400 })
            }
        }

        // Generate safe unique storage path
        const timestamp = Date.now()
        const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
        const filePath = `${labId}/${patientId}/${orderId}/${timestamp}_${safeName}`

        const lowerName = fileName.toLowerCase()
        const isDicom = lowerName.endsWith(".zip") || lowerName.endsWith(".dcm")
        const fileType = isDicom ? "DICOM_ZIP" : "PDF"
        const mimeType = isDicom ? "application/zip" : "application/pdf"

        // Use S3 Multipart Upload for files > 10 MB to prevent proxy timeouts (HTTP 499 / 413)
        if (fileSize && fileSize > MULTIPART_THRESHOLD) {
            const partCount = Math.ceil(fileSize / PART_SIZE)
            const { uploadId } = await createMultipartUpload(filePath, mimeType)
            const parts = await getPresignedPartUrls(filePath, uploadId, partCount, 7200)

            return NextResponse.json({
                isMultipart: true,
                uploadId,
                filePath,
                fileType,
                partSize: PART_SIZE,
                parts,
            })
        }

        // Standard single PUT for small files (<= 10 MB)
        const uploadUrl = await getPresignedUploadUrl(filePath, undefined, 7200)

        return NextResponse.json({
            isMultipart: false,
            uploadUrl,
            filePath,
            fileType,
        })
    } catch (error: any) {
        console.error("Error generating presigned upload URL:", error)
        return NextResponse.json({ error: error.message || "Error al generar enlace de carga presignado" }, { status: 500 })
    }
}
