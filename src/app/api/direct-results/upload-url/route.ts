import { NextRequest, NextResponse } from "next/server"
import { getPresignedUploadUrl } from "@/lib/minio"
import { createServerClient } from "@supabase/ssr"

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { fileName } = body

        if (!fileName) {
            return NextResponse.json({ error: "Falta el nombre del archivo" }, { status: 400 })
        }

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll() { return req.cookies.getAll() }, setAll() { } } }
        )
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        const timestamp = Date.now()
        const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
        const storagePath = `direct/${timestamp}_${safeName}`

        const lowerName = fileName.toLowerCase()
        const isDicom = lowerName.endsWith(".zip") || lowerName.endsWith(".dcm")
        const fileType = isDicom ? "DICOM_ZIP" : "PDF"

        const uploadUrl = await getPresignedUploadUrl(storagePath, undefined, 7200)

        return NextResponse.json({
            uploadUrl,
            storagePath,
            fileType,
        })
    } catch (error: any) {
        console.error("Direct results presigned url error:", error)
        return NextResponse.json({ error: error.message || "Error al generar enlace de carga presignado" }, { status: 500 })
    }
}
