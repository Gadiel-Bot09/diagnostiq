// @ts-nocheck
"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    Building2,
    Users,
    FlaskConical,
    TrendingUp,
    Plus,
    CheckCircle2,
    XCircle,
    Clock,
    ArrowUpRight,
    Activity,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

function StatCard({ label, value, icon: Icon, color, loading }: any) {
    const colorMap: any = {
        violet: "from-violet-500 to-indigo-600",
        blue: "from-blue-500 to-cyan-600",
        emerald: "from-emerald-500 to-teal-600",
        amber: "from-amber-500 to-orange-600",
    }
    return (
        <Card className="relative overflow-hidden border-0 shadow-md bg-white">
            <CardContent className="p-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
                        {loading ? (
                            <Skeleton className="h-9 w-20" />
                        ) : (
                            <p className="text-4xl font-bold text-slate-800">{value}</p>
                        )}
                    </div>
                    <div className={`flex items-center justify-center h-12 w-12 rounded-xl bg-gradient-to-br ${colorMap[color]} shadow-lg`}>
                        <Icon className="h-6 w-6 text-white" />
                    </div>
                </div>
            </CardContent>
            <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${colorMap[color]}`} />
        </Card>
    )
}

export default function SuperAdminDashboard() {
    const supabase = createClient()

    const { data: stats, isLoading } = useQuery({
        queryKey: ["superadmin-stats"],
        queryFn: async () => {
            const [labsRes, usersRes, ordersRes] = await Promise.all([
                supabase.from("labs").select("id, name, status, plan, created_at", { count: "exact" }),
                supabase.from("profiles").select("id, role, is_active", { count: "exact" }),
                supabase.from("orders").select("id, status", { count: "exact" }),
            ])

            const labs = labsRes.data || []
            const users = usersRes.data || []
            const orders = ordersRes.data || []

            return {
                totalLabs: labsRes.count || 0,
                activeLabs: labs.filter(l => l.status === "ACTIVE").length,
                totalUsers: usersRes.count || 0,
                activeUsers: users.filter(u => u.is_active).length,
                totalOrders: ordersRes.count || 0,
                completedOrders: orders.filter(o => o.status === "COMPLETED").length,
                recentLabs: labs.slice(-5).reverse(),
            }
        }
    })

    const statusColors: any = {
        ACTIVE: "bg-emerald-100 text-emerald-700 border-emerald-200",
        INACTIVE: "bg-red-100 text-red-700 border-red-200",
        SUSPENDED: "bg-amber-100 text-amber-700 border-amber-200",
    }

    const planColors: any = {
        FREE: "bg-slate-100 text-slate-600 border-slate-200",
        BASIC: "bg-blue-100 text-blue-700 border-blue-200",
        PRO: "bg-violet-100 text-violet-700 border-violet-200",
        ENTERPRISE: "bg-amber-100 text-amber-700 border-amber-200",
    }

    return (
        <SuperAdminLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Panel de Control</h1>
                        <p className="text-slate-500 mt-1">Vista global del sistema DiagnostiQ</p>
                    </div>
                    <Link href="/superadmin/labs/new">
                        <Button className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md">
                            <Plus className="h-4 w-4" />
                            Nuevo Laboratorio
                        </Button>
                    </Link>
                </div>

                {/* Stats Grid */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Laboratorios Totales" value={stats?.totalLabs ?? 0} icon={Building2} color="violet" loading={isLoading} />
                    <StatCard label="Labs Activos" value={stats?.activeLabs ?? 0} icon={CheckCircle2} color="emerald" loading={isLoading} />
                    <StatCard label="Usuarios Registrados" value={stats?.totalUsers ?? 0} icon={Users} color="blue" loading={isLoading} />
                    <StatCard label="Órdenes Totales" value={stats?.totalOrders ?? 0} icon={FlaskConical} color="amber" loading={isLoading} />
                </div>

                {/* Content Grid */}
                <div className="grid gap-6 lg:grid-cols-5">
                    {/* Recent Labs */}
                    <Card className="lg:col-span-3 shadow-sm border-0 bg-white">
                        <CardHeader className="flex flex-row items-center justify-between pb-4">
                            <div>
                                <CardTitle className="text-base font-semibold">Laboratorios Recientes</CardTitle>
                                <CardDescription>Últimos tenants registrados en el sistema</CardDescription>
                            </div>
                            <Link href="/superadmin/labs">
                                <Button variant="ghost" size="sm" className="gap-1 text-violet-600 hover:text-violet-700 hover:bg-violet-50">
                                    Ver todos <ArrowUpRight className="h-3.5 w-3.5" />
                                </Button>
                            </Link>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="space-y-3">
                                    {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
                                </div>
                            ) : stats?.recentLabs?.length ? (
                                <div className="space-y-2">
                                    {stats.recentLabs.map((lab: any) => (
                                        <Link key={lab.id} href={`/superadmin/labs/${lab.id}`}>
                                            <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100 cursor-pointer group">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center border border-violet-100">
                                                        <Building2 className="h-4 w-4 text-violet-600" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-slate-700 group-hover:text-violet-700">{lab.name}</p>
                                                        <p className="text-xs text-slate-400">
                                                            {lab.created_at ? format(new Date(lab.created_at), "dd MMM yyyy", { locale: es }) : "—"}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${planColors[lab.plan] || planColors.FREE}`}>
                                                        {lab.plan || "FREE"}
                                                    </span>
                                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[lab.status] || statusColors.ACTIVE}`}>
                                                        {lab.status || "ACTIVE"}
                                                    </span>
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-10">
                                    <Building2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                                    <p className="text-sm text-slate-400">No hay laboratorios aún.</p>
                                    <Link href="/superadmin/labs/new">
                                        <Button variant="outline" size="sm" className="mt-3">Crear el primero</Button>
                                    </Link>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* System Summary */}
                    <Card className="lg:col-span-2 shadow-sm border-0 bg-white">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                                <Activity className="h-4 w-4 text-violet-500" />
                                Resumen del Sistema
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {[
                                { label: "Órdenes Completadas", value: stats?.completedOrders ?? 0, total: stats?.totalOrders ?? 0, color: "bg-emerald-500" },
                                { label: "Usuarios Activos", value: stats?.activeUsers ?? 0, total: stats?.totalUsers ?? 0, color: "bg-blue-500" },
                                { label: "Labs Activos", value: stats?.activeLabs ?? 0, total: stats?.totalLabs ?? 0, color: "bg-violet-500" },
                            ].map((item) => (
                                <div key={item.label}>
                                    <div className="flex justify-between text-sm mb-1.5">
                                        <span className="text-slate-500">{item.label}</span>
                                        <span className="font-semibold text-slate-700">{item.value}/{item.total}</span>
                                    </div>
                                    {isLoading ? (
                                        <Skeleton className="h-2 w-full" />
                                    ) : (
                                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${item.color} transition-all duration-700`}
                                                style={{ width: item.total ? `${(item.value / item.total) * 100}%` : "0%" }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}

                            <div className="pt-4 border-t border-slate-100">
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Accesos Rápidos</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <Link href="/superadmin/labs/new">
                                        <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 hover:border-violet-300 hover:text-violet-700">
                                            <Plus className="h-3 w-3" /> Nuevo Lab
                                        </Button>
                                    </Link>
                                    <Link href="/superadmin/labs">
                                        <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 hover:border-violet-300 hover:text-violet-700">
                                            <Building2 className="h-3 w-3" /> Ver Labs
                                        </Button>
                                    </Link>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </SuperAdminLayout>
    )
}
