// @ts-nocheck
"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    ArrowLeft,
    Download,
    FileText,
    Microscope,
    Calendar,
    CheckCircle2,
    ExternalLink,
    Loader2,
    Eye,
    Clock,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { PdfPreviewModal } from "@/components/common/PdfPreviewModal"

export default function OrderDetailsPage() {
    const { id } = useParams()
    const router = useRouter()
    const { toast } = useToast()
    const [isDownloading, setIsDownloading] = useState(false)
    const [previewFile, setPreviewFile] = useState<{ url: string; name: string; subtitle?: string } | null>(null)
    const [previewingId, setPreviewingId] = useState<string | null>(null)
    const supabase = createClient()

    const { data: order, isLoading } = useQuery({
        queryKey: ["order", id],
        queryFn: async () => {
            const res = await fetch(`/api/portal/orders/${id}`)
            if (!res.ok) throw new Error("Error al cargar la orden")
            return res.json()
        },
    })

    const handleDownload = async (fileId: string) => {
        setIsDownloading(true)
        try {
            const response = await fetch(`/api/results/download?fileId=${fileId}`)
            const data = await response.json()
            
            if (!response.ok) {
                throw new Error(data.error || "Error al descargar el archivo")
            }
            
            if (data.url) {
                window.open(data.url, "_blank")
            } else {
                throw new Error("No se pudo generar el link de descarga")
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error de descarga",
                description: error.message,
            })
        } finally {
            setIsDownloading(false)
        }
    }

    const handlePreview = async (file: any, examTitle?: string) => {
        setPreviewingId(file.id)
        try {
            const res = await fetch(`/api/results/download?fileId=${file.id}&preview=true`)
            const data = await res.json()
            if (!res.ok || !data.url) throw new Error(data.error || "No se pudo obtener el archivo")
            const performed = file.performed_at || order?.performed_at
            setPreviewFile({
                url: data.url,
                name: `${examTitle || file.file_name} · #${order.order_number}`,
                subtitle: performed ? `Realizado: ${format(new Date(performed.includes("T") ? performed : performed + "T00:00:00"), "dd/MM/yyyy")}` : undefined,
            })
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error al previsualizar", description: err.message })
        } finally {
            setPreviewingId(null)
        }
    }

    const getTestFile = (ot: any) => {
        const files = order?.result_files || []
        if (files.length === 0) return null

        if (ot.result_summary_json?.file_id) {
            const found = files.find((f: any) => f.id === ot.result_summary_json.file_id)
            if (found) return found
        }

        const byOrderTestId = files.find((f: any) => f.order_test_id === ot.id)
        if (byOrderTestId) return byOrderTestId

        if (order?.order_tests?.length === 1 && files.length > 0) {
            return files[0]
        }

        return null
    }

    if (isLoading) {
        return <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
    }

    if (!order) {
        return <div className="p-12 text-center">Orden no encontrada.</div>
    }

    const orderTests = order.order_tests || []

    return (
        <div className="min-h-screen bg-muted/20 p-6 lg:p-12 space-y-6">
            <Button variant="ghost" onClick={() => router.back()} className="gap-2 -ml-4">
                <ArrowLeft className="h-4 w-4" /> Volver al portal
            </Button>

            <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader className="border-b bg-card pb-6">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-2xl font-bold flex items-center gap-3">
                                    Orden #{order.order_number}
                                    <Badge variant={order.status === 'COMPLETED' ? 'default' : 'outline'} className={order.status === 'COMPLETED' ? 'bg-green-500' : ''}>
                                        {order.status === 'COMPLETED' ? 'Completada' : 'En Proceso'}
                                    </Badge>
                                </CardTitle>
                                <div className="text-right flex flex-col items-end gap-1">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Calendar className="h-4 w-4" />
                                        Orden: {format(new Date(order.ordered_at), "PPP", { locale: es })}
                                    </div>
                                    {order.performed_at && (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Microscope className="h-4 w-4" />
                                            Exámenes realizados: {format(new Date(order.performed_at + "T00:00:00"), "PPP", { locale: es })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <h3 className="text-lg font-semibold mb-4">Detalle de Exámenes y Resultados</h3>
                            <div className="space-y-4">
                                {orderTests.map((ot: any) => {
                                    const testFile = getTestFile(ot)
                                    const isReady = !!testFile
                                    return (
                                        <div key={ot.id} className="p-4 border rounded-xl bg-card space-y-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="bg-primary/10 p-2.5 rounded-full text-primary shrink-0">
                                                        <Microscope className="h-5 w-5" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-base truncate">{ot.tests?.name || "Examen"}</p>
                                                        {ot.tests?.category && (
                                                            <p className="text-xs text-muted-foreground">{ot.tests.category}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    {isReady ? (
                                                        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs">
                                                            <CheckCircle2 className="h-3.5 w-3.5" /> Resultado Listo
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 gap-1 text-xs">
                                                            <Clock className="h-3.5 w-3.5" /> En Proceso
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>

                                            {testFile ? (
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-emerald-50/50 border border-emerald-150 rounded-lg">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <FileText className="h-6 w-6 text-rose-500 shrink-0" />
                                                        <div className="min-w-0">
                                                            <p className="font-semibold text-xs text-foreground truncate">{testFile.file_name}</p>
                                                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                                                Versión {testFile.version}
                                                                {(testFile.performed_at || order.performed_at) && (
                                                                    <> · Realizado: {format(new Date(((testFile.performed_at || order.performed_at) + "T00:00:00").slice(0, 19)), "dd/MM/yyyy")}</>
                                                                )}
                                                                {testFile.uploaded_at && (
                                                                    <> · Cargado: {format(new Date(testFile.uploaded_at), "dd/MM/yyyy")}</>
                                                                )}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 text-xs gap-1.5 text-blue-700 border-blue-200 bg-blue-50/60 hover:bg-blue-100"
                                                            onClick={() => handlePreview(testFile, ot.tests?.name)}
                                                            disabled={previewingId === testFile.id}
                                                        >
                                                            {previewingId === testFile.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                                                            Previsualizar
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            className="h-8 text-xs gap-1.5 bg-primary text-white"
                                                            onClick={() => handleDownload(testFile.id)}
                                                            disabled={isDownloading}
                                                        >
                                                            {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                                            Descargar PDF
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-3 bg-muted/40 border border-dashed rounded-lg text-xs text-muted-foreground flex items-center gap-2">
                                                    <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                                                    El laboratorio aún no ha cargado el documento para este examen.
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" />
                                Historial de Documentos PDF
                            </CardTitle>
                            <CardDescription>
                                Documentos oficiales emitidos por el laboratorio para esta orden.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {order.result_files && order.result_files.length > 0 ? (
                                <div className="flex flex-col gap-4">
                                    {order.result_files.map((file: any) => {
                                        const linkedTest = orderTests.find((ot: any) => ot.result_summary_json?.file_id === file.id || ot.id === file.order_test_id)
                                        return (
                                            <div key={file.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white border border-primary/10 rounded-xl shadow-sm">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <FileText className="h-8 w-8 text-rose-500 shrink-0" />
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <p className="font-semibold text-sm truncate">{file.file_name}</p>
                                                            {linkedTest ? (
                                                                <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                                                    Examen: {linkedTest.tests?.name}
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                                                    General
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mt-0.5">Versión {file.version}</p>
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            Realizado: {(file.performed_at || order.performed_at) ? format(new Date(((file.performed_at || order.performed_at) + "T00:00:00").slice(0, 19)), "dd/MM/yyyy") : "—"}
                                                            {" · "}Cargado: {file.uploaded_at ? format(new Date(file.uploaded_at), "dd/MM/yyyy") : "—"}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 text-xs gap-1.5 text-blue-700 border-blue-200 bg-blue-50/60 hover:bg-blue-100"
                                                        onClick={() => handlePreview(file, linkedTest?.tests?.name)}
                                                        disabled={previewingId === file.id}
                                                    >
                                                        {previewingId === file.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                                                        Previsualizar
                                                    </Button>
                                                    <Button
                                                        onClick={() => handleDownload(file.id)}
                                                        disabled={isDownloading}
                                                        size="sm"
                                                        className="h-8 text-xs gap-1.5"
                                                    >
                                                        {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                                        Descargar
                                                    </Button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="p-8 border-2 border-dashed rounded-lg text-center text-muted-foreground">
                                    Los archivos PDF aún no están disponibles para esta orden.
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-md">Información del Laboratorio</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-4">
                            <div>
                                <p className="text-muted-foreground font-medium uppercase text-[10px] tracking-widest mb-1">Laboratorio</p>
                                <p className="font-bold text-lg text-primary">{order.labs.name}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground font-medium uppercase text-[10px] tracking-widest mb-1">Contacto</p>
                                <p>{order.labs.phone || 'No disponible'}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground font-medium uppercase text-[10px] tracking-widest mb-1">Dirección</p>
                                <p>{order.labs.address || 'No disponible'}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg text-yellow-800 text-xs flex gap-3">
                        <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                        <p>
                            Para interpretar correctamente estos resultados, consulte a su médico tratante. No se automedique basándose en esta información.
                        </p>
                    </div>
                </div>
            </div>

            <PdfPreviewModal
                open={!!previewFile}
                onOpenChange={(open) => !open && setPreviewFile(null)}
                title={previewFile?.name || ""}
                url={previewFile?.url || null}
                subtitle={previewFile?.subtitle}
            />
        </div>
    )
}
