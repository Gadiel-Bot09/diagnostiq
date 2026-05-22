// @ts-nocheck
"use client"

import { useQuery } from "@tanstack/react-query"
import { BarChart3, Building2, Users, FlaskConical, TrendingUp, Package } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function SuperAdminReportsPage() {
    const supabase = createClient()

    const { data, isLoading } = useQuery({
        queryKey: ["superadmin-reports"],
        queryFn: async () => {
            const [labs, users, orders, patients] = await Promise.all([
                supabase.from("labs").select("id, name, plan, status, created_at"),
                supabase.from("profiles").select("id, role, is_active"),
                supabase.from("orders").select("id, status"),
                supabase.from("patients").select("id"),
            ])
            return {
                labs: labs.data || [],
                users: users.data || [],
                orders: orders.data || [],
                patients: patients.data || [],
            }
        }
    })

    const planCounts = data?.labs.reduce((acc: any, lab: any) => {
        acc[lab.plan || "FREE"] = (acc[lab.plan || "FREE"] || 0) + 1
        return acc
    }, {}) || {}

    const roleCounts = data?.users.reduce((acc: any, u: any) => {
        acc[u.role] = (acc[u.role] || 0) + 1
        return acc
    }, {}) || {}

    const orderStatusCounts = data?.orders.reduce((acc: any, o: any) => {
        acc[o.status] = (acc[o.status] || 0) + 1
        return acc
    }, {}) || {}

    const metrics = [
        { label: "Laboratorios activos", value: data?.labs.filter((l: any) => l.status === "ACTIVE").length ?? 0, icon: Building2, color: "from-violet-500 to-indigo-600" },
        { label: "Total Usuarios", value: data?.users.length ?? 0, icon: Users, color: "from-blue-500 to-cyan-600" },
        { label: "Total Pacientes", value: data?.patients.length ?? 0, icon: Users, color: "from-emerald-500 to-teal-600" },
        { label: "Total Órdenes", value: data?.orders.length ?? 0, icon: FlaskConical, color: "from-amber-500 to-orange-600" },
    ]

    return (
        <SuperAdminLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Reportes del Sistema</h1>
                    <p className="text-slate-500 mt-1">Métricas globales de todos los laboratorios</p>
                </div>

                {/* Global metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {metrics.map(m => (
                        <Card key={m.label} className="border-0 shadow-sm bg-white relative overflow-hidden">
                            <CardContent className="p-5">
                                <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${m.color} flex items-center justify-center shadow-md mb-3`}>
                                    <m.icon className="h-5 w-5 text-white" />
                                </div>
                                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                                    <p className="text-3xl font-bold text-slate-800">{m.value}</p>
                                )}
                                <p className="text-xs text-slate-500 mt-1">{m.label}</p>
                            </CardContent>
                            <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r ${m.color}`} />
                        </Card>
                    ))}
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Labs by plan */}
                    <Card className="border-0 shadow-sm bg-white">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <Package className="h-4 w-4 text-violet-500" /> Labs por Plan
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {isLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />) :
                                Object.entries(planCounts).map(([plan, count]: any) => (
                                    <div key={plan}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-600 font-medium">{plan}</span>
                                            <span className="font-bold text-slate-800">{count}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-slate-100">
                                            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                                                style={{ width: `${(count / (data?.labs.length || 1)) * 100}%` }} />
                                        </div>
                                    </div>
                                ))
                            }
                        </CardContent>
                    </Card>

                    {/* Users by role */}
                    <Card className="border-0 shadow-sm bg-white">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <Users className="h-4 w-4 text-blue-500" /> Usuarios por Rol
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {isLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />) :
                                Object.entries(roleCounts).map(([role, count]: any) => (
                                    <div key={role}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-600 font-medium">{role}</span>
                                            <span className="font-bold text-slate-800">{count}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-slate-100">
                                            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-500"
                                                style={{ width: `${(count / (data?.users.length || 1)) * 100}%` }} />
                                        </div>
                                    </div>
                                ))
                            }
                        </CardContent>
                    </Card>

                    {/* Orders by status */}
                    <Card className="border-0 shadow-sm bg-white">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-emerald-500" /> Órdenes por Estado
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {isLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />) :
                                Object.keys(orderStatusCounts).length === 0 ? (
                                    <p className="text-sm text-slate-400 py-4 text-center">Sin órdenes aún</p>
                                ) :
                                Object.entries(orderStatusCounts).map(([status, count]: any) => (
                                    <div key={status}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-600 font-medium">{status}</span>
                                            <span className="font-bold text-slate-800">{count}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-slate-100">
                                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                                                style={{ width: `${(count / (data?.orders.length || 1)) * 100}%` }} />
                                        </div>
                                    </div>
                                ))
                            }
                        </CardContent>
                    </Card>
                </div>
            </div>
        </SuperAdminLayout>
    )
}
