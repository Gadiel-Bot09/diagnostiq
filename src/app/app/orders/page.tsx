// @ts-nocheck
"use client"

import { useQuery } from "@tanstack/react-query"
import { Search, FileUp, MoreVertical, Eye, Calendar, Microscope, X } from "lucide-react"
import { useState, useMemo } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { usePermissions } from "@/contexts/PermissionsContext"
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

function normalizeText(text: string): string {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
}

function getSearchVariants(term: string): string[] {
    const clean = term.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ\s-]/g, "").trim()
    const variants = new Set<string>([clean])

    const unaccented = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    variants.add(unaccented)

    if (unaccented.length <= 25) {
        const vowelMap: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" }
        const lower = unaccented.toLowerCase()
        for (let i = 0; i < lower.length; i++) {
            const char = lower[i]
            if (vowelMap[char]) {
                variants.add(lower.slice(0, i) + vowelMap[char] + lower.slice(i + 1))
            }
        }
    }

    return Array.from(variants).filter((v) => v.length > 0)
}

export default function LabOrdersPage() {
    const supabase = createClient()
    const { hasPermission } = usePermissions()
    const [searchTerm, setSearchTerm] = useState("")

    const cleanSearch = searchTerm.replace(/^[#\s]+/, "").trim()

    const { data: orders, isLoading } = useQuery({
        queryKey: ["lab-orders", cleanSearch],
        queryFn: async () => {
            let query = supabase
                .from("orders")
                .select(`
          id,
          order_number,
          status,
          ordered_at,
          is_direct,
          direct_exam_name,
          patients (full_name, document_number)
        `)
                .order("ordered_at", { ascending: false })

            const safeTerm = cleanSearch.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ\s-]/g, "").trim()

            if (safeTerm) {
                // 1. Find matching patients by full_name or document_number
                const variants = getSearchVariants(safeTerm)
                const tokens = safeTerm.split(/\s+/).filter(Boolean)

                const patientConditions = [
                    ...variants.map((v) => `full_name.ilike.%${v}%`),
                    ...tokens.map((t) => `full_name.ilike.%${t}%`),
                    `document_number.ilike.%${safeTerm}%`,
                ]
                const patientOr = Array.from(new Set(patientConditions)).join(",")

                const { data: matchedPatients, error: patientError } = await supabase
                    .from("patients")
                    .select("id")
                    .or(patientOr)
                    .limit(100)

                if (patientError) {
                    console.error("Error buscando pacientes:", patientError)
                }

                const patientIds = matchedPatients?.map((p) => p.id) || []

                // 2. Build order search conditions
                const orderConditions = [
                    `order_number.ilike.%${safeTerm}%`,
                    `direct_exam_name.ilike.%${safeTerm}%`,
                ]

                if (patientIds.length > 0) {
                    orderConditions.push(`patient_id.in.(${patientIds.join(",")})`)
                }

                query = query.or(orderConditions.join(","))
            }

            const { data, error } = await query
            if (error) throw error
            return data
        },
    })

    const filteredOrders = useMemo(() => {
        if (!orders) return []
        const term = cleanSearch
        if (!term) return orders

        const normalizedTerm = normalizeText(term)
        const tokens = normalizedTerm.split(/\s+/).filter(Boolean)

        return orders.filter((order: any) => {
            const orderNum = (order.order_number || "").toString().toLowerCase()
            const directExam = normalizeText(order.direct_exam_name || "")
            const patientName = normalizeText(order.patients?.full_name || "")
            const docNum = (order.patients?.document_number || "").toString().toLowerCase()
            const fullCombined = `${orderNum} ${patientName} ${docNum} ${directExam}`

            return tokens.every((token) => fullCombined.includes(token))
        })
    }, [orders, cleanSearch])

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Órdenes</h1>
                        <p className="text-muted-foreground">Monitorea y procesa las órdenes de laboratorio.</p>
                    </div>
                    {hasPermission("orders", "create") && (
                    <Link href="/app/orders/new">
                        <Button className="gap-2">
                            <Microscope className="h-4 w-4" /> Crear Nueva Orden
                        </Button>
                    </Link>
                    )}
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle>Cola de Procesamiento</CardTitle>
                                <CardDescription>Visualiza el estado actual de todas las órdenes emitidas.</CardDescription>
                            </div>
                            <div className="relative w-full md:w-80">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por paciente, doc. u orden..."
                                    className="pl-9 pr-8"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchTerm("")}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full hover:bg-muted"
                                        title="Limpiar búsqueda"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="text-center py-10">Cargando órdenes...</div>
                        ) : filteredOrders && filteredOrders.length > 0 ? (
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
                                    {filteredOrders.map((order: any) => (
                                        <TableRow key={order.id}>
                                            <TableCell className="font-bold">
                                                <div className="flex items-center gap-2">
                                                    #{order.order_number}
                                                    {order.is_direct && (
                                                        <Badge variant="outline" className="text-xs text-violet-600 border-violet-300 bg-violet-50">Directo</Badge>
                                                    )}
                                                </div>
                                                {order.is_direct && order.direct_exam_name && (
                                                    <p className="text-xs text-muted-foreground font-normal mt-0.5">{order.direct_exam_name}</p>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                        <span className="font-medium">{(order as any).patients?.full_name}</span>
                                        <span className="text-xs text-muted-foreground">{(order as any).patients?.document_number}</span>
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
                                                    {hasPermission("orders", "upload") && (
                                                    <Link href={`/app/orders/${order.id}/upload`}>
                                                        <Button size="sm" className="gap-2 h-8 bg-blue-600 hover:bg-blue-700">
                                                            <FileUp className="h-3.5 w-3.5" /> Subir PDF
                                                        </Button>
                                                    </Link>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-center py-16 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2">
                                <p className="text-muted-foreground font-medium">
                                    {searchTerm.trim()
                                        ? `No se encontraron órdenes que coincidan con "${searchTerm.trim()}".`
                                        : "No se encontraron órdenes el día de hoy."}
                                </p>
                                {searchTerm.trim() && (
                                    <Button variant="outline" size="sm" onClick={() => setSearchTerm("")} className="mt-2">
                                        Limpiar búsqueda
                                    </Button>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AdminLayout>
    )
}