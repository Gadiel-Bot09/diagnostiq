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

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll() { return req.cookies.getAll() }, setAll() { } } }
        )
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // Handle multipart completion
        if (action === "complete") {
            const { uploadId, storagePath, parts } = body
            if (!uploadId || !storagePath || !parts || !Array.isArray(parts)) {
                return NextResponse.json({ error: "Faltan parámetros para completar multipart upload" }, { status: 400 })
            }
            await completeMultipartUpload(storagePath, uploadId, parts)
            return NextResponse.json({ success: true, storagePath })
        }

        // Handle multipart abort
        if (action === "abort") {
            const { uploadId, storagePath } = body
            if (uploadId && storagePath) {
                await abortMultipartUpload(storagePath, uploadId).catch(() => {})
            }
            return NextResponse.json({ aborted: true })
        }

        const { fileName, fileSize } = body
        if (!fileName) {
            return NextResponse.json({ error: "Falta el nombre del archivo" }, { status: 400 })
        }

        const timestamp = Date.now()
        const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
        const storagePath = `direct/${timestamp}_${safeName}`

        const lowerName = fileName.toLowerCase()
        const isDicom = lowerName.endsWith(".zip") || lowerName.endsWith(".dcm")
        const fileType = isDicom ? "DICOM_ZIP" : "PDF"
        const mimeType = isDicom ? "application/zip" : "application/pdf"

        // Use S3 Multipart Upload for files > 10 MB
        if (fileSize && fileSize > MULTIPART_THRESHOLD) {
            const partCount = Math.ceil(fileSize / PART_SIZE)
            const { uploadId } = await createMultipartUpload(storagePath, mimeType)
            const parts = await getPresignedPartUrls(storagePath, uploadId, partCount, 7200)

            return NextResponse.json({
                isMultipart: true,
                uploadId,
                storagePath,
                fileType,
                partSize: PART_SIZE,
                parts,
            })
        }

        const uploadUrl = await getPresignedUploadUrl(storagePath, undefined, 7200)

        return NextResponse.json({
            isMultipart: false,
            uploadUrl,
            storagePath,
            fileType,
        })
    } catch (error: any) {
        console.error("Direct results presigned url error:", error)
        return NextResponse.json({ error: error.message || "Error al generar enlace de carga presignado" }, { status: 500 })
    }
}
