// @ts-nocheck
"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    FileText,
    Download,
    Microscope,
    Clock,
    CheckCircle2,
    Search,
    Eye,
    Building2,
    CalendarDays,
    ChevronRight,
    ChevronDown,
    Loader2,
    Sparkles,
    Info,
    Folder,
    FolderOpen,
    Calendar,
    X,
    Filter,
    RotateCcw,
    Layers,
} from "lucide-react"
import Link from "next/link"

import { createClient } from "@/lib/supabase/client"
import { PasswordChangeBanner } from "@/components/portal/PasswordChangeBanner"
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal"
import { PdfPreviewModal } from "@/components/common/PdfPreviewModal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"

// Paleta rotativa por tipo de examen (colores del logo DiagnostiQ)
const PALETTE = [
    { soft: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: "bg-indigo-100 text-indigo-600" },
    { soft: "bg-cyan-50 text-cyan-700 border-cyan-200", icon: "bg-cyan-100 text-cyan-600" },
    { soft: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "bg-emerald-100 text-emerald-600" },
    { soft: "bg-violet-50 text-violet-700 border-violet-200", icon: "bg-violet-100 text-violet-600" },
    { soft: "bg-amber-50 text-amber-700 border-amber-200", icon: "bg-amber-100 text-amber-600" },
    { soft: "bg-rose-50 text-rose-700 border-rose-200", icon: "bg-rose-100 text-rose-600" },
]

function safeDate(value?: string | null, pattern = "d 'de' MMM yyyy") {
    if (!value) return null
    const clean = value.length === 10 ? value + "T00:00:00" : value
    const d = new Date(clean)
    if (isNaN(d.getTime())) return null
    return format(d, pattern, { locale: es })
}

interface ExamItem {
    id: string
    name: string
    category?: string | null
    status: string
    file: any | null
}

function getExamsForOrder(order: any): ExamItem[] {
    const files = order.result_files || []

    // 1. Caso de examen directo
    if (order.direct_exam_name) {
        const file = files.length > 0
            ? files.reduce((a: any, b: any) => ((b.version || 0) > (a.version || 0) ? b : a))
            : null
        return [{
            id: `direct-${order.id}`,
            name: order.direct_exam_name,
            category: "Resultado Directo",
            status: file ? "COMPLETED" : (order.status || "PENDING"),
            file,
        }]
    }

    // 2. Orden normal con order_tests
    const orderTests = order.order_tests || []
    if (orderTests.length > 0) {
        return orderTests.map((ot: any) => {
            const testName = ot?.tests?.name || "Examen"
            const category = ot?.tests?.category || null

            let file: any = null

            // A. Buscar por file_id en result_summary_json
            if (ot.result_summary_json?.file_id) {
                file = files.find((f: any) => f.id === ot.result_summary_json.file_id) || null
            }

            // B. Buscar por order_test_id en result_files
            if (!file) {
                const matchingFiles = files.filter((f: any) => f.order_test_id === ot.id)
                if (matchingFiles.length > 0) {
                    file = matchingFiles.reduce((a: any, b: any) => ((b.version || 0) > (a.version || 0) ? b : a))
                }
            }

            // C. Fallback: Si la orden solo tiene 1 examen o 1 archivo y está completado
            if (!file && orderTests.length === 1 && files.length > 0) {
                file = files.reduce((a: any, b: any) => ((b.version || 0) > (a.version || 0) ? b : a))
            } else if (!file && ot.status === "COMPLETED" && files.length === 1) {
                file = files[0]
            }

            const isCompleted = ot.status === "COMPLETED" || !!file

            return {
                id: ot.id,
                name: testName,
                category,
                status: isCompleted ? "COMPLETED" : "PENDING",
                file,
            }
        })
    }

    // 3. Fallback para órdenes legacy con archivos
    if (files.length > 0) {
        return files.map((f: any, idx: number) => ({
            id: f.id || `file-${idx}`,
            name: f.file_name.replace(/\.[^/.]+$/, ""),
            category: "General",
            status: "COMPLETED",
            file: f,
        }))
    }

    return [{
        id: `empty-${order.id}`,
        name: "Exámenes de la orden",
        category: null,
        status: order.status || "PENDING",
        file: null,
    }]
}

