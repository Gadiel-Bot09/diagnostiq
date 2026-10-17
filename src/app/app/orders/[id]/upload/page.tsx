// @ts-nocheck
"use client"

import { useQuery } from "@tanstack/react-query"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Loader2, User, FileText, Calendar, Microscope } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { usePermissions } from "@/contexts/PermissionsContext"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ResultUploader } from "@/components/ResultUploader"
import { Badge } from "@/components/ui/badge"

export default function OrderUploadPage() {
    const { id } = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const preselectedTestId = searchParams?.get("orderTestId") || null
    const supabase = createClient()
    const { hasPermission, isLoading: permsLoading } = usePermissions()

    const { data: order, isLoading } = useQuery({
        queryKey: ["admin-order", id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("orders")
                .select(`
          id,
          order_number,
          lab_id,
          patient_id,
          status,
          ordered_at,
          patients (full_name, document_number),
          order_tests (
            id,
            status,
            tests (name, category)
          ),
          result_files (version)
        `)
                .eq("id", id)
                .single()

            if (error) throw error
            return data
        }
    })

    if (isLoading) {
        return (
            <AdminLayout>
                <div className="flex justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </AdminLayout>
        )
    }

    const latestVersion = order?.result_files?.reduce((max: number, f: any) => Math.max(max, f.version), 0) || 0
    const patient = order?.patients as any
    const orderTests = (order?.order_tests || []).map((ot: any) => ({
        id: ot.id,
        name: ot.tests?.name || "Examen",
        category: ot.tests?.category,
        status: ot.status,
    }))

    const preselectedTest = orderTests.find((t: any) => t.id === preselectedTestId)

    if (!permsLoading && !hasPermission("orders", "upload") && !hasPermission("orders", "edit") && !hasPermission("orders", "create")) {
        return (
            <AdminLayout>
                <div className="max-w-md mx-auto mt-20 text-center space-y-4 p-8 border rounded-xl bg-card">
                    <h2 className="text-xl font-bold text-destructive">Acceso Denegado</h2>
                    <p className="text-sm text-muted-foreground">No tienes permisos para subir resultados para esta orden.</p>
                    <Button variant="outline" onClick={() => router.back()}>Volver</Button>
                </div>
            </AdminLayout>
        )
    }

    return (
        <AdminLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                <Button variant="ghost" onClick={() => router.back()} className="gap-2 -ml-4">
                    <ArrowLeft className="h-4 w-4" /> Volver a la orden
                </Button>

                <div className="grid md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 space-y-6">
                        <Card className="border-t-4 border-t-blue-600">
                            <CardHeader>
                                <CardTitle>Cargar Reporte de Resultados</CardTitle>
                                <CardDescription>
                                    {preselectedTest ? (
                                        <span>Subiendo resultado específico para el examen: <strong className="text-foreground">{preselectedTest.name}</strong></span>
                                    ) : (
                                        <span>Selecciona el archivo PDF para la orden <strong>#{order?.order_number}</strong>. Puedes cargar un PDF por cada examen.</span>
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {order && (
                                    <ResultUploader
                                        orderId={order.id}
                                        patientId={order.patient_id}
                                        labId={order.lab_id}
                                        currentVersion={latestVersion}
                                        orderTests={orderTests}
                                        selectedOrderTestId={preselectedTestId}
                                    />
                                )}
                            </CardContent>
                        </Card>

                        <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-xs text-blue-700 space-y-2">
                            <p className="font-bold uppercase tracking-widest text-[10px]">Información de Seguridad</p>
                            <p>El archivo será almacenado en un servidor cifrado y solo será accesible para el paciente mediante un enlace seguro temporal.</p>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <User className="h-4 w-4 text-muted-foreground" /> Detalle del Paciente
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1">
                                    <p className="font-bold text-lg">{patient?.full_name}</p>
                                    <p className="text-sm text-muted-foreground">Doc: {patient?.document_number}</p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-muted-foreground" /> Información de Orden
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Número:</span>
                                    <span className="font-medium">#{order?.order_number}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Fecha:</span>
                                    <span className="font-medium">{order && format(new Date(order.ordered_at), "dd/MM/yyyy", { locale: es })}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Estado Actual:</span>
                                    <Badge variant="outline">{order?.status}</Badge>
                                </div>

                                {orderTests.length > 0 && (
                                    <div className="pt-2 border-t space-y-2">
                                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                            Exámenes en la orden ({orderTests.length}):
                                        </p>
                                        <div className="space-y-1.5">
                                            {orderTests.map((t: any) => (
                                                <div
                                                    key={t.id}
                                                    className={`p-2 rounded-lg text-xs flex items-center justify-between border ${
                                                        t.id === preselectedTestId
                                                            ? "bg-blue-50/80 border-blue-200"
                                                            : "bg-muted/30 border-transparent"
                                                    }`}
                                                >
                                                    <span className="truncate max-w-[150px] font-medium" title={t.name}>
                                                        {t.name}
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[10px] h-5 ${
                                                            t.status === 'COMPLETED'
                                                                ? 'text-green-700 bg-green-50 border-green-300'
                                                                : 'text-amber-700 bg-amber-50 border-amber-300'
                                                        }`}
                                                    >
                                                        {t.status === 'COMPLETED' ? 'Completado' : 'Pendiente'}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </AdminLayout>
    )
}
