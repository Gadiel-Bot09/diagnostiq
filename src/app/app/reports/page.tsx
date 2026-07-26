// @ts-nocheck
"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { format, subDays, isAfter } from "date-fns"
import { es } from "date-fns/locale"
import {
    BarChart3,
    TrendingUp,
    Users,
    CheckCircle2,
    Clock,
    Activity,
    Award,
    Calendar,
    Download,
    Printer,
    FileSpreadsheet,
    FileText,
    Filter,
    Search,
    TestTube2,
    ShieldAlert,
    Sparkles,
    ArrowUpRight,
    UserCheck,
    Stethoscope
} from "lucide-react"

import { AdminLayout } from "@/components/layout/AdminLayout"
import { usePermissions } from "@/contexts/PermissionsContext"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"

export default function ReportsPage() {
    const supabase = createClient()
    const { toast } = useToast()
    const { hasPermission, isLoading: permsLoading } = usePermissions()

    const [dateRange, setDateRange] = useState<string>("all")
    const [searchQuery, setSearchQuery] = useState<string>("")
    const [activeTab, setActiveTab] = useState<string>("exams")
    const [statusFilter, setStatusFilter] = useState<string>("ALL")
    const [showPrintModal, setShowPrintModal] = useState<boolean>(false)

    // Fetch Lab ID (optional reference for tenant-scoped operations if needed)
    const { data: labId } = useQuery({
        queryKey: ["lab-id-reports"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return null
            const { data } = await supabase.from("profiles").select("lab_id").eq("id", user.id).maybeSingle()
            return data?.lab_id
        }
    })

    // Fetch Orders with Joined Data (reads all historical database records)
    const { data: orders = [], isLoading: ordersLoading } = useQuery({
        queryKey: ["reports-orders"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("orders")
                .select(`
                    id,
                    order_number,
                    status,
                    ordered_at,
                    is_direct,
                    direct_exam_name,
                    patient_id,
                    created_by,
                    patients (
                        id,
                        full_name,
                        document_type,
                        document_number,
                        email
                    ),
                    order_tests (
                        id,
                        status,
                        test_id,
                        tests (
                            name,
                            category,
                            code
                        )
                    ),
                    result_files (
                        id,
                        file_name,
                        uploaded_at
                    )
                `)
                .order("ordered_at", { ascending: false })

            if (error) throw error
            return data || []
        }
    })

    // Fetch Profiles (Staff/Users)
    const { data: staffProfiles = [] } = useQuery({
        queryKey: ["reports-staff"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, role, email, is_active")
            if (error) throw error
            return data || []
        }
    })

    // Filter Orders by Date and Status
    const filteredOrders = useMemo(() => {
        const now = new Date()
        let cutoffDate: Date | null = null

        if (dateRange === "7d") cutoffDate = subDays(now, 7)
        if (dateRange === "30d") cutoffDate = subDays(now, 30)
        if (dateRange === "90d") cutoffDate = subDays(now, 90)

        return orders.filter((order: any) => {
            // Date check
            if (cutoffDate && !isAfter(new Date(order.ordered_at), cutoffDate)) {
                return false
            }
            // Status check
            if (statusFilter !== "ALL" && order.status !== statusFilter) {
                return false
            }
            // Search query check
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase()
                const patientName = order.patients?.full_name?.toLowerCase() || ""
                const docNum = order.patients?.document_number?.toLowerCase() || ""
                const orderNum = order.order_number?.toLowerCase() || ""
                const directExam = order.direct_exam_name?.toLowerCase() || ""
                const testNames = order.order_tests?.map((t: any) => t.tests?.name?.toLowerCase() || "").join(" ") || ""

                if (!patientName.includes(q) && !docNum.includes(q) && !orderNum.includes(q) && !directExam.includes(q) && !testNames.includes(q)) {
                    return false
                }
            }
            return true
        })
    }, [orders, dateRange, statusFilter, searchQuery])

    // ──────────────── AGGREGATIONS ────────────────

    // 1. By Exam Type
    const examReports = useMemo(() => {
        const map = new Map<string, { name: string; category: string; code?: string; total: number; completed: number; pending: number }>()

        filteredOrders.forEach((order: any) => {
            const isCompleted = order.status === "COMPLETED"

            if (order.is_direct && order.direct_exam_name) {
                const key = order.direct_exam_name.trim()
                const existing = map.get(key) || { name: key, category: "Resultado Directo / Radiología", total: 0, completed: 0, pending: 0 }
                existing.total += 1
                if (isCompleted) existing.completed += 1
                else existing.pending += 1
                map.set(key, existing)
            } else if (order.order_tests && order.order_tests.length > 0) {
                order.order_tests.forEach((ot: any) => {
                    const testName = ot.tests?.name || "Examen Desconocido"
                    const category = ot.tests?.category || "General"
                    const code = ot.tests?.code || ""
                    const existing = map.get(testName) || { name: testName, category, code, total: 0, completed: 0, pending: 0 }
                    existing.total += 1
                    if (ot.status === "COMPLETED" || isCompleted) existing.completed += 1
                    else existing.pending += 1
                    map.set(testName, existing)
                })
            }
        })

        const arr = Array.from(map.values())
        arr.sort((a, b) => b.total - a.total)
        return arr
    }, [filteredOrders])

    // 2. By Patient
    const patientReports = useMemo(() => {
        const map = new Map<string, { id: string; name: string; document: string; email?: string; totalOrders: number; totalExams: number; completedOrders: number; lastVisit: string }>()

        filteredOrders.forEach((order: any) => {
            const p = order.patients
            if (!p) return
            const existing = map.get(p.id) || {
                id: p.id,
                name: p.full_name || "Sin nombre",
                document: `${p.document_type || ""} ${p.document_number || ""}`.trim(),
                email: p.email,
                totalOrders: 0,
                totalExams: 0,
                completedOrders: 0,
                lastVisit: order.ordered_at
            }

            existing.totalOrders += 1
            const examsInOrder = order.is_direct ? 1 : (order.order_tests?.length || 1)
            existing.totalExams += examsInOrder
            if (order.status === "COMPLETED") existing.completedOrders += 1
            if (new Date(order.ordered_at) > new Date(existing.lastVisit)) {
                existing.lastVisit = order.ordered_at
            }
            map.set(p.id, existing)
        })

        const arr = Array.from(map.values())
        arr.sort((a, b) => b.totalOrders - a.totalOrders)
        return arr
    }, [filteredOrders])

    // 3. By Staff / User
    const userReports = useMemo(() => {
        const map = new Map<string, { id: string; name: string; role: string; email?: string; active: boolean; ordersManaged: number; completedManaged: number }>()

        // Initialize with all known staff profiles in lab
        staffProfiles.forEach((prof: any) => {
            map.set(prof.id, {
                id: prof.id,
                name: prof.full_name || prof.email?.split("@")[0] || "Usuario",
                role: prof.role === "ADMIN" ? "Administrador" : prof.role === "LAB_STAFF" ? "Personal de Laboratorio" : prof.role === "DOCTOR" ? "Médico Remitente" : prof.role,
                email: prof.email,
                active: prof.is_active !== false,
                ordersManaged: 0,
                completedManaged: 0
            })
        })

        filteredOrders.forEach((order: any) => {
            const userId = order.created_by
            if (userId && map.has(userId)) {
                const item = map.get(userId)!
                item.ordersManaged += 1
                if (order.status === "COMPLETED") item.completedManaged += 1
                map.set(userId, item)
            } else if (userId) {
                const existing = map.get(userId) || {
                    id: userId,
                    name: "Usuario del Sistema",
                    role: "Personal",
                    active: true,
                    ordersManaged: 0,
                    completedManaged: 0
                }
                existing.ordersManaged += 1
                if (order.status === "COMPLETED") existing.completedManaged += 1
                map.set(userId, existing)
            }
        })

        const arr = Array.from(map.values())
        arr.sort((a, b) => b.ordersManaged - a.ordersManaged)
        return arr
    }, [filteredOrders, staffProfiles])

    // Summary KPIs
    const totalOrdersCount = filteredOrders.length
    const totalCompletedCount = filteredOrders.filter((o: any) => o.status === "COMPLETED").length
    const completionRate = totalOrdersCount > 0 ? Math.round((totalCompletedCount / totalOrdersCount) * 100) : 0
    const totalExamsCount = examReports.reduce((acc, curr) => acc + curr.total, 0)
    const topExamName = examReports[0]?.name || "Sin datos"

    // ──────────────── EXPORT FUNCTIONS ────────────────

    const getDateLabel = () => {
        if (dateRange === "7d") return "Últimos 7 días"
        if (dateRange === "30d") return "Últimos 30 días"
        if (dateRange === "90d") return "Últimos 90 días"
        return "Histórico Completo"
    }

    const handleExportCSV = () => {
        let csvContent = "\uFEFF" // UTF-8 BOM for Microsoft Excel Spanish character compatibility
        const sep = ";" // Semicolon works natively in Windows Excel (Spanish/LatAm locale)
        const dateStr = format(new Date(), "yyyy-MM-dd")

        if (activeTab === "exams") {
            csvContent += `Reporte de Exámenes Diagnósticos${sep}Período: ${getDateLabel()}\n`
            csvContent += `Examen / Prueba${sep}Categoría${sep}Código${sep}Total Realizadas${sep}Completadas${sep}Pendientes${sep}% Tasa Efectividad\n`
            examReports.forEach(item => {
                const eff = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0
                csvContent += `"${item.name}"${sep}"${item.category}"${sep}"${item.code || ''}"${sep}${item.total}${sep}${item.completed}${sep}${item.pending}${sep}${eff}%\n`
            })
        } else if (activeTab === "patients") {
            csvContent += `Reporte de Atenciones por Paciente${sep}Período: ${getDateLabel()}\n`
            csvContent += `Paciente${sep}Documento${sep}Email / Portal${sep}Total Órdenes${sep}Total Exámenes${sep}Órdenes Completadas${sep}Última Atención\n`
            patientReports.forEach(item => {
                const dateFormatted = item.lastVisit ? format(new Date(item.lastVisit), "dd/MM/yyyy HH:mm") : "-"
                csvContent += `"${item.name}"${sep}"${item.document}"${sep}"${item.email || 'Sin cuenta'}"${sep}${item.totalOrders}${sep}${item.totalExams}${sep}${item.completedOrders}${sep}"${dateFormatted}"\n`
            })
        } else if (activeTab === "users") {
            csvContent += `Reporte de Productividad por Personal / Usuario${sep}Período: ${getDateLabel()}\n`
            csvContent += `Usuario${sep}Rol${sep}Email${sep}Estado${sep}Órdenes Gestionadas${sep}Completadas\n`
            userReports.forEach(item => {
                csvContent += `"${item.name}"${sep}"${item.role}"${sep}"${item.email || ''}"${sep}"${item.active ? 'Activo' : 'Inactivo'}"${sep}${item.ordersManaged}${sep}${item.completedManaged}\n`
            })
        } else {
            // Detailed Orders
            csvContent += `Reporte General de Órdenes de Laboratorio${sep}Período: ${getDateLabel()}\n`
            csvContent += `N° Orden${sep}Fecha y Hora${sep}Paciente${sep}Documento${sep}Tipo / Examen${sep}Estado${sep}Archivos Subidos\n`
            filteredOrders.forEach((o: any) => {
                const dateFormatted = format(new Date(o.ordered_at), "dd/MM/yyyy HH:mm")
                const patientName = o.patients?.full_name || "Desconocido"
                const patientDoc = `${o.patients?.document_type || ''} ${o.patients?.document_number || ''}`.trim()
                const examInfo = o.is_direct ? (o.direct_exam_name || "Directo") : (o.order_tests?.map((t: any) => t.tests?.name).join(", ") || "General")
                const statusLabel = o.status === "COMPLETED" ? "Completado" : o.status === "PENDING" ? "Pendiente" : o.status
                const filesCount = o.result_files?.length || 0
                csvContent += `"${o.order_number}"${sep}"${dateFormatted}"${sep}"${patientName}"${sep}"${patientDoc}"${sep}"${examInfo}"${sep}"${statusLabel}"${sep}${filesCount}\n`
            })
        }

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.setAttribute("href", url)
        link.setAttribute("download", `reporte_diagnostiq_${activeTab}_${dateStr}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast({
            title: "📥 Archivo Excel (CSV) Generado",
            description: `Se descargó el reporte "${activeTab}" con formato compatible para Microsoft Excel.`,
        })
    }

    const handlePrintPDF = () => {
        const printContent = document.getElementById("report-printable-area")
        if (!printContent) {
            window.print()
            return
        }

        const printWindow = window.open("", "_blank", "width=900,height=950")
        if (!printWindow) {
            window.print()
            return
        }

        const tabTitle = activeTab === "exams" ? "Estadísticas de Exámenes Diagnósticos" :
            activeTab === "patients" ? "Resumen de Atenciones por Paciente" :
            activeTab === "users" ? "Productividad de Personal y Usuarios" : "Desglose General de Órdenes"

        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Reporte DiagnostiQ - ${tabTitle}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 28px; background: #ffffff; }
                    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0284c7; padding-bottom: 16px; margin-bottom: 24px; }
                    .logo-section { display: flex; align-items: center; gap: 10px; }
                    .logo-title { font-size: 26px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px; margin: 0; }
                    .logo-subtitle { font-size: 12px; color: #64748b; margin: 2px 0 0 0; text-transform: uppercase; font-weight: 600; }
                    .lab-meta { font-size: 12px; color: #475569; text-align: right; line-height: 1.5; }
                    .report-title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0; }
                    .report-period { font-size: 13px; color: #64748b; margin: 0 0 20px 0; font-weight: 500; }
                    .kpi-container { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
                    .kpi-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; background: #f8fafc; }
                    .kpi-label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
                    .kpi-val { font-size: 22px; font-weight: 800; color: #0284c7; margin-top: 6px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                    th { background-color: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 10px 12px; border-bottom: 2px solid #94a3b8; }
                    td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #1e293b; }
                    tr:nth-child(even) { background-color: #f8fafc; }
                    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: #e0f2fe; color: #0369a1; }
                    .badge-completed { background: #dcfce7; color: #15803d; }
                    .badge-pending { background: #fef9c3; color: #a16207; }
                    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none !important; }
                        tr { page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="logo-section">
                        <div>
                            <h1 class="logo-title">DiagnostiQ</h1>
                            <p class="logo-subtitle">Portal de Diagnóstico Médico & Laboratorio</p>
                        </div>
                    </div>
                    <div class="lab-meta">
                        <div><strong>Reporte Analítico de Laboratorio</strong></div>
                        <div>Fecha de emisión: ${format(new Date(), "dd/MM/yyyy HH:mm")}</div>
                        <div>Filtro: ${getDateLabel()}</div>
                    </div>
                </div>

                <h2 class="report-title">${tabTitle}</h2>
                <p class="report-period">Mostrando datos para el período seleccionado (${getDateLabel()}) · Total registros: ${
                    activeTab === "exams" ? examReports.length :
                    activeTab === "patients" ? patientReports.length :
                    activeTab === "users" ? userReports.length : filteredOrders.length
                }</p>

                <div class="kpi-container">
                    <div class="kpi-card">
                        <div class="kpi-label">Total Órdenes</div>
                        <div class="kpi-val">${totalOrdersCount}</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-label">Exámenes Evaluados</div>
                        <div class="kpi-val">${totalExamsCount}</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-label">Tasa de Efectividad</div>
                        <div class="kpi-val" style="color: #15803d;">${completionRate}%</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-label">Examen Top</div>
                        <div class="kpi-val" style="font-size: 16px; margin-top: 10px;">${topExamName}</div>
                    </div>
                </div>

                ${printContent.innerHTML}

                <div class="footer">
                    <div>Generado automáticamente por el Sistema de Laboratorio DiagnostiQ</div>
                    <div>Página confidencial para uso clínico y administrativo</div>
                </div>

                <script>
                    window.onload = () => {
                        setTimeout(() => {
                            window.print();
                        }, 400);
                    };
                </script>
            </body>
            </html>
        `)
        printWindow.document.close()
        setShowPrintModal(false)
    }

    if (!permsLoading && !hasPermission("reports", "view")) {
        return (
            <AdminLayout>
                <div className="max-w-md mx-auto mt-20 text-center space-y-4 p-8 border rounded-xl bg-card shadow-sm">
                    <ShieldAlert className="h-12 w-12 text-destructive mx-auto" />
                    <h2 className="text-xl font-bold text-destructive">Acceso Restringido</h2>
                    <p className="text-sm text-muted-foreground">No cuentas con los permisos necesarios para visualizar el módulo de reportes y estadísticas del laboratorio.</p>
                </div>
            </AdminLayout>
        )
    }

    return (
        <AdminLayout>
            <div className="space-y-6 pb-12">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-primary-foreground shadow-md">
                                <BarChart3 className="h-5 w-5" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight">Reportes y Analítica</h1>
                                <p className="text-sm text-muted-foreground">Monitorea métricas operativas, volumen de exámenes y productividad de tu equipo.</p>
                            </div>
                        </div>
                    </div>

                    {/* Action Bar (Filters & Exports) */}
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-lg border">
                            <Calendar className="h-4 w-4 text-muted-foreground ml-2 shrink-0" />
                            <Select value={dateRange} onValueChange={setDateRange}>
                                <SelectTrigger className="h-8 border-none bg-transparent shadow-none w-[150px] text-xs font-medium">
                                    <SelectValue placeholder="Período" />
                                </SelectTrigger>
                                <SelectContent align="end">
                                    <SelectItem value="7d">Últimos 7 días</SelectItem>
                                    <SelectItem value="30d">Últimos 30 días</SelectItem>
                                    <SelectItem value="90d">Últimos 90 días</SelectItem>
                                    <SelectItem value="all">Histórico Completo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-2 h-9 shadow-sm hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-colors">
                            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                            <span>Exportar Excel</span>
                        </Button>

                        <Button size="sm" onClick={() => setShowPrintModal(true)} className="gap-2 h-9 bg-gradient-to-r from-primary to-sky-600 shadow-sm hover:opacity-95 transition-opacity">
                            <Printer className="h-4 w-4" />
                            <span>Exportar PDF / Imprimir</span>
                        </Button>
                    </div>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Órdenes en Período</CardTitle>
                            <Activity className="h-4 w-4 text-primary" />
                        </CardHeader>
                        <CardContent>
                            {ordersLoading ? <Skeleton className="h-8 w-20" /> : (
                                <div className="flex items-baseline justify-between">
                                    <div className="text-2xl font-bold">{totalOrdersCount}</div>
                                    <Badge variant="secondary" className="text-[11px] font-normal bg-primary/10 text-primary gap-1">
                                        <TrendingUp className="h-3 w-3" /> {totalCompletedCount} listos
                                    </Badge>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-emerald-500 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tasa de Entrega</CardTitle>
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            {ordersLoading ? <Skeleton className="h-8 w-20" /> : (
                                <div className="flex items-baseline justify-between">
                                    <div className="text-2xl font-bold text-emerald-600">{completionRate}%</div>
                                    <span className="text-xs text-muted-foreground">de efectividad</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-sky-500 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Volumen Exámenes</CardTitle>
                            <TestTube2 className="h-4 w-4 text-sky-500" />
                        </CardHeader>
                        <CardContent>
                            {ordersLoading ? <Skeleton className="h-8 w-20" /> : (
                                <div className="flex items-baseline justify-between">
                                    <div className="text-2xl font-bold">{totalExamsCount}</div>
                                    <span className="text-xs text-muted-foreground truncate max-w-[110px]" title={topExamName}>Top: {topExamName}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pacientes Atendidos</CardTitle>
                            <Users className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            {ordersLoading ? <Skeleton className="h-8 w-20" /> : (
                                <div className="flex items-baseline justify-between">
                                    <div className="text-2xl font-bold">{patientReports.length}</div>
                                    <span className="text-xs text-muted-foreground">en {getDateLabel().toLowerCase()}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Filters & Search */}
                <div className="flex flex-col sm:flex-row gap-3 justify-between items-center bg-card p-3 rounded-xl border shadow-sm">
                    <div className="relative w-full sm:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por paciente, examen o N° de orden..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 bg-background border-muted"
                        />
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <span className="text-xs font-medium text-muted-foreground shrink-0">Estado:</span>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-9 w-[150px] bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">Todos</SelectItem>
                                <SelectItem value="COMPLETED">Completados</SelectItem>
                                <SelectItem value="PENDING">Pendientes</SelectItem>
                                <SelectItem value="IN_PROGRESS">En Proceso</SelectItem>
                                <SelectItem value="CANCELLED">Cancelados</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Interactive Tabs Section */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                    <TabsList className="bg-muted/60 p-1 border h-auto flex flex-wrap">
                        <TabsTrigger value="exams" className="gap-2 px-5 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                            <TestTube2 className="h-4 w-4 text-sky-500" />
                            <span>Por Examen</span>
                            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 h-4 bg-muted/80">{examReports.length}</Badge>
                        </TabsTrigger>
                        <TabsTrigger value="patients" className="gap-2 px-5 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                            <Users className="h-4 w-4 text-amber-500" />
                            <span>Por Paciente</span>
                            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 h-4 bg-muted/80">{patientReports.length}</Badge>
                        </TabsTrigger>
                        <TabsTrigger value="users" className="gap-2 px-5 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                            <UserCheck className="h-4 w-4 text-indigo-500" />
                            <span>Por Usuario / Personal</span>
                            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 h-4 bg-muted/80">{userReports.length}</Badge>
                        </TabsTrigger>
                        <TabsTrigger value="orders" className="gap-2 px-5 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                            <FileText className="h-4 w-4 text-primary" />
                            <span>Órdenes Detalladas</span>
                            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 h-4 bg-muted/80">{filteredOrders.length}</Badge>
                        </TabsTrigger>
                    </TabsList>

                    {/* TAB 1: POR EXAMEN */}
                    <TabsContent value="exams" className="m-0">
                        <Card className="border shadow-sm">
                            <CardHeader className="pb-3 border-b bg-muted/20">
                                <CardTitle className="text-base font-semibold flex items-center justify-between">
                                    <span>Rendimiento y Volumetría por Examen Diagnóstico</span>
                                    <span className="text-xs font-normal text-muted-foreground">{getDateLabel()}</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                                            <tr>
                                                <th className="px-6 py-3.5 font-semibold">Examen / Prueba</th>
                                                <th className="px-6 py-3.5 font-semibold">Categoría</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Volumen Total</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Completados</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Pendientes</th>
                                                <th className="px-6 py-3.5 font-semibold w-48">Participación</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {ordersLoading ? (
                                                <tr><td colSpan={6} className="p-8 text-center"><LoaderText /></td></tr>
                                            ) : examReports.length === 0 ? (
                                                <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No se encontraron exámenes para los filtros aplicados.</td></tr>
                                            ) : (
                                                examReports.map((exam, idx) => {
                                                    const pct = totalExamsCount > 0 ? Math.round((exam.total / totalExamsCount) * 100) : 0
                                                    return (
                                                        <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                                            <td className="px-6 py-4 font-medium text-foreground">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="h-7 w-7 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600 shrink-0">
                                                                        <TestTube2 className="h-3.5 w-3.5" />
                                                                    </div>
                                                                    <span>{exam.name}</span>
                                                                    {exam.code && <Badge variant="outline" className="text-[10px] font-mono">{exam.code}</Badge>}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-muted-foreground text-xs">{exam.category}</td>
                                                            <td className="px-6 py-4 text-center font-bold text-base">{exam.total}</td>
                                                            <td className="px-6 py-4 text-center">
                                                                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                                                    {exam.completed}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-6 py-4 text-center">
                                                                {exam.pending > 0 ? (
                                                                    <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">
                                                                        {exam.pending}
                                                                    </Badge>
                                                                ) : <span className="text-muted-foreground text-xs">—</span>}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                                                        <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
                                                                    </div>
                                                                    <span className="text-xs font-semibold text-muted-foreground w-10 text-right">{pct}%</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TAB 2: POR PACIENTE */}
                    <TabsContent value="patients" className="m-0">
                        <Card className="border shadow-sm">
                            <CardHeader className="pb-3 border-b bg-muted/20">
                                <CardTitle className="text-base font-semibold flex items-center justify-between">
                                    <span>Frecuencia y Atenciones por Paciente</span>
                                    <span className="text-xs font-normal text-muted-foreground">{getDateLabel()}</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                                            <tr>
                                                <th className="px-6 py-3.5 font-semibold">Paciente</th>
                                                <th className="px-6 py-3.5 font-semibold">Documento</th>
                                                <th className="px-6 py-3.5 font-semibold">Cuenta Portal</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Total Órdenes</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Exámenes Realizados</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Resultados Listos</th>
                                                <th className="px-6 py-3.5 font-semibold">Última Atención</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {ordersLoading ? (
                                                <tr><td colSpan={7} className="p-8 text-center"><LoaderText /></td></tr>
                                            ) : patientReports.length === 0 ? (
                                                <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">No hay actividad de pacientes registrada en este período.</td></tr>
                                            ) : (
                                                patientReports.map((p, idx) => (
                                                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                                        <td className="px-6 py-4 font-medium text-foreground">
                                                            <div className="flex items-center gap-2">
                                                                <div className="h-7 w-7 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 font-bold text-xs shrink-0">
                                                                    {p.name.charAt(0).toUpperCase()}
                                                                </div>
                                                                <span>{p.name}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{p.document}</td>
                                                        <td className="px-6 py-4">
                                                            {p.email ? (
                                                                <Badge variant="outline" className="bg-emerald-50/50 text-emerald-700 border-emerald-200 gap-1 text-[11px]">
                                                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Activa ({p.email})
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">Sin cuenta web</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 text-center font-bold text-base text-primary">{p.totalOrders}</td>
                                                        <td className="px-6 py-4 text-center font-semibold">{p.totalExams}</td>
                                                        <td className="px-6 py-4 text-center">
                                                            <Badge variant="secondary" className="bg-sky-50 text-sky-700 border-sky-200">
                                                                {p.completedOrders} / {p.totalOrders}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-6 py-4 text-xs text-muted-foreground">
                                                            {p.lastVisit ? format(new Date(p.lastVisit), "dd/MM/yyyy HH:mm") : "—"}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TAB 3: POR USUARIO / PERSONAL */}
                    <TabsContent value="users" className="m-0">
                        <Card className="border shadow-sm">
                            <CardHeader className="pb-3 border-b bg-muted/20">
                                <CardTitle className="text-base font-semibold flex items-center justify-between">
                                    <span>Productividad de Usuarios y Personal de Laboratorio</span>
                                    <span className="text-xs font-normal text-muted-foreground">{getDateLabel()}</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                                            <tr>
                                                <th className="px-6 py-3.5 font-semibold">Nombre del Usuario / Staff</th>
                                                <th className="px-6 py-3.5 font-semibold">Rol en Sistema</th>
                                                <th className="px-6 py-3.5 font-semibold">Correo Electrónico</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Estado</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Órdenes Gestionadas</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Órdenes Completadas</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {ordersLoading ? (
                                                <tr><td colSpan={6} className="p-8 text-center"><LoaderText /></td></tr>
                                            ) : userReports.length === 0 ? (
                                                <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No hay usuarios activos registrados.</td></tr>
                                            ) : (
                                                userReports.map((u, idx) => (
                                                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                                        <td className="px-6 py-4 font-medium text-foreground">
                                                            <div className="flex items-center gap-2.5">
                                                                <div className="h-7 w-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600 font-bold text-xs shrink-0">
                                                                    <Stethoscope className="h-3.5 w-3.5" />
                                                                </div>
                                                                <span>{u.name}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <Badge variant="outline" className="font-normal text-xs">{u.role}</Badge>
                                                        </td>
                                                        <td className="px-6 py-4 text-xs text-muted-foreground">{u.email || "—"}</td>
                                                        <td className="px-6 py-4 text-center">
                                                            <Badge variant={u.active ? "default" : "secondary"} className={u.active ? "bg-emerald-500 hover:bg-emerald-600 text-white text-[10px]" : "text-[10px]"}>
                                                                {u.active ? "Activo" : "Inactivo"}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-6 py-4 text-center font-bold text-base">{u.ordersManaged}</td>
                                                        <td className="px-6 py-4 text-center">
                                                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                                                {u.completedManaged}
                                                            </Badge>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TAB 4: ÓRDENES DETALLADAS */}
                    <TabsContent value="orders" className="m-0">
                        <Card className="border shadow-sm">
                            <CardHeader className="pb-3 border-b bg-muted/20">
                                <CardTitle className="text-base font-semibold flex items-center justify-between">
                                    <span>Registro Completo de Órdenes para Auditoría y Exportación</span>
                                    <span className="text-xs font-normal text-muted-foreground">{getDateLabel()}</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                                            <tr>
                                                <th className="px-6 py-3.5 font-semibold">N° Orden</th>
                                                <th className="px-6 py-3.5 font-semibold">Fecha y Hora</th>
                                                <th className="px-6 py-3.5 font-semibold">Paciente</th>
                                                <th className="px-6 py-3.5 font-semibold">Exámenes / Tipo</th>
                                                <th className="px-6 py-3.5 font-semibold text-center">Archivos PDF</th>
                                                <th className="px-6 py-3.5 font-semibold text-right">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {ordersLoading ? (
                                                <tr><td colSpan={6} className="p-8 text-center"><LoaderText /></td></tr>
                                            ) : filteredOrders.length === 0 ? (
                                                <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No hay órdenes para mostrar con los filtros seleccionados.</td></tr>
                                            ) : (
                                                filteredOrders.map((o: any) => {
                                                    const patientName = o.patients?.full_name || "Desconocido"
                                                    const patientDoc = `${o.patients?.document_type || ''} ${o.patients?.document_number || ''}`.trim()
                                                    const isCompleted = o.status === "COMPLETED"
                                                    const filesCount = o.result_files?.length || 0

                                                    return (
                                                        <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                                                            <td className="px-6 py-4 font-mono font-bold text-primary text-xs">{o.order_number}</td>
                                                            <td className="px-6 py-4 text-xs text-muted-foreground">
                                                                {format(new Date(o.ordered_at), "dd/MM/yyyy HH:mm")}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="font-medium text-foreground">{patientName}</div>
                                                                <div className="text-[11px] text-muted-foreground font-mono">{patientDoc}</div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {o.is_direct ? (
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] shrink-0">Directo</Badge>
                                                                        <span className="font-medium text-xs">{o.direct_exam_name || "Resultado Directo"}</span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-1">
                                                                        {o.order_tests?.map((ot: any) => (
                                                                            <div key={ot.id} className="text-xs font-medium flex items-center gap-1.5">
                                                                                <span className="h-1.5 w-1.5 rounded-full bg-sky-500 inline-block shrink-0" />
                                                                                <span>{ot.tests?.name || "Examen"}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 text-center">
                                                                {filesCount > 0 ? (
                                                                    <Badge variant="outline" className="bg-emerald-50/50 text-emerald-700 border-emerald-200 text-xs font-medium gap-1">
                                                                        <FileText className="h-3 w-3" /> {filesCount} PDF{filesCount > 1 ? "s" : ""}
                                                                    </Badge>
                                                                ) : (
                                                                    <span className="text-xs text-muted-foreground">Pendiente</span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <Badge
                                                                    variant={isCompleted ? "default" : "secondary"}
                                                                    className={isCompleted ? "bg-emerald-500 hover:bg-emerald-600 text-white text-[11px]" : "bg-amber-100 text-amber-800 border-amber-300 text-[11px]"}
                                                                >
                                                                    {isCompleted ? "Completado" : o.status === "PENDING" ? "Pendiente" : o.status}
                                                                </Badge>
                                                            </td>
                                                        </tr>
                                                    )
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                {/* Hidden printable area that will be injected into print window */}
                <div id="report-printable-area" className="hidden">
                    {activeTab === "exams" && (
                        <table>
                            <thead>
                                <tr>
                                    <th>Examen / Prueba Diagnóstica</th>
                                    <th>Categoría</th>
                                    <th>Volumen Realizado</th>
                                    <th>Completados</th>
                                    <th>Pendientes</th>
                                    <th>Participación %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {examReports.map((exam, i) => {
                                    const pct = totalExamsCount > 0 ? Math.round((exam.total / totalExamsCount) * 100) : 0
                                    return (
                                        <tr key={i}>
                                            <td><strong>{exam.name}</strong> ${exam.code ? `(${exam.code})` : ''}</td>
                                            <td>${exam.category}</td>
                                            <td><strong>${exam.total}</strong></td>
                                            <td><span class="badge badge-completed">${exam.completed}</span></td>
                                            <td>${exam.pending > 0 ? `<span class="badge badge-pending">${exam.pending}</span>` : '0'}</td>
                                            <td>${pct}%</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}

                    {activeTab === "patients" && (
                        <table>
                            <thead>
                                <tr>
                                    <th>Nombre del Paciente</th>
                                    <th>Documento de Identidad</th>
                                    <th>Estado Portal Web</th>
                                    <th>Órdenes Solicitadas</th>
                                    <th>Exámenes Realizados</th>
                                    <th>Última Atención en Lab</th>
                                </tr>
                            </thead>
                            <tbody>
                                {patientReports.map((p, i) => (
                                    <tr key={i}>
                                        <td><strong>${p.name}</strong></td>
                                        <td>${p.document}</td>
                                        <td>${p.email ? 'Activa / Registrado' : 'Sin cuenta web'}</td>
                                        <td><strong>${p.totalOrders}</strong></td>
                                        <td>${p.totalExams}</td>
                                        <td>${p.lastVisit ? format(new Date(p.lastVisit), "dd/MM/yyyy HH:mm") : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {activeTab === "users" && (
                        <table>
                            <thead>
                                <tr>
                                    <th>Nombre de Usuario / Staff</th>
                                    <th>Rol Asignado</th>
                                    <th>Correo Electrónico</th>
                                    <th>Estado</th>
                                    <th>Órdenes Gestionadas</th>
                                    <th>Completadas con Éxito</th>
                                </tr>
                            </thead>
                            <tbody>
                                {userReports.map((u, i) => (
                                    <tr key={i}>
                                        <td><strong>${u.name}</strong></td>
                                        <td>${u.role}</td>
                                        <td>${u.email || '—'}</td>
                                        <td>${u.active ? 'Activo' : 'Inactivo'}</td>
                                        <td><strong>${u.ordersManaged}</strong></td>
                                        <td>${u.completedManaged}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {activeTab === "orders" && (
                        <table>
                            <thead>
                                <tr>
                                    <th>N° Orden</th>
                                    <th>Fecha y Hora</th>
                                    <th>Paciente Atendido</th>
                                    <th>Examen(es) / Servicio</th>
                                    <th>Archivos Subidos</th>
                                    <th>Estado Actual</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOrders.map((o: any) => {
                                    const patientName = o.patients?.full_name || "Desconocido"
                                    const examInfo = o.is_direct ? (o.direct_exam_name || "Directo") : (o.order_tests?.map((t: any) => t.tests?.name).join(", ") || "General")
                                    const statusLabel = o.status === "COMPLETED" ? "Completado" : o.status === "PENDING" ? "Pendiente" : o.status
                                    return (
                                        <tr key={o.id}>
                                            <td><strong>${o.order_number}</strong></td>
                                            <td>${format(new Date(o.ordered_at), "dd/MM/yyyy HH:mm")}</td>
                                            <td>${patientName}</td>
                                            <td>${examInfo}</td>
                                            <td>${o.result_files?.length || 0} PDF(s)</td>
                                            <td><span class="badge ${o.status === 'COMPLETED' ? 'badge-completed' : 'badge-pending'}">${statusLabel}</span></td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Print Preview Modal */}
                <Dialog open={showPrintModal} onOpenChange={setShowPrintModal}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Printer className="h-5 w-5 text-primary" />
                                Exportar Reporte a PDF / Impresión
                            </DialogTitle>
                            <DialogDescription>
                                Se generará un documento formal de laboratorio con membrete, métricas clave y la tabla de datos actual: <strong className="text-foreground">{
                                    activeTab === "exams" ? "Por Examen" : activeTab === "patients" ? "Por Paciente" : activeTab === "users" ? "Por Usuario" : "Órdenes Detalladas"
                                }</strong>.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="bg-muted/50 p-4 rounded-lg border space-y-2 text-xs text-muted-foreground my-2">
                            <div className="flex justify-between">
                                <span>Período seleccionado:</span>
                                <strong className="text-foreground">{getDateLabel()}</strong>
                            </div>
                            <div className="flex justify-between">
                                <span>Total registros a imprimir:</span>
                                <strong className="text-foreground">{
                                    activeTab === "exams" ? examReports.length :
                                    activeTab === "patients" ? patientReports.length :
                                    activeTab === "users" ? userReports.length : filteredOrders.length
                                } filas</strong>
                            </div>
                            <div className="flex justify-between">
                                <span>Formato de salida:</span>
                                <strong className="text-foreground">PDF oficial A4 / Carta</strong>
                            </div>
                        </div>

                        <DialogFooter className="gap-2 sm:gap-0 mt-2">
                            <Button variant="outline" onClick={() => setShowPrintModal(false)}>Cancelar</Button>
                            <Button onClick={handlePrintPDF} className="gap-2 bg-gradient-to-r from-primary to-sky-600">
                                <Printer className="h-4 w-4" />
                                <span>Generar y Guardar PDF</span>
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </AdminLayout>
    )
}

function LoaderText() {
    return (
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span>Cargando datos y calculando estadísticas del laboratorio...</span>
        </div>
    )
}