export default function PatientDashboard() {
    const supabase = createClient()
    const { toast } = useToast()

    // Filtros
    const [search, setSearch] = useState("")
    const [dateFilter, setDateFilter] = useState("")
    const [statusFilter, setStatusFilter] = useState<"ALL" | "READY" | "PENDING">("ALL")
    const [examFilter, setExamFilter] = useState<string>("ALL")

    // Estado de carpetas (ordenId -> abierto/cerrado)
    const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({})

    const [loadingKey, setLoadingKey] = useState<string | null>(null)
    const [preview, setPreview] = useState<{ url: string; name: string; subtitle?: string } | null>(null)

    const { data: orders = [], isLoading } = useQuery({
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

    // Lista de todas las órdenes con sus exámenes procesados
    const processedOrders = useMemo(() => {
        return orders.map((order: any) => {
            const exams = getExamsForOrder(order)
            const readyCount = exams.filter(e => !!e.file).length
            const totalCount = exams.length
            const isAllReady = totalCount > 0 && readyCount === totalCount

            // Fecha de realización representativa (de la orden o del primer archivo)
            const perfDate = order.performed_at
                ? order.performed_at.slice(0, 10)
                : (exams.find(e => e.file?.performed_at)?.file?.performed_at?.slice(0, 10) || null)

            const orderDate = order.ordered_at
                ? new Date(order.ordered_at).toISOString().slice(0, 10)
                : null

            return {
                ...order,
                exams,
                readyCount,
                totalCount,
                isAllReady,
                perfDate,
                orderDate,
            }
        })
    }, [orders])

    // Tipos de examen únicos presentes en las órdenes
    const allUniqueExamNames = useMemo(() => {
        const set = new Set<string>()
        processedOrders.forEach((o: any) => {
            o.exams.forEach((e: any) => set.add(e.name))
        })
        return Array.from(set).sort()
    }, [processedOrders])

    // Asignación de colores por nombre de examen
    const colorOf = (name: string) => PALETTE[Math.max(0, allUniqueExamNames.indexOf(name)) % PALETTE.length]

    // Aplicación de filtros: búsqueda de texto, fecha, estado y tipo de examen
    const filteredOrders = useMemo(() => {
        return processedOrders.filter((order: any) => {
            // 1. Filtro por fecha de realización o de orden
            if (dateFilter) {
                const matchesDate =
                    order.perfDate === dateFilter ||
                    order.orderDate === dateFilter ||
                    (order.result_files || []).some((f: any) => f.performed_at?.slice(0, 10) === dateFilter)

                if (!matchesDate) return false
            }

            // 2. Filtro de búsqueda (número de orden, laboratorio o nombre de examen)
            if (search.trim()) {
                const term = search.trim().toLowerCase()
                const orderNum = (order.order_number || "").toLowerCase()
                const labName = (order.labs?.name || "").toLowerCase()
                const directName = (order.direct_exam_name || "").toLowerCase()
                const examMatches = order.exams.some((e: any) =>
                    e.name.toLowerCase().includes(term) ||
                    (e.category || "").toLowerCase().includes(term)
                )

                if (!orderNum.includes(term) && !labName.includes(term) && !directName.includes(term) && !examMatches) {
                    return false
                }
            }

            // 3. Filtro por estado
            if (statusFilter === "READY" && order.readyCount === 0) return false
            if (statusFilter === "PENDING" && order.isAllReady) return false

            // 4. Filtro por tipo de examen
            if (examFilter !== "ALL") {
                const hasExam = order.exams.some((e: any) => e.name === examFilter)
                if (!hasExam) return false
            }

            return true
        })
    }, [processedOrders, search, dateFilter, statusFilter, examFilter])

    // Métricas para contadores
    const totalOrders = processedOrders.length
    const readyOrdersCount = processedOrders.filter((o: any) => o.readyCount > 0).length
    const pendingOrdersCount = processedOrders.filter((o: any) => !o.isAllReady).length
    const totalExamsReady = processedOrders.reduce((acc: number, o: any) => acc + o.readyCount, 0)

    const hasActiveFilters = Boolean(search.trim() || dateFilter || statusFilter !== "ALL" || examFilter !== "ALL")

    const resetFilters = () => {
        setSearch("")
        setDateFilter("")
        setStatusFilter("ALL")
        setExamFilter("ALL")
    }

    // Toggle de carpeta individual (por defecto abiertas si no se han tocado)
    const isOrderOpen = (orderId: string) => {
        if (expandedOrders[orderId] !== undefined) return expandedOrders[orderId]
        return true // abiertas por defecto para ver todos los exámenes de inmediato
    }

    const toggleOrder = (orderId: string) => {
        setExpandedOrders(prev => ({
            ...prev,
            [orderId]: !isOrderOpen(orderId),
        }))
    }

    const expandAll = () => {
        const allOpen: Record<string, boolean> = {}
        filteredOrders.forEach((o: any) => { allOpen[o.id] = true })
        setExpandedOrders(allOpen)
    }

    const collapseAll = () => {
        const allClosed: Record<string, boolean> = {}
        filteredOrders.forEach((o: any) => { allClosed[o.id] = false })
        setExpandedOrders(allClosed)
    }

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

    // Abrir visor PDF para un examen específico
    const openResult = async (order: any, exam: ExamItem) => {
        if (!exam.file) {
            toast({
                title: "Examen en proceso",
                description: `El resultado para "${exam.name}" todavía está siendo procesado por el laboratorio.`,
            })
            return
        }

        const key = `${order.id}:${exam.id}`
        setLoadingKey(key)
        try {
            const url = await fetchUrl(exam.file.id, true)
            const performed = safeDate(exam.file.performed_at || order.performed_at, "dd/MM/yyyy")
            const uploaded = safeDate(exam.file.uploaded_at, "dd/MM/yyyy")
            setPreview({
                url,
                name: `${exam.name} · #${order.order_number}`,
                subtitle: [
                    performed && `Realizado: ${performed}`,
                    uploaded && `Cargado: ${uploaded}`,
                ].filter(Boolean).join("  ·  "),
            })
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo abrir", description: e.message })
        } finally {
            setLoadingKey(null)
        }
    }

    // Descargar PDF de un examen
    const downloadResult = async (e: React.MouseEvent, order: any, exam: ExamItem) => {
        e.stopPropagation()
        if (!exam.file) return
        try {
            const url = await fetchUrl(exam.file.id, false)
            window.open(url, "_blank")
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error de descarga", description: err.message })
        }
    }

    // Descargar todos los resultados listos de una orden
    const downloadAllOrderFiles = async (order: any) => {
        const readyExams = order.exams.filter((e: any) => !!e.file)
        if (readyExams.length === 0) return

        toast({
            title: "Descargando resultados",
            description: `Iniciando la descarga de ${readyExams.length} archivo(s)...`,
        })

        for (const ex of readyExams) {
            try {
                const url = await fetchUrl(ex.file.id, false)
                window.open(url, "_blank")
            } catch (err: any) {
                console.error("Error al descargar:", err)
            }
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50/70 via-slate-50 to-cyan-50/60 pb-12">
            {/* Header Superior */}
            <header className="sticky top-0 z-20 border-b border-indigo-100 bg-white/85 backdrop-blur-md shadow-xs">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-emerald-400" />
                <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between lg:px-6">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-500/25">
                            <Microscope className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-slate-900">Mis Resultados Médicos</h1>
                            <p className="text-xs text-slate-500">Expedientes organizados por número de orden</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                        {isLoadingUser ? (
                            <Skeleton className="h-8 w-32" />
                        ) : userProfile && (
                            <div className="hidden text-right sm:block">
                                <p className="text-sm font-semibold text-indigo-700 leading-tight">{userProfile.labName}</p>
                                <p className="text-[11px] font-medium text-slate-500 truncate max-w-[180px]">{userProfile.full_name}</p>
                            </div>
                        )}
                        <div className="flex items-center gap-2 border-l border-indigo-100 pl-3">
                            <ChangePasswordModal />
                            <Button variant="outline" size="sm" onClick={handleSignOut} className="text-xs h-9">
                                Cerrar Sesión
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 lg:px-6">
                <PasswordChangeBanner />

                {/* Tarjetas de Resumen KPI */}
                <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 p-4 text-white shadow-md shadow-indigo-500/15">
                        <div className="flex items-center justify-between opacity-80 text-xs font-medium">
                            <span>Órdenes / Expedientes</span>
                            <Folder className="h-4 w-4" />
                        </div>
                        <p className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight">{totalOrders}</p>
                    </div>

                    <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4 text-white shadow-md shadow-emerald-500/15">
                        <div className="flex items-center justify-between opacity-80 text-xs font-medium">
                            <span>Exámenes con resultado</span>
                            <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <p className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight">{totalExamsReady}</p>
                    </div>

                    <div className="col-span-2 rounded-2xl bg-gradient-to-br from-cyan-600 to-sky-600 p-4 text-white shadow-md shadow-cyan-500/15 sm:col-span-1">
                        <div className="flex items-center justify-between opacity-80 text-xs font-medium">
                            <span>Tipos de examen</span>
                            <Layers className="h-4 w-4" />
                        </div>
                        <p className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight">{allUniqueExamNames.length}</p>
                    </div>
                </section>

                {/* Bloque de Búsqueda y Filtros */}
                <section className="space-y-4 rounded-2xl border border-indigo-100/80 bg-white p-4 sm:p-5 shadow-sm">
                    {/* Fila 1: Buscador de texto + Selector de fecha */}
                    <div className="grid gap-3 sm:grid-cols-12">
                        {/* Buscador de número de orden o examen */}
                        <div className="relative sm:col-span-7">
                            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar por número de orden (ej: #20261017-1555), examen..."
                                className="h-11 rounded-xl border-indigo-100 bg-slate-50/60 pl-10 pr-9 text-sm focus-visible:bg-white"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                    title="Borrar búsqueda"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>

                        {/* Filtro por fecha de realización */}
                        <div className="relative sm:col-span-5">
                            <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-1.5 focus-within:bg-white focus-within:border-indigo-300 transition-all">
                                <Calendar className="h-4 w-4 text-indigo-600 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <label htmlFor="portalDateFilter" className="block text-[10px] font-bold uppercase tracking-wider text-indigo-900/80 leading-none">
                                        Fecha de examen
                                    </label>
                                    <input
                                        id="portalDateFilter"
                                        type="date"
                                        value={dateFilter}
                                        onChange={(e) => setDateFilter(e.target.value)}
                                        className="w-full bg-transparent text-xs font-semibold text-slate-800 outline-none cursor-pointer"
                                    />
                                </div>
                                {dateFilter && (
                                    <button
                                        onClick={() => setDateFilter("")}
                                        className="rounded-full p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"
                                        title="Limpiar fecha"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Fila 2: Filtro por estado y Tipo de Examen */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-slate-100">
                        {/* Estado: Todas / Listas / En proceso */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                                <Filter className="h-3 w-3" /> Estado:
                            </span>
                            <button
                                onClick={() => setStatusFilter("ALL")}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                                    statusFilter === "ALL"
                                        ? "bg-slate-900 text-white shadow-xs"
                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                            >
                                Todas ({totalOrders})
                            </button>
                            <button
                                onClick={() => setStatusFilter("READY")}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                                    statusFilter === "READY"
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                                }`}
                            >
                                ✓ Con resultados ({readyOrdersCount})
                            </button>
                            <button
                                onClick={() => setStatusFilter("PENDING")}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                                    statusFilter === "PENDING"
                                        ? "bg-amber-600 text-white shadow-xs"
                                        : "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200"
                                }`}
                            >
                                ⏳ En proceso ({pendingOrdersCount})
                            </button>
                        </div>

                        {/* Botones de expandir / colapsar carpetas */}
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                            <button
                                onClick={expandAll}
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                                Abrir todas
                            </button>
                            <span className="text-slate-300">·</span>
                            <button
                                onClick={collapseAll}
                                className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
                            >
                                Plegar todas
                            </button>
                        </div>
                    </div>

                    {/* Fila 3: Filtro rápido por tipo de examen */}
                    {allUniqueExamNames.length > 1 && (
                        <div className="space-y-1.5 pt-2 border-t border-slate-100">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Filtrar por tipo de examen:
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                <button
                                    onClick={() => setExamFilter("ALL")}
                                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                                        examFilter === "ALL"
                                            ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                    }`}
                                >
                                    Todos los tipos
                                </button>
                                {allUniqueExamNames.map((examName) => {
                                    const count = processedOrders.filter((o: any) =>
                                        o.exams.some((e: any) => e.name === examName)
                                    ).length
                                    const active = examFilter === examName
                                    const color = colorOf(examName)
                                    return (
                                        <button
                                            key={examName}
                                            onClick={() => setExamFilter(active ? "ALL" : examName)}
                                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                                                active
                                                    ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                                                    : `${color.soft} hover:shadow-xs`
                                            }`}
                                        >
                                            {examName} <span className="opacity-75 font-normal">({count})</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Banner cuando hay filtros activos */}
                    {hasActiveFilters && (
                        <div className="flex items-center justify-between rounded-xl bg-indigo-50/70 border border-indigo-100 px-3.5 py-2 text-xs text-indigo-900">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">Filtros aplicados:</span>
                                {search && <Badge variant="secondary" className="bg-white text-indigo-700">Texto: "{search}"</Badge>}
                                {dateFilter && <Badge variant="secondary" className="bg-white text-indigo-700">Fecha: {safeDate(dateFilter, "dd/MM/yyyy")}</Badge>}
                                {statusFilter !== "ALL" && (
                                    <Badge variant="secondary" className="bg-white text-indigo-700">
                                        {statusFilter === "READY" ? "Con resultados" : "En proceso"}
                                    </Badge>
                                )}
                                {examFilter !== "ALL" && <Badge variant="secondary" className="bg-white text-indigo-700">Examen: {examFilter}</Badge>}
                                <span className="text-slate-500 font-medium">({filteredOrders.length} {filteredOrders.length === 1 ? "orden encontrada" : "órdenes encontradas"})</span>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={resetFilters}
                                className="h-7 text-xs gap-1 text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100/60"
                            >
                                <RotateCcw className="h-3 w-3" /> Limpiar
                            </Button>
                        </div>
                    )}
                </section>

                {/* Listado de Órdenes en Forma de Carpeta */}
                {isLoading ? (
                    <div className="space-y-4">
                        <Skeleton className="h-36 w-full rounded-2xl" />
                        <Skeleton className="h-36 w-full rounded-2xl" />
                        <Skeleton className="h-36 w-full rounded-2xl" />
                    </div>
                ) : filteredOrders.length > 0 ? (
                    <div className="space-y-5">
                        {filteredOrders.map((order: any) => {
                            const isOpen = isOrderOpen(order.id)
                            const isComplete = order.isAllReady
                            const perfDateFormatted = safeDate(order.perfDate, "d 'de' MMMM 'de' yyyy")
                            const orderDateFormatted = safeDate(order.ordered_at, "d 'de' MMMM 'de' yyyy")

                            return (
                                <article
                                    key={order.id}
                                    className={`rounded-2xl border bg-white shadow-sm transition-all overflow-hidden ${
                                        isComplete
                                            ? "border-emerald-200/80 hover:border-emerald-300"
                                            : "border-indigo-100 hover:border-indigo-250"
                                    }`}
                                >
                                    {/* Cabecera de la Carpeta de Orden */}
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => toggleOrder(order.id)}
                                        onKeyDown={(e) => e.key === "Enter" && toggleOrder(order.id)}
                                        className={`p-4 sm:p-5 cursor-pointer transition-colors select-none ${
                                            isComplete ? "bg-emerald-50/20 hover:bg-emerald-50/40" : "bg-slate-50/40 hover:bg-indigo-50/30"
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            {/* Lado izquierdo: Icono de Carpeta + Número de Orden + Trazabilidad */}
                                            <div className="flex items-start gap-3.5 min-w-0">
                                                <div
                                                    className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 shadow-xs border ${
                                                        isComplete
                                                            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                                            : "bg-indigo-100 text-indigo-700 border-indigo-200"
                                                    }`}
                                                >
                                                    {isOpen ? <FolderOpen className="h-5 w-5" /> : <Folder className="h-5 w-5" />}
                                                </div>

                                                <div className="min-w-0 space-y-1">
                                                    <div className="flex items-center gap-2.5 flex-wrap">
                                                        <span className="font-mono text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                                                            Orden #{order.order_number}
                                                        </span>
                                                        {isComplete ? (
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-200">
                                                                <CheckCircle2 className="h-3 w-3" /> Todos los resultados listos
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                                                                <Clock className="h-3 w-3" /> En Proceso ({order.readyCount}/{order.totalCount} listos)
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                                        {order.labs?.name && (
                                                            <span className="flex items-center gap-1.5 font-medium text-slate-700">
                                                                <Building2 className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                                                                {order.labs.name}
                                                            </span>
                                                        )}
                                                        {perfDateFormatted && (
                                                            <span className="flex items-center gap-1 text-slate-600 font-medium">
                                                                <CalendarDays className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                                                                Realizado: <strong className="text-slate-800">{perfDateFormatted}</strong>
                                                            </span>
                                                        )}
                                                        {!perfDateFormatted && orderDateFormatted && (
                                                            <span className="flex items-center gap-1 text-slate-500">
                                                                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                                                Orden generada: {orderDateFormatted}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Lado derecho: Botón desplegable / Resumen */}
                                            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                                                <span className="text-xs text-slate-500 font-medium">
                                                    {order.totalCount} {order.totalCount === 1 ? "examen" : "exámenes"}
                                                </span>

                                                <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-indigo-100 bg-white text-xs font-semibold text-indigo-700 shadow-2xs group-hover:bg-indigo-50">
                                                    <span>{isOpen ? "Ocultar" : "Ver exámenes"}</span>
                                                    <ChevronDown
                                                        className={`h-4 w-4 transition-transform duration-200 ${
                                                            isOpen ? "rotate-180" : ""
                                                        }`}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Contenido desplegable de la Carpeta (Exámenes de la orden) */}
                                    {isOpen && (
                                        <div className="border-t border-slate-100 bg-slate-50/50 p-4 sm:p-5 space-y-4">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
                                                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                                                    <Microscope className="h-4 w-4 text-indigo-600" />
                                                    Exámenes solicitados en este expediente ({order.totalCount}):
                                                </p>

                                                {order.readyCount > 1 && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            downloadAllOrderFiles(order)
                                                        }}
                                                        className="h-7 text-xs gap-1.5 text-indigo-700 border-indigo-200 bg-white hover:bg-indigo-50 font-semibold shadow-2xs self-start sm:self-auto"
                                                    >
                                                        <Download className="h-3 w-3" /> Descargar todos los PDFs ({order.readyCount})
                                                    </Button>
                                                )}
                                            </div>

                                            {/* Lista de Exámenes individuales de la orden */}
                                            <div className="space-y-2.5">
                                                {order.exams.map((exam: ExamItem, idx: number) => {
                                                    const isReady = !!exam.file
                                                    const key = `${order.id}:${exam.id}`
                                                    const isOpening = loadingKey === key
                                                    const color = colorOf(exam.name)

                                                    return (
                                                        <div
                                                            key={exam.id}
                                                            className={`rounded-xl border p-3.5 sm:p-4 bg-white transition-all shadow-2xs ${
                                                                isReady
                                                                    ? "border-emerald-150 hover:border-emerald-300"
                                                                    : "border-slate-200 bg-white/80"
                                                            }`}
                                                        >
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                                {/* Título de examen y estado */}
                                                                <div className="flex items-start gap-3 min-w-0">
                                                                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${color.soft}`}>
                                                                        {idx + 1}
                                                                    </div>
                                                                    <div className="min-w-0 space-y-0.5">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <h3 className="font-bold text-sm text-slate-900 leading-snug">
                                                                                {exam.name}
                                                                            </h3>
                                                                            {isReady ? (
                                                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                                                                                    <CheckCircle2 className="h-3 w-3" /> Resultado Listo
                                                                                </span>
                                                                            ) : (
                                                                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                                                                                    <Clock className="h-3 w-3" /> En Proceso
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        {exam.category && (
                                                                            <p className="text-xs text-slate-500">{exam.category}</p>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Acciones para este examen */}
                                                                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                                                    {isReady ? (
                                                                        <>
                                                                            <Button
                                                                                onClick={() => openResult(order, exam)}
                                                                                className="h-8 px-3 text-xs gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold shadow-xs"
                                                                                disabled={isOpening}
                                                                            >
                                                                                {isOpening ? (
                                                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                                ) : (
                                                                                    <Eye className="h-3.5 w-3.5" />
                                                                                )}
                                                                                Ver Documento
                                                                            </Button>
                                                                            <Button
                                                                                variant="outline"
                                                                                size="sm"
                                                                                onClick={(e) => downloadResult(e, order, exam)}
                                                                                className="h-8 px-2.5 text-xs gap-1.5 text-slate-700 border-slate-200 hover:bg-slate-50"
                                                                            >
                                                                                <Download className="h-3.5 w-3.5" />
                                                                                <span className="hidden sm:inline">Descargar</span>
                                                                            </Button>
                                                                        </>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50/80 border border-amber-200/80 rounded-lg px-3 py-1 font-medium">
                                                                            <Clock className="h-3.5 w-3.5 text-amber-600" />
                                                                            El laboratorio está procesando este examen
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Metadatos del archivo cargado */}
                                                            {isReady && exam.file && (
                                                                <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                                                    <span className="flex items-center gap-1 font-medium text-slate-700 truncate max-w-[240px]">
                                                                        <FileText className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                                                                        {exam.file.file_name}
                                                                    </span>
                                                                    <span>v{exam.file.version}</span>
                                                                    {exam.file.size_bytes && (
                                                                        <span>{(exam.file.size_bytes / 1024).toFixed(0)} KB</span>
                                                                    )}
                                                                    {exam.file.uploaded_at && (
                                                                        <span>Cargado: {safeDate(exam.file.uploaded_at)}</span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>

                                            {/* Pie de la Carpeta */}
                                            <div className="pt-2 px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-200/60 text-xs text-slate-500">
                                                <span className="text-[11px] text-slate-400">
                                                    Identificador de orden: #{order.order_number}
                                                </span>
                                                <Link
                                                    href={`/portal/orders/${order.id}`}
                                                    className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                                                >
                                                    Ver trazabilidad y detalle completo de la orden
                                                    <ChevronRight className="h-3.5 w-3.5" />
                                                </Link>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            )
                        })}
                    </div>
                ) : (
                    <div className="space-y-3 rounded-2xl border border-dashed border-indigo-200 bg-white/80 py-16 text-center shadow-xs">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
                            {hasActiveFilters ? <Search className="h-6 w-6" /> : <Folder className="h-6 w-6" />}
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">
                            {hasActiveFilters ? "No se encontraron expedientes con estos filtros" : "No tienes órdenes registradas aún"}
                        </h3>
                        <p className="mx-auto max-w-sm text-xs text-slate-500">
                            {hasActiveFilters
                                ? "Prueba a cambiar el número de orden, la fecha seleccionada o los filtros de estado."
                                : "Tus resultados y órdenes médicas aparecerán aquí tan pronto como el laboratorio las registre."}
                        </p>
                        {hasActiveFilters && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={resetFilters}
                                className="mt-2 text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                            >
                                Restablecer todos los filtros
                            </Button>
                        )}
                    </div>
                )}

                <div className="rounded-xl border border-indigo-100 bg-white/70 p-3.5 text-xs text-slate-500 flex items-start gap-2.5">
                    <Info className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                    <span>
                        Para interpretar adecuadamente estos resultados, consulte con su médico tratante. No suspenda ni modifique tratamientos basándose únicamente en esta información.
                    </span>
                </div>
            </main>

            {/* Modal de Previsualización Oficial de PDF */}
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
