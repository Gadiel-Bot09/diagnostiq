import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { uploadToMinio, getPresignedDownloadUrl } from "@/lib/minio"

export async function POST(req: NextRequest) {
    try {
        // 1. Authenticate user
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll() { return req.cookies.getAll() }, setAll() { } } }
        )
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        // 2. Read file from FormData
        const formData = await req.formData()
        const file = formData.get("file") as File | null
        if (!file) {
            return NextResponse.json({ error: "No se proporcionó ningún archivo de imagen" }, { status: 400 })
        }

        // Validate image type
        if (!file.type.startsWith("image/")) {
            return NextResponse.json({ error: "El archivo debe ser una imagen (PNG, JPG, SVG, WEBP)" }, { status: 400 })
        }

        // 3. Convert to Buffer
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // 4. Upload to MinIO
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_")
        const storagePath = `lab-logos/${user.id}/${Date.now()}_${safeName}`
        await uploadToMinio(storagePath, buffer, file.type)

        // 5. Generate presigned URL for preview (valid for 7 days) and Base64 fallback for canvas drawing
        const presignedUrl = await getPresignedDownloadUrl(storagePath, 86400 * 7, true)
        const base64Url = `data:${file.type};base64,${buffer.toString("base64")}`

        return NextResponse.json({
            success: true,
            storagePath,
            url: presignedUrl,
            base64Url,
            message: "Logotipo almacenado exitosamente en MinIO"
        })
    } catch (error: any) {
        console.error("Error uploading lab logo to MinIO:", error)
        return NextResponse.json(
            { error: error.message || "Error al subir el logotipo a MinIO" },
            { status: 500 }
        )
    }
}
