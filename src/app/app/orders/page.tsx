"use client"

import { useQuery } from "@tanstack/react-query"
import { Search, FileUp, MoreVertical, Eye, Calendar, Microscope } from "lucide-react"
import { useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export default function LabOrdersPage() {
    const supabase = createClient()
    const [searchTerm, setSearchTerm] = useState("")

    const { data: orders, isLoading } = useQuery({
        queryKey: ["lab-orders", searchTerm],
        queryFn: async () => {
            let query = supabase
                .from("orders")
                .select(`
          id,
          order_number,
          status,
          ordered_at,
          patients (full_name, document_number)
        `)
                .order("ordered_at", { ascending: false })

            if (searchTerm) {
                query = query.or(`order_number.ilike.%${searchTerm}%,patients.full_name.ilike.%${searchTerm}%`)
            }

            const { data, error } = await query
            if (error) throw error
            return data
        }
    })

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Órdenes</h1>
                        <p className="text-muted-foreground">Monitorea y procesa las órdenes de laboratorio.</p>
                    </div>
                    <Link href="/app/orders/new">
                        <Button className="gap-2">
                            <Microscope className="h-4 w-4" /> Crear Nueva Orden
                        </Button>
                    </Link>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle>Cola de Procesamiento</CardTitle>
                                <CardDescription>Visualiza el estado actual de todas las órdenes emitidas.</CardDescription>
                            </div>
                            <div className="relative w-full md:w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por No. o Paciente..."
                                    className="pl-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="text-center py-10">Cargando órdenes...</div>
                        ) : orders && orders.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>No. Orden</TableHead>
                                        <TableHead>Paciente / Doc</TableHead>
                                        <TableHead>Fecha Orden</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {orders.map((order: any) => (
                                        <TableRow key={order.id}>
                                            <TableCell className="font-bold">#{order.order_number}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{order.patients.full_name}</span>
                                                    <span className="text-xs text-muted-foreground">{order.patients.document_number}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {format(new Date(order.ordered_at), "PPp", { locale: es })}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={order.status === 'COMPLETED' ? 'default' : 'secondary'} className={order.status === 'COMPLETED' ? 'bg-green-500' : ''}>
                                                    {order.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Link href={`/app/orders/${order.id}`}>
                                                        <Button variant="outline" size="sm" className="gap-2 h-8">
                                                            <Eye className="h-3.5 w-3.5" /> Ver
                                                        </Button>
                                                    </Link>
                                                    <Link href={`/app/orders/${order.id}/upload`}>
                                                        <Button size="sm" className="gap-2 h-8 bg-blue-600 hover:bg-blue-700">
                                                            <FileUp className="h-3.5 w-3.5" /> Subir PDF
                                                        </Button>
                                                    </Link>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-center py-20 border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">No se encontraron órdenes el día de hoy.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AdminLayout>
    )
}
