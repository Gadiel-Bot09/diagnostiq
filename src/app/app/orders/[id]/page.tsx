// @ts-nocheck
"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    ArrowLeft,
    FileUp,
    User,
    Microscope,
    Calendar,
    FileText,
    Loader2,
    CheckCircle2,
    Clock,
    XCircle,
    Download,
    RefreshCw,
    FlaskConical,
    Eye,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { usePermissions } from "@/contexts/PermissionsContext"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/ui/use-toast"
import { PdfPreviewModal } from "@/components/common/PdfPreviewModal"
import Link from "next/link"

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    PENDING: {
        label: "Pendiente",
        color: "bg-amber-100 text-amber-800 border-amber-300",
        icon: <Clock className="h-4 w-4" />,
    },
    PROCESSING: {
        label: "En Proceso",
        color: "bg-blue-100 text-blue-800 border-blue-300",
        icon: <RefreshCw className="h-4 w-4 animate-spin" />,
    },
    COMPLETED: {
        label: "Completado",
        color: "bg-green-100 text-green-800 border-green-300",
        icon: <CheckCircle2 className="h-4 w-4" />,
    },
    CANCELLED: {
        label: "Cancelado",
        color: "bg-red-100 text-red-800 border-red-300",
        icon: <XCircle className="h-4 w-4" />,
    },
}

