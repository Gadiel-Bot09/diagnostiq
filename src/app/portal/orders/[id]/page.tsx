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
    Loader2
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { getPatientOrderDetailsAction } from "../actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"

export default function OrderDetailsPage() {
    const { id } = useParams()
    const router = useRouter()
    const { toast } = useToast()
    const [isDownloading, setIsDownloading] = useState(false)
    const supabase = createClient()

    const { data: order, isLoading } = useQuery({
        queryKey: ["order", id],
        queryFn: async () => {
            return await getPatientOrderDetailsAction(id as string)
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

    if (isLoading) {
        return <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
    }

    if (!order) {
        return <div className="p-12 text-center">Orden no encontrada.</div>
    }

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
                                        {order.status}
                                    </Badge>
                                </CardTitle>
                                <div className="text-right flex flex-col items-end">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Calendar className="h-4 w-4" />
                                        {format(new Date(order.ordered_at), "PPP", { locale: es })}
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <h3 className="text-lg font-semibold mb-4">Detalle de Exámenes</h3>
                            <div className="space-y-4">
                                {order.order_tests.map((ot: any) => (
                                    <div key={ot.id} className="flex items-center justify-between p-4 border rounded-lg bg-card">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-primary/5 p-2 rounded-full">
                                                <Microscope className="h-5 w-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-medium">{ot.tests.name}</p>
                                                <p className="text-xs text-muted-foreground">{ot.tests.category}</p>
                                            </div>
                                        </div>
                                        <div>
                                            <Badge variant="ghost" className="text-green-600 font-semibold italic text-xs uppercase">
                                                procesado
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" />
                                Informe de Resultados (PDF)
                            </CardTitle>
                            <CardDescription>
                                Este documento contiene el reporte oficial firmado por el bacteriólogo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {order.result_files && order.result_files.length > 0 ? (
                                <div className="flex flex-col gap-4">
                                    {order.result_files.map((file: any) => (
                                        <div key={file.id} className="flex items-center justify-between p-4 bg-white border border-primary/10 rounded-xl shadow-sm">
                                            <div className="flex items-center gap-3">
                                                <FileText className="h-8 w-8 text-rose-500" />
                                                <div>
                                                    <p className="font-semibold text-sm">{file.file_name}</p>
                                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Versión {file.version}</p>
                                                </div>
                                            </div>
                                            <Button
                                                onClick={() => handleDownload(file.id)}
                                                disabled={isDownloading}
                                                className="gap-2"
                                            >
                                                {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                                Descargar Oficial
                                            </Button>
                                        </div>
                                    ))}
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
        </div>
    )
}
