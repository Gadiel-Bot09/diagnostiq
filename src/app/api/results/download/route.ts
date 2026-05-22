import { NextRequest, NextResponse } from "next/server"
import { getPresignedDownloadUrl } from "@/lib/minio"
import { createServerClient } from "@supabase/ssr"

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url)
        const fileId = url.searchParams.get("fileId")

        if (!fileId) {
            return NextResponse.json({ error: "fileId requerido" }, { status: 400 })
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

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

        // Get file metadata (RLS will automatically restrict this query to allowed files only)
        const { data: file, error } = await supabase
            .from("result_files")
            .select("file_path, file_name, order_id, lab_id")
            .eq("id", fileId)
            .single()

        if (error || !file) {
            return NextResponse.json({ error: "Archivo no encontrado o acceso denegado" }, { status: 404 })
        }

        // Generate MinIO presigned URL (valid for 1 hour)
        const downloadUrl = await getPresignedDownloadUrl(file.file_path, 3600)

        // Log audit event
        await supabase.from("audit_events").insert({
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
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
