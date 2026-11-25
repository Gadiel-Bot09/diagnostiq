import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { isValidCbctScene, type CbctClinicalScene } from "@/lib/cbct/clinicalScene"

const MAX_SCENE_BYTES = 512 * 1024 // 512 KB máx. por escena clínica JSON

async function authenticateUser(req: NextRequest) {
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return req.cookies.getAll()
                },
                setAll() {},
            },
        }
    )

    const {
        data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, role, lab_id")
        .eq("id", user.id)
        .single()

    return { user, profile }
}

async function authorizeFileAccess(
    userId: string,
    profile: { role?: string | null; lab_id?: string | null } | null,
    file: { lab_id: string; orders?: any }
): Promise<{ allowed: boolean; canEdit: boolean }> {
    const isLabUser = Boolean(profile && profile.role && profile.role !== "PATIENT")

    if (!isLabUser) {
        const { data: accounts } = await supabaseAdmin
            .from("patient_accounts")
            .select("patient_id")
            .eq("user_id", userId)

        const patientIds = (accounts || []).map((a: any) => a.patient_id)
        const orderPatientId = (file.orders as any)?.patient_id
        const allowed = Boolean(orderPatientId && patientIds.includes(orderPatientId))
        return { allowed, canEdit: false }
    }

    if (profile!.role === "SUPER_ADMIN" || profile!.lab_id === file.lab_id) {
        return { allowed: true, canEdit: true }
    }

    return { allowed: false, canEdit: false }
}

/**
 * GET /api/results/scene?fileId=<uuid>
 * Obtiene la escena clínica CBCT guardada (cortes preparados, arco dental, nervio y mediciones)
 * y determina si el usuario actual tiene permiso de edición.
 */
export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url)
        const fileId = url.searchParams.get("fileId")
        if (!fileId) {
            return NextResponse.json({ error: "fileId requerido" }, { status: 400 })
        }

        const auth = await authenticateUser(req)
        if (!auth) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const { data: file, error } = await supabaseAdmin
            .from("result_files")
            .select("id, lab_id, order_id, metadata_json, orders(patient_id)")
            .eq("id", fileId)
            .single()

        if (error || !file) {
            return NextResponse.json({ error: "Estudio no encontrado" }, { status: 404 })
        }

        const access = await authorizeFileAccess(auth.user.id, auth.profile, file)
        if (!access.allowed) {
            return NextResponse.json({ error: "Acceso denegado a este estudio" }, { status: 403 })
        }

        const meta = (file.metadata_json as Record<string, any>) || {}
        const rawScene = meta.cbct_scene ?? null
        const scene = isValidCbctScene(rawScene) ? rawScene : null

        return NextResponse.json({
            scene,
            canEdit: access.canEdit,
        })
    } catch (err: any) {
        console.error("[GET /api/results/scene] Error:", err)
        return NextResponse.json({ error: "Error interno al leer escena clínica" }, { status: 500 })
    }
}

/**
 * PUT /api/results/scene
 * Persiste la escena clínica CBCT (cortes específicos marcados, arco ajustado, nervio y mediciones)
 * dentro de `result_files.metadata_json.cbct_scene` con auditoría clínica.
 */
export async function PUT(req: NextRequest) {
    try {
        const auth = await authenticateUser(req)
        if (!auth) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const rawText = await req.text()
        if (rawText.length > MAX_SCENE_BYTES) {
            return NextResponse.json(
                { error: "La escena clínica supera el tamaño máximo permitido (512 KB)" },
                { status: 413 }
            )
        }

        let body: { fileId?: string; scene?: unknown }
        try {
            body = JSON.parse(rawText)
        } catch {
            return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
        }

        const { fileId, scene } = body
        if (!fileId || typeof fileId !== "string") {
            return NextResponse.json({ error: "fileId requerido" }, { status: 400 })
        }
        if (!isValidCbctScene(scene)) {
            return NextResponse.json({ error: "Formato de escena CBCT inválido" }, { status: 400 })
        }

        const { data: file, error } = await supabaseAdmin
            .from("result_files")
            .select("id, lab_id, order_id, file_name, metadata_json, orders(patient_id)")
            .eq("id", fileId)
            .single()

        if (error || !file) {
            return NextResponse.json({ error: "Estudio no encontrado" }, { status: 404 })
        }

        const access = await authorizeFileAccess(auth.user.id, auth.profile, file)
        if (!access.allowed || !access.canEdit) {
            return NextResponse.json(
                { error: "Solo personal clínico o del laboratorio autorizado puede guardar cortes y mediciones" },
                { status: 403 }
            )
        }

        const enrichedScene: CbctClinicalScene = {
            ...scene,
            version: 1,
            updatedAt: new Date().toISOString(),
            updatedById: auth.user.id,
            updatedByName: auth.profile?.full_name || auth.user.email || "Especialista",
            updatedByRole: auth.profile?.role || "STAFF",
        }

        const existingMeta =
            file.metadata_json && typeof file.metadata_json === "object"
                ? (file.metadata_json as Record<string, any>)
                : {}

        const nextMeta = {
            ...existingMeta,
            cbct_scene: enrichedScene,
        }

        const { error: updateErr } = await supabaseAdmin
            .from("result_files")
            .update({ metadata_json: nextMeta })
            .eq("id", fileId)

        if (updateErr) {
            console.error("[PUT /api/results/scene] Update error:", updateErr)
            return NextResponse.json({ error: "No se pudo guardar la escena clínica" }, { status: 500 })
        }

        // Registrar auditoría del guardado clínico
        try {
            await supabaseAdmin.from("audit_events").insert({
                lab_id: file.lab_id,
                actor_id: auth.user.id,
                action: "SAVE_CBCT_SCENE",
                entity_type: "RESULT_FILE",
                entity_id: fileId,
                details: {
                    file_name: file.file_name,
                    order_id: file.order_id,
                    saved_cuts_count: enrichedScene.savedCuts.length,
                    nerve_points_count: enrichedScene.nervePoints3D.length,
                    measurements_count: Object.values(enrichedScene.measurementsByView).reduce(
                        (acc, list) => acc + (Array.isArray(list) ? list.length : 0),
                        0
                    ),
                },
            })
        } catch {}

        return NextResponse.json({
            ok: true,
            scene: enrichedScene,
        })
    } catch (err: any) {
        console.error("[PUT /api/results/scene] Error:", err)
        return NextResponse.json({ error: "Error interno al guardar escena clínica" }, { status: 500 })
    }
}
