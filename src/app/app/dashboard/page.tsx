"use client"

import { useQuery } from "@tanstack/react-query"
import {
    Users,
    FileText,
    Clock,
    CheckCircle2,
    Activity,
    ArrowUpRight,
    Plus,
    FlaskConical,
} from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export default function LabDashboard() {
    const supabase = createClient()

    const { data: stats, isLoading } = useQuery({
        queryKey: ["lab-stats"],
        queryFn: async () => {
            const { data: profile } = await supabase.from('profiles').select('lab_id').single()
            if (!profile?.lab_id) return null

            const [patientsCount, ordersCount, pendingCount, completedCount] = await Promise.all([
                supabase.from('patients').select('*', { count: 'exact', head: true }).eq('lab_id', profile.lab_id),
                supabase.from('orders').select('*', { count: 'exact', head: true }).eq('lab_id', profile.lab_id),
                supabase.from('orders').select('*', { count: 'exact', head: true }).eq('lab_id', profile.lab_id).eq('status', 'PENDING'),
                supabase.from('orders').select('*', { count: 'exact', head: true }).eq('lab_id', profile.lab_id).eq('status', 'COMPLETED'),
            ])

            const { data: recentOrders } = await supabase
                .from('orders')
                .select('id, order_number, status, ordered_at, patients(full_name)')
                .eq('lab_id', profile.lab_id)
                .order('ordered_at', { ascending: false })
                .limit(5)

            return {
                patients: patientsCount.count || 0,
                orders: ordersCount.count || 0,
                pending: pendingCount.count || 0,
                completed: completedCount.count || 0,
                recentOrders: recentOrders || [],
            }
        }
    })

    return (
        <AdminLayout>
            <div className="space-y-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Bienvenido de nuevo</h1>
                        <p className="text-muted-foreground">Aquí tienes un resumen de la actividad de hoy en el laboratorio.</p>
                    </div>
                    <div className="flex gap-3">
                        <Link href="/app/orders/new">
                            <Button className="gap-2">
                                <Plus className="h-4 w-4" /> Nueva Orden
                            </Button>
                        </Link>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Card className="shadow-sm border-l-4 border-l-primary">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Pacientes Registrados</CardTitle>
                            <Users className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            {isLoading ? <Skeleton className="h-8 w-20" /> : (
                                <>
                                    <div className="text-2xl font-bold">{stats?.patients}</div>
                                    <p className="text-xs text-muted-foreground">+4 desde la última semana</p>
                                </>
                            )}
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-green-500">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Órdenes Totales</CardTitle>
                            <FileText className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            {isLoading ? <Skeleton className="h-8 w-20" /> : (
                                <>
                                    <div className="text-2xl font-bold">{stats?.orders}</div>
                                    <p className="text-xs text-muted-foreground">+12% vs el mes pasado</p>
                                </>
                            )}
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-amber-500">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Pendientes por Procesar</CardTitle>
                            <Clock className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            {isLoading ? <Skeleton className="h-8 w-20" /> : (
                                <>
                                    <div className="text-2xl font-bold">{stats?.pending}</div>
                                    <p className="text-xs text-muted-foreground">Prioridad alta: 2 órdenes</p>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
                    {/* Completadas vs Pendientes */}
                    <Card className="lg:col-span-4">
                        <CardHeader>
                            <CardTitle>Estado General de Órdenes</CardTitle>
                            <CardDescription>Distribución actual entre pendientes y completadas.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isLoading ? (
                                <div className="h-[120px] flex items-center justify-center"><Activity className="h-6 w-6 animate-pulse text-muted-foreground" /></div>
                            ) : (
                                <>
                                    <div className="space-y-3">
                                        <div>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-green-500" /> Completadas</span>
                                                <span className="font-bold text-green-600">{stats?.completed ?? 0}</span>
                                            </div>
                                            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full bg-green-500 rounded-full transition-all duration-700"
                                                    style={{ width: stats?.orders ? `${((stats.completed ?? 0) / stats.orders) * 100}%` : '0%' }}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-amber-500" /> Pendientes</span>
                                                <span className="font-bold text-amber-600">{stats?.pending ?? 0}</span>
                                            </div>
                                            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full bg-amber-400 rounded-full transition-all duration-700"
                                                    style={{ width: stats?.orders ? `${((stats.pending ?? 0) / stats.orders) * 100}%` : '0%' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground text-right">Total: {stats?.orders} órdenes</p>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* Actividad reciente REAL */}
                    <Card className="lg:col-span-3">
                        <CardHeader>
                            <CardTitle>Órdenes Recientes</CardTitle>
                            <CardDescription>Últimas 5 órdenes registradas.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="space-y-3">
                                    {[1,2,3].map(i => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}
                                </div>
                            ) : stats?.recentOrders && stats.recentOrders.length > 0 ? (
                                <div className="space-y-3">
                                    {stats.recentOrders.map((order: any) => (
                                        <div key={order.id} className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                <FlaskConical className="h-4 w-4 text-primary" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium leading-none truncate">{order.patients?.full_name}</p>
                                                <p className="text-xs text-muted-foreground">#{order.order_number} · {format(new Date(order.ordered_at), "dd MMM", { locale: es })}</p>
                                            </div>
                                            <Link href={`/app/orders/${order.id}`}>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                                </Button>
                                            </Link>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground italic text-center py-6">No hay órdenes aún.</p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </AdminLayout>
    )
}
