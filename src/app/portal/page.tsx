// @ts-nocheck
"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    FileText, Download, Microscope, Clock, CheckCircle2, Search, Eye,
    Building2, CalendarDays, UploadCloud, ChevronRight, Loader2, Sparkles, Info,
} from "lucide-react"
import Link from "next/link"

import { createClient } from "@/lib/supabase/client"
import { PasswordChangeBanner } from "@/components/portal/PasswordChangeBanner"
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal"
import { PdfPreviewModal } from "@/components/common/PdfPreviewModal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"

const GENERAL_EXAM = "Otros resultados"

// Paleta rotativa por tipo de examen (colores del logo: índigo, azul, cian, esmeralda)
const PALETTE = [
    { bar: "from-indigo-500 to-blue-500", soft: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: "bg-indigo-100 text-indigo-600" },
    { bar: "from-cyan-500 to-sky-500", soft: "bg-cyan-50 text-cyan-700 border-cyan-200", icon: "bg-cyan-100 text-cyan-600" },
    { bar: "from-emerald-500 to-teal-500", soft: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "bg-emerald-100 text-emerald-600" },
    { bar: "from-violet-500 to-fuchsia-500", soft: "bg-violet-50 text-violet-700 border-violet-200", icon: "bg-violet-100 text-violet-600" },
    { bar: "from-amber-500 to-orange-500", soft: "bg-amber-50 text-amber-700 border-amber-200", icon: "bg-amber-100 text-amber-600" },
    { bar: "from-rose-500 to-pink-500", soft: "bg-rose-50 text-rose-700 border-rose-200", icon: "bg-rose-100 text-rose-600" },
]

function safeDate(value?: string | null, pattern = "d 'de' MMM yyyy") {
    if (!value) return null
    const d = new Date(value.length === 10 ? value + "T00:00:00" : value)
    if (isNaN(d.getTime())) return null
    return format(d, pattern, { locale: es })
}

function fileForExam(order: any, examName: string) {
    const tests = order.order_tests || []
    const ot = tests.find((t: any) => t?.tests?.name === examName)
    const files = order.result_files || []
    if (files.length === 0) return null

    // 1. Direct match by ot.result_summary_json?.file_id
    if (ot?.result_summary_json?.file_id) {
        const found = files.find((f: any) => f.id === ot.result_summary_json.file_id)
        if (found) return found
    }

    // 2. Direct match by order_test_id if present on file
    if (ot) {
        const matchingFiles = files.filter((f: any) => f.order_test_id === ot.id)
        if (matchingFiles.length > 0) {
            return matchingFiles.reduce((a: any, b: any) => ((b.version || 0) > (a.version || 0) ? b : a))
        }
    }

    // 3. Fallback for single-exam orders or direct results
    if (order.direct_exam_name || tests.length <= 1) {
        return files.reduce((a: any, b: any) => ((b.version || 0) > (a.version || 0) ? b : a))
    }

    // 4. If test is COMPLETED and only 1 file exists in the order
    if (ot?.status === 'COMPLETED' && files.length === 1) {
        return files[0]
    }

    return null
}

function examNamesOf(order: any): string[] {
    if (order.direct_exam_name) return [order.direct_exam_name]
    const names = (order.order_tests || [])
        .map((ot: any) => ot?.tests?.name)
        .filter(Boolean)
    return names.length > 0 ? Array.from(new Set(names)) : [GENERAL_EXAM]
}

