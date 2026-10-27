import { NextRequest, NextResponse } from "next/server"
import { getPresignedUploadUrl } from "@/lib/minio"
import { createServerClient } from "@supabase/ssr"

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { orderId, patientId, labId, fileName, performedAt } = body

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

        // Generate safe unique storage path
        const timestamp = Date.now()
        const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
        const filePath = `${labId}/${patientId}/${orderId}/${timestamp}_${safeName}`

        const lowerName = fileName.toLowerCase()
        const isDicom = lowerName.endsWith(".zip") || lowerName.endsWith(".dcm")
        const fileType = isDicom ? "DICOM_ZIP" : "PDF"

        // Generate Presigned PUT URL for direct client-to-MinIO upload (bypasses Vercel 4.5MB limit)
        const uploadUrl = await getPresignedUploadUrl(filePath, undefined, 7200)

        return NextResponse.json({
            uploadUrl,
            filePath,
            fileType,
        })
    } catch (error: any) {
        console.error("Error generating presigned upload URL:", error)
        return NextResponse.json({ error: error.message || "Error al generar enlace de carga presignado" }, { status: 500 })
    }
}