export default function AdminOrderDetailPage() {
    const { id } = useParams()
    const router = useRouter()
    const { toast } = useToast()
    const supabase = createClient()
    const queryClient = useQueryClient()
    const { hasPermission } = usePermissions()
    const [isDownloading, setIsDownloading] = useState(false)
    const [previewFile, setPreviewFile] = useState<{ url: string; name: string; subtitle?: string } | null>(null)
    const [previewingId, setPreviewingId] = useState<string | null>(null)

    const { data: order, isLoading } = useQuery({
        queryKey: ["admin-order-detail", id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("orders")
                .select(`
                    id,
                    order_number,
                    status,
                    ordered_at,
                    performed_at,
                    patients (
                        id,
                        full_name,
                        document_type,
                        document_number,
                        email,
                        phone,
                        dob,
                        sex
                    ),
                    order_tests (
                        id,
                        status,
                        result_summary_json,
                        tests (name, category, units, reference_range)
                    ),
                    result_files (
                        id,
                        file_name,
                        version,
                        size_bytes,
                        uploaded_at,
                        uploaded_by,
                        performed_at
                    )
                `)
                .eq("id", id)
                .single()

            if (error) throw error
            return data
        },
    })

    const { mutate: updateStatus, isPending: isUpdatingStatus } = useMutation({
        mutationFn: async (newStatus: string) => {
            const { error } = await supabase
                .from("orders")
                .update({ status: newStatus })
                .eq("id", id as string)

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-order-detail", id] })
            queryClient.invalidateQueries({ queryKey: ["lab-orders"] })
            toast({ title: "Estado actualizado", description: "El estado de la orden fue cambiado correctamente." })
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Error", description: err.message })
        },
    })

    const handleDownload = async (fileId: string) => {
        setIsDownloading(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-signed-url`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ result_file_id: fileId }),
            })
            const data = await response.json()
            if (data.signedUrl) {
                window.open(data.signedUrl, "_blank")
            } else {
                throw new Error("No se pudo generar el enlace de descarga")
            }
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error de descarga", description: error.message })
        } finally {
            setIsDownloading(false)
        }
    }

    const handlePreview = async (file: any) => {
        setPreviewingId(file.id)
        try {
            const res = await fetch(`/api/results/download?fileId=${file.id}&preview=true`)
            const data = await res.json()
            let previewUrl = data.url

            if (!previewUrl) {
                const { data: { session } } = await supabase.auth.getSession()
                const fallbackRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-signed-url`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${session?.access_token}`,
                    },
                    body: JSON.stringify({ result_file_id: file.id }),
                })
                const fallbackData = await fallbackRes.json()
                previewUrl = fallbackData.signedUrl
            }

            if (!previewUrl) {
                throw new Error(data.error || "No se pudo generar la vista previa del documento")
            }

            const uploaderName = file.uploaded_by ? uploadersMap.get(file.uploaded_by) : null
            const subtitle = `v${file.version} · ${file.size_bytes ? (file.size_bytes / 1024).toFixed(0) + " KB" : ""}${uploaderName ? ` · Cargado por: ${uploaderName}` : ""}`

            setPreviewFile({
                url: previewUrl,
                name: file.file_name,
                subtitle,
            })
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error de previsualización", description: err.message })
        } finally {
            setPreviewingId(null)
        }
    }

    const resultFiles = (order?.result_files as any[]) || []

    const uploaderIds = useMemo(() => {
        return Array.from(new Set(resultFiles.map((f: any) => f.uploaded_by).filter(Boolean)))
    }, [resultFiles])

    const { data: uploadersProfiles = [] } = useQuery({
        queryKey: ["uploaders-profiles", uploaderIds],
        queryFn: async () => {
            if (uploaderIds.length === 0) return []
            const { data } = await supabase.from("profiles").select("id, full_name, role").in("id", uploaderIds)
            return data || []
        },
        enabled: uploaderIds.length > 0
    })

    const uploadersMap = useMemo(() => new Map(uploadersProfiles.map((p: any) => [p.id, p.full_name])), [uploadersProfiles])

    const latestUploadDate = useMemo(() => {
        const uploadDates = resultFiles.map((f: any) => f.uploaded_at).filter(Boolean).sort()
        return uploadDates.length > 0 ? uploadDates[uploadDates.length - 1] : null
    }, [resultFiles])

    if (isLoading) {
        return (
            <AdminLayout>
                <div className="flex justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </AdminLayout>
        )
    }

    if (!order) {
        return (
            <AdminLayout>
                <div className="text-center p-12 text-muted-foreground">Orden no encontrada.</div>
            </AdminLayout>
        )
    }

    const currentStatus = STATUS_CONFIG[order.status] || STATUS_CONFIG["PENDING"]
    const patient = order.patients as any
    const orderTests = (order.order_tests as any[]) || []

    return (
        <AdminLayout>
            <div className="space-y-6 max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <Button variant="ghost" onClick={() => router.back()} className="gap-2 -ml-4">
                        <ArrowLeft className="h-4 w-4" /> Volver a órdenes
                    </Button>
                    {hasPermission("orders", "upload") && (
                    <Link href={`/app/orders/${id}/upload`}>
                        <Button className="gap-2 bg-blue-600 hover:bg-blue-700">
                            <FileUp className="h-4 w-4" /> Subir / Reemplazar PDF
                        </Button>
                    </Link>
                    )}
                </div>

                {/* Title row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-3 rounded-xl">
                            <FlaskConical className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">
                                Orden #{order.order_number}
                            </h1>
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {order.ordered_at ? format(new Date(order.ordered_at), "PPP 'a las' p", { locale: es }) : "—"}
                            </p>
                        </div>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium w-fit ${currentStatus.color}`}>
                        {currentStatus.icon}
                        {currentStatus.label}
                    </div>
                </div>

                {/* Trazabilidad de fechas */}
                <div className="grid sm:grid-cols-3 gap-3">
                    {[
                        {
                            label: "Orden generada",
                            value: order.ordered_at ? format(new Date(order.ordered_at), "dd/MM/yyyy HH:mm") : "—"
                        },
                        {
                            label: "Exámenes realizados",
                            value: order.performed_at
                                ? format(new Date(order.performed_at.includes("T") ? order.performed_at : order.performed_at + "T00:00:00"), "dd/MM/yyyy")
                                : "Pendiente"
                        },
                        {
                            label: "Resultados cargados",
                            value: latestUploadDate ? format(new Date(latestUploadDate), "dd/MM/yyyy HH:mm") : "Pendiente"
                        },
                    ].map((d, i) => (
                        <div key={d.label} className="rounded-xl border border-indigo-100 bg-white p-3 flex items-center gap-3">
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${["bg-indigo-500", "bg-blue-500", "bg-emerald-500"][i]}`}>{i + 1}</div>
                            <div>
                                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{d.label}</p>
                                <p className="text-sm font-semibold">{d.value}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* LEFT: main content */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* Exámenes */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Microscope className="h-5 w-5 text-primary" />
                                    Exámenes Solicitados
                                    <Badge variant="secondary" className="ml-auto">{orderTests.length}</Badge>
                                </CardTitle>
                                <CardDescription>
                                    Cada examen puede tener su propio documento de resultados adjunto de forma independiente.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {orderTests.length > 0 ? (
                                    <div className="space-y-3">
                                        {orderTests.map((ot: any, i: number) => {
                                            const testFile = (() => {
                                                if (ot.result_summary_json?.file_id) {
                                                    const found = resultFiles.find((f: any) => f.id === ot.result_summary_json.file_id)
                                                    if (found) return found
                                                }
                                                const byOrderTestId = resultFiles.find((f: any) => f.order_test_id === ot.id)
                                                if (byOrderTestId) return byOrderTestId
                                                if (orderTests.length === 1 && resultFiles.length > 0) {
                                                    return resultFiles[0]
                                                }
                                                return null
                                            })()

                                            const isCompleted = ot.status === 'COMPLETED' || !!testFile

                                            return (
                                                <div
                                                    key={ot.id}
                                                    className="p-4 rounded-xl border bg-card hover:border-primary/30 transition-all space-y-3"
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                                                                {i + 1}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-semibold text-sm truncate">{ot.tests?.name || "Examen"}</p>
                                                                {ot.tests?.category && (
                                                                    <p className="text-xs text-muted-foreground">{ot.tests.category}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <Badge
                                                            variant="outline"
                                                            className={isCompleted
                                                                ? "text-green-700 border-green-300 bg-green-50 font-medium"
                                                                : "text-amber-700 border-amber-300 bg-amber-50 font-medium"
                                                            }
                                                        >
                                                            {isCompleted ? '✓ Completado' : '⏳ Pendiente'}
                                                        </Badge>
                                                    </div>

                                                    {/* Documento adjunto para este examen */}
                                                    {testFile ? (
                                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-emerald-150 bg-emerald-50/50">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className="bg-rose-50 p-2 rounded-md text-rose-500 shrink-0">
                                                                    <FileText className="h-4 w-4" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="font-semibold text-xs truncate text-foreground">{testFile.file_name}</p>
                                                                    <p className="text-[11px] text-muted-foreground">
                                                                        v{testFile.version} · {testFile.size_bytes ? `${(testFile.size_bytes / 1024).toFixed(0)} KB · ` : ""}
                                                                        Cargado: {testFile.uploaded_at ? format(new Date(testFile.uploaded_at), "dd/MM/yyyy HH:mm") : "—"}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="h-8 text-xs gap-1.5 text-blue-700 border-blue-200 bg-blue-50/60 hover:bg-blue-100"
                                                                    onClick={() => handlePreview(testFile)}
                                                                    disabled={previewingId === testFile.id}
                                                                >
                                                                    {previewingId === testFile.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                                                                    Previsualizar
                                                                </Button>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="h-8 text-xs gap-1.5"
                                                                    onClick={() => handleDownload(testFile.id)}
                                                                    disabled={isDownloading}
                                                                >
                                                                    {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                                                    Descargar
                                                                </Button>
                                                                {hasPermission("orders", "upload") && (
                                                                    <Link href={`/app/orders/${id}/upload?orderTestId=${ot.id}`}>
                                                                        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1">
                                                                            <FileUp className="h-3.5 w-3.5" /> Reemplazar
                                                                        </Button>
                                                                    </Link>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-lg border border-dashed border-amber-200 bg-amber-50/40">
                                                            <span className="text-xs text-amber-800 font-medium flex items-center gap-1.5">
                                                                <Clock className="h-3.5 w-3.5 text-amber-600" />
                                                                Sin archivo de resultado cargado para este examen
                                                            </span>
                                                            {hasPermission("orders", "upload") && (
                                                                <Link href={`/app/orders/${id}/upload?orderTestId=${ot.id}`}>
                                                                    <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs">
                                                                        <FileUp className="h-3.5 w-3.5" /> Subir PDF de este examen
                                                                    </Button>
                                                                </Link>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">No hay exámenes registrados en esta orden.</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Archivos PDF */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-rose-500" />
                                    Reportes en PDF
                                    <Badge variant="secondary" className="ml-auto">{resultFiles.length}</Badge>
                                </CardTitle>
                                <CardDescription>
                                    Historial de todos los archivos cargados para esta orden.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {resultFiles.length > 0 ? (
                                    <div className="space-y-3">
                                        {resultFiles.map((file: any) => {
                                            const linkedTest = orderTests.find((ot: any) => ot.result_summary_json?.file_id === file.id || ot.id === file.order_test_id)
                                            return (
                                                <div
                                                    key={file.id}
                                                    className="flex items-center gap-4 p-4 border rounded-xl bg-card hover:bg-muted/30 transition-colors"
                                                >
                                                    <div className="bg-rose-50 p-2.5 rounded-lg">
                                                        <FileText className="h-5 w-5 text-rose-500" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <p className="font-semibold text-sm truncate">{file.file_name}</p>
                                                            {linkedTest ? (
                                                                <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                                                    Examen: {linkedTest.tests?.name}
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                                                    Reporte General
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            v{file.version} · {file.size_bytes ? `${(file.size_bytes / 1024).toFixed(0)} KB · ` : ""}{file.uploaded_at ? format(new Date(file.uploaded_at), "dd/MM/yyyy HH:mm") : "—"}
                                                            {file.uploaded_by && uploadersMap.get(file.uploaded_by) && (
                                                                <span className="ml-1.5 text-indigo-600 font-medium">
                                                                    · Cargado por: {uploadersMap.get(file.uploaded_by)}
                                                                </span>
                                                            )}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="gap-1.5 h-8 text-xs text-blue-700 border-blue-200 bg-blue-50/40 hover:bg-blue-100/60"
                                                            onClick={() => handlePreview(file)}
                                                            disabled={previewingId === file.id}
                                                        >
                                                            {previewingId === file.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                                                            Previsualizar
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="gap-1.5 h-8 text-xs"
                                                            onClick={() => handleDownload(file.id)}
                                                            disabled={isDownloading}
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
                                    <div className="border-2 border-dashed rounded-xl p-8 text-center">
                                        <FileUp className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                                        <p className="text-sm text-muted-foreground">No se han subido PDFs para esta orden aún.</p>
                                        {hasPermission("orders", "upload") && (
                                        <Link href={`/app/orders/${id}/upload`} className="mt-3 inline-block">
                                            <Button variant="outline" size="sm" className="gap-2 mt-2">
                                                <FileUp className="h-3.5 w-3.5" /> Subir primer PDF
                                            </Button>
                                        </Link>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* RIGHT: sidebar */}
                    <div className="space-y-6">
                        {/* Paciente */}
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                                    <User className="h-4 w-4" /> Datos del Paciente
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div>
                                    <p className="font-bold text-lg leading-tight">{patient?.full_name}</p>
                                    <p className="text-sm text-muted-foreground">{patient?.document_type}: {patient?.document_number}</p>
                                </div>
                                <Separator />
                                {patient?.email && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Email</span>
                                        <span className="font-medium truncate max-w-[140px]">{patient.email}</span>
                                    </div>
                                )}
                                {patient?.phone && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Teléfono</span>
                                        <span className="font-medium">{patient.phone}</span>
                                    </div>
                                )}
                                {patient?.dob && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">F. Nacimiento</span>
                                        <span className="font-medium">{format(new Date(patient.dob.includes("T") ? patient.dob : patient.dob + "T00:00:00"), "dd/MM/yyyy")}</span>
                                    </div>
                                )}
                                {patient?.sex && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Sexo</span>
                                        <span className="font-medium capitalize">{patient.sex.toLowerCase()}</span>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Cambiar estado */}
                        {hasPermission("orders", "edit") && (
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                                    <RefreshCw className="h-4 w-4" /> Cambiar Estado
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Actualiza el progreso de esta orden.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Select
                                    defaultValue={order.status}
                                    onValueChange={(val) => updateStatus(val)}
                                    disabled={isUpdatingStatus}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PENDING">⏳ Pendiente</SelectItem>
                                        <SelectItem value="PROCESSING">🔄 En Proceso</SelectItem>
                                        <SelectItem value="COMPLETED">✅ Completado</SelectItem>
                                        <SelectItem value="CANCELLED">❌ Cancelado</SelectItem>
                                    </SelectContent>
                                </Select>
                                {isUpdatingStatus && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Actualizando...
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                        )}

                        {/* Info adicional */}
                        <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-xs text-blue-700 space-y-1">
                            <p className="font-bold uppercase tracking-widest text-[10px] text-blue-500 mb-2">Nota Interna</p>
                            <p>Al marcar como <strong>Completado</strong>, el paciente podrá ver su resultado desde el portal de acceso.</p>
                        </div>
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

            {/* Modal de Visualización 3D Universal de Tomografía DICOM */}
            <DicomViewerModal
                open={!!dicomModal}
                onOpenChange={(open) => !open && setDicomModal(null)}
                title={dicomModal?.name || "Tomografía DICOM 3D"}
                zipUrl={dicomModal?.url || null}
                downloadUrl={dicomModal?.downloadUrl}
                subtitle={dicomModal?.subtitle}
            />
        </AdminLayout>
    )
}