export default function PatientDashboard() {
    const supabase = createClient()
    const { toast } = useToast()
    const [search, setSearch] = useState("")
    const [activeExam, setActiveExam] = useState<string>("ALL")
    const [loadingKey, setLoadingKey] = useState<string | null>(null)
    const [preview, setPreview] = useState<{ url: string; name: string; subtitle?: string } | null>(null)

    const { data: orders, isLoading } = useQuery({
        queryKey: ["patient-orders"],
        queryFn: async () => {
            const res = await fetch("/api/portal/orders")
            if (!res.ok) throw new Error("Error al cargar órdenes")
            return res.json()
        },
    })

    const { data: userProfile, isLoading: isLoadingUser } = useQuery({
        queryKey: ["patient-profile"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return null

            const { data: profile } = await supabase
                .from("profiles")
                .select(`full_name, labs (name)`)
                .eq("id", user.id)
                .single()

            let labName = (profile?.labs as any)?.name

            if (!labName) {
                const { data: accounts } = await supabase
                    .from("patient_accounts")
                    .select("labs (name)")
                    .eq("user_id", user.id)
                    .limit(1)

                if (accounts && accounts.length > 0) {
                    labName = (accounts[0].labs as any)?.name
                }
            }

            return { ...profile, labName: labName || "Laboratorio Clínico" } as any
        }
    })

    // Una "tarjeta" por (orden, tipo de examen), agrupadas por tipo de examen
    const groups = useMemo(() => {
        const term = search.trim().toLowerCase()
        const map = new Map<string, any[]>()
        for (const order of orders || []) {
            for (const exam of examNamesOf(order)) {
                if (term) {
                    const haystack = `${exam} ${order.order_number} ${order.labs?.name || ""}`.toLowerCase()
                    if (!haystack.includes(term)) continue
                }
                if (!map.has(exam)) map.set(exam, [])
                map.get(exam)!.push(order)
            }
        }
        return Array.from(map.entries())
            .map(([exam, list]) => ({ exam, list }))
            .sort((a, b) => b.list.length - a.list.length || a.exam.localeCompare(b.exam))
    }, [orders, search])

    const allExamNames = useMemo(() => {
        const set = new Set<string>()
        for (const order of orders || []) examNamesOf(order).forEach(n => set.add(n))
        return Array.from(set).sort()
    }, [orders])

    const colorOf = (exam: string) => PALETTE[Math.max(0, allExamNames.indexOf(exam)) % PALETTE.length]
    const visibleGroups = activeExam === "ALL" ? groups : groups.filter(g => g.exam === activeExam)
    const totalOrders = orders?.length || 0
    const readyCount = groups.reduce((acc, g) => acc + g.list.filter(o => !!fileForExam(o, g.exam)).length, 0)

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        window.location.href = "/portal/login"
    }

    const fetchUrl = async (fileId: string, inline: boolean) => {
        const res = await fetch(`/api/results/download?fileId=${fileId}${inline ? "&preview=true" : ""}`)
        const data = await res.json()
        if (!res.ok || !data.url) throw new Error(data.error || "No se pudo abrir el documento")
        return data.url as string
    }

    // Al tocar un registro se abre de inmediato el documento del examen específico
    const openResult = async (order: any, exam: string) => {
        const file = fileForExam(order, exam)
        if (!file) {
            toast({ title: "Aún en proceso", description: `El laboratorio todavía no ha cargado el resultado para ${exam}.` })
            return
        }
        const key = `${order.id}:${exam}`
        setLoadingKey(key)
        try {
            const url = await fetchUrl(file.id, true)
            const performed = safeDate(file.performed_at || order.performed_at, "dd/MM/yyyy")
            const uploaded = safeDate(file.uploaded_at, "dd/MM/yyyy")
            setPreview({
                url,
                name: `${exam} · #${order.order_number}`,
                subtitle: [performed && `Realizado: ${performed}`, uploaded && `Cargado: ${uploaded}`].filter(Boolean).join("  ·  "),
            })
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo abrir", description: e.message })
        } finally {
            setLoadingKey(null)
        }
    }

    const downloadResult = async (e: React.MouseEvent, order: any, exam: string) => {
        e.stopPropagation()
        const file = fileForExam(order, exam)
        if (!file) return
        try {
            const url = await fetchUrl(file.id, false)
            window.open(url, "_blank")
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error de descarga", description: err.message })
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50">
            {/* Header */}
            <header className="sticky top-0 z-20 border-b border-indigo-100 bg-white/80 backdrop-blur">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-emerald-400" />
                <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white shadow-lg shadow-indigo-500/30">
                            <Microscope className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-slate-900">Mis Resultados</h1>
                            <p className="text-xs text-slate-500">Toca un resultado para verlo al instante</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {isLoadingUser ? (
                            <Skeleton className="h-8 w-36" />
                        ) : userProfile && (
                            <div className="hidden text-right sm:block">
                                <p className="text-sm font-semibold text-indigo-700">{userProfile.labName}</p>
                                <p className="text-[11px] font-medium uppercase text-slate-500">{userProfile.full_name}</p>
                            </div>
                        )}
                        {userProfile && (
                            <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-sm font-bold uppercase text-white shadow md:flex">
                                {userProfile.full_name?.substring(0, 2)}
                            </div>
                        )}
                        <div className="flex items-center gap-2 border-l border-indigo-100 pl-3">
                            <ChangePasswordModal />
                            <Button variant="outline" size="sm" onClick={handleSignOut}>Cerrar Sesión</Button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
                <PasswordChangeBanner />

                {/* Resumen */}
                <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-500 p-4 text-white shadow-lg shadow-indigo-500/20">
                        <p className="text-xs font-medium text-indigo-100">Órdenes</p>
                        <p className="mt-1 text-3xl font-bold">{totalOrders}</p>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 p-4 text-white shadow-lg shadow-emerald-500/20">
                        <p className="text-xs font-medium text-emerald-100">Resultados listos</p>
                        <p className="mt-1 text-3xl font-bold">{readyCount}</p>
                    </div>
                    <div className="col-span-2 rounded-2xl bg-gradient-to-br from-cyan-500 to-sky-500 p-4 text-white shadow-lg shadow-cyan-500/20 sm:col-span-1">
                        <p className="text-xs font-medium text-cyan-100">Tipos de examen</p>
                        <p className="mt-1 text-3xl font-bold">{allExamNames.length}</p>
                    </div>
                </section>

                {/* Buscador + filtros por tipo de examen */}
                <section className="space-y-3 rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow-sm">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por examen, número de orden o laboratorio..."
                            className="h-11 rounded-xl border-indigo-100 bg-indigo-50/40 pl-9"
                        />
                    </div>
                    {allExamNames.length > 1 && (
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setActiveExam("ALL")}
                                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${activeExam === "ALL"
                                    ? "border-transparent bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md"
                                    : "border-indigo-100 bg-white text-slate-600 hover:bg-indigo-50"}`}
                            >
                                Todos
                            </button>
                            {allExamNames.map((exam) => {
                                const count = groups.find(g => g.exam === exam)?.list.length || 0
                                const active = activeExam === exam
                                return (
                                    <button
                                        key={exam}
                                        onClick={() => setActiveExam(active ? "ALL" : exam)}
                                        className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${active
                                            ? "border-transparent bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md"
                                            : `${colorOf(exam).soft} hover:shadow-sm`}`}
                                    >
                                        {exam} <span className="ml-1 opacity-70">{count}</span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </section>

                {/* Contenido agrupado */}
                {isLoading ? (
                    <div className="space-y-3">
                        <Skeleton className="h-24 w-full rounded-2xl" />
                        <Skeleton className="h-24 w-full rounded-2xl" />
                        <Skeleton className="h-24 w-full rounded-2xl" />
                    </div>
                ) : visibleGroups.length > 0 ? (
                    <div className="space-y-8">
                        {visibleGroups.map(({ exam, list }) => {
                            const color = colorOf(exam)
                            return (
                                <section key={exam} className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color.icon}`}>
                                            <Sparkles className="h-4 w-4" />
                                        </div>
                                        <h2 className="text-base font-bold text-slate-900">{exam}</h2>
                                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${color.soft}`}>
                                            {list.length} {list.length === 1 ? "resultado" : "resultados"}
                                        </span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-indigo-100 to-transparent" />
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-2">
                                        {list.map((order: any) => {
                                            const file = fileForExam(order, exam)
                                            const key = `${order.id}:${exam}`
                                            const isOpening = loadingKey === key
                                            const performed = safeDate(file?.performed_at || order.performed_at)
                                            const uploaded = safeDate(file?.uploaded_at)
                                            const ready = !!file
                                            return (
                                                <div
                                                    key={key}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => openResult(order, exam)}
                                                    onKeyDown={(e) => e.key === "Enter" && openResult(order, exam)}
                                                    className={`group relative overflow-hidden rounded-2xl border bg-white p-4 pl-5 shadow-sm transition-all ${ready
                                                        ? "cursor-pointer border-indigo-100 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10"
                                                        : "cursor-default border-slate-200 opacity-90"}`}
                                                >
                                                    <div className={`absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${ready ? color.bar : "from-slate-300 to-slate-200"}`} />
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0 space-y-1.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono text-sm font-bold text-slate-900">#{order.order_number}</span>
                                                                {ready ? (
                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                                                        <CheckCircle2 className="h-3 w-3" /> Resultado Listo
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                                                        <Clock className="h-3 w-3" /> En Proceso
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                                                                <Building2 className="h-3.5 w-3.5 shrink-0" /> {order.labs?.name}
                                                            </p>
                                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                                                {performed && (
                                                                    <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Realizado: <b className="text-slate-700">{performed}</b></span>
                                                                )}
                                                                {uploaded && (
                                                                    <span className="flex items-center gap-1"><UploadCloud className="h-3 w-3" /> Cargado: <b className="text-slate-700">{uploaded}</b></span>
                                                                )}
                                                                {!performed && !uploaded && (
                                                                    <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Orden: <b className="text-slate-700">{safeDate(order.ordered_at) || "—"}</b></span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex shrink-0 flex-col items-end gap-2">
                                                            {ready ? (
                                                                <span className={`flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-white shadow bg-gradient-to-r ${color.bar} transition-transform group-hover:scale-105`}>
                                                                    {isOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                                                                    Ver
                                                                </span>
                                                            ) : (
                                                                <span className="flex h-9 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-medium text-slate-500">
                                                                    <Clock className="h-4 w-4" /> En proceso
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                                                        <Link
                                                            href={`/portal/orders/${order.id}`}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-indigo-600"
                                                        >
                                                            Ver detalle de la orden <ChevronRight className="h-3 w-3" />
                                                        </Link>
                                                        {ready && (
                                                            <button
                                                                onClick={(e) => downloadResult(e, order, exam)}
                                                                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                                                            >
                                                                <Download className="h-3.5 w-3.5" /> Descargar
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </section>
                            )
                        })}
                    </div>
                ) : (
                    <div className="space-y-3 rounded-2xl border border-dashed border-indigo-200 bg-white/70 py-14 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-400">
                            {search ? <Search className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                        </div>
                        <h3 className="text-lg font-semibold text-slate-800">{search ? "Sin coincidencias" : "No hay órdenes"}</h3>
                        <p className="mx-auto max-w-sm text-sm text-slate-500">
                            {search
                                ? "Prueba con otro nombre de examen o número de orden."
                                : "Por ahora no tienes exámenes registrados. Si acabas de realizarte uno, espera a que el laboratorio lo registre."}
                        </p>
                    </div>
                )}

                <p className="flex items-start gap-2 rounded-xl bg-white/70 p-3 text-[11px] text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    Para interpretar correctamente estos resultados, consulta a tu médico tratante. No te automediques basándote en esta información.
                </p>
            </main>

            <PdfPreviewModal
                open={!!preview}
                onOpenChange={(open) => !open && setPreview(null)}
                title={preview?.name || ""}
                url={preview?.url || null}
                subtitle={preview?.subtitle}
            />
        </div>
    )
}
