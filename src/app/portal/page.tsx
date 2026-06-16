// @ts-nocheck
"use client"

import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { FileText, Download, Microscope, Clock, CheckCircle2 } from "lucide-react"
import Link from "next/link"

import { createClient } from "@/lib/supabase/client"
import { PasswordChangeBanner } from "@/components/portal/PasswordChangeBanner"
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

export default function PatientDashboard() {
    const supabase = createClient()

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
                .select(`
                    full_name,
                    labs (name)
                `)
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

            return {
                ...profile,
                labName: labName || "Laboratorio Clínico"
            } as any
        }
    })

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        window.location.href = "/portal/login"
    }

    return (
        <div className="min-h-screen bg-background p-6 lg:p-12 space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Mis Resultados</h1>
                    <p className="text-muted-foreground">Consulta y descarga tus exámenes médicos.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                        {isLoadingUser ? (
                            <Skeleton className="h-6 w-32" />
                        ) : userProfile && (
                            <div className="flex flex-col items-end mr-2">
                                <span className="text-sm font-semibold text-primary">
                                    {userProfile.labName}
                                </span>
                                <span className="text-xs text-muted-foreground font-medium">
                                    {userProfile.full_name}
                                </span>
                            </div>
                        )}
                        {userProfile && (
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold uppercase hidden md:flex">
                                {userProfile.full_name?.substring(0, 2)}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 border-l pl-4 border-muted">
                        <ChangePasswordModal />
                        <Button variant="outline" size="sm" onClick={handleSignOut}>
                            Cerrar Sesión
                        </Button>
                    </div>
                </div>
            </header>

            <PasswordChangeBanner />

            <div className="grid gap-6">
                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle>Historial de Órdenes</CardTitle>
                        <CardDescription>Lista de tus exámenes recientes y sus estados.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="space-y-2">
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        ) : orders && orders.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>No. Orden</TableHead>
                                        <TableHead>Laboratorio</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {orders.map((order: any) => (
                                        <TableRow key={order.id}>
                                            <TableCell className="font-medium">#{order.order_number}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Microscope className="h-4 w-4 text-muted-foreground" />
                                                    {order.labs.name}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {format(new Date(order.ordered_at), "PPP", { locale: es })}
                                            </TableCell>
                                            <TableCell>
                                                {order.status === "COMPLETED" ? (
                                                    <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-200 gap-1">
                                                        <CheckCircle2 className="h-3 w-3" /> Completo
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-amber-600 border-amber-200 gap-1">
                                                        <Clock className="h-3 w-3" /> Procesando
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Link href={`/portal/orders/${order.id}`}>
                                                    <Button variant="ghost" size="sm" className="gap-2">
                                                        <FileText className="h-4 w-4" /> Ver Detalles
                                                    </Button>
                                                </Link>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-center py-12 space-y-3">
                                <div className="bg-muted w-12 h-12 rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                                    <FileText className="h-6 w-6" />
                                </div>
                                <h3 className="text-lg font-medium">No hay órdenes</h3>
                                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                    Por ahora no tienes exámenes registrados. Si acabas de realizarte uno, espera a que el laboratorio lo registre.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
