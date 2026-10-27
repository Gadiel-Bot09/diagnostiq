"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { FileUp, FileText, X, Loader2, CheckCircle, Eye, ArrowRight, Layers, Microscope, UploadCloud } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PdfPreviewModal } from "@/components/common/PdfPreviewModal"
import { DicomViewerModal } from "@/components/common/DicomViewerModal"
import { isDicomFile } from "@/lib/dicom"
import { uploadWithProgress } from "@/lib/uploadWithProgress"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

export interface OrderTestOption {
    id: string
    name: string
    category?: string | null
    status?: string
}

interface ResultUploaderProps {
    orderId: string
    patientId: string
    labId: string
    currentVersion?: number
    orderTests?: OrderTestOption[]
    selectedOrderTestId?: string | null
    onUploadSuccess?: () => void
}

export function ResultUploader({
    orderId,
    patientId,
    labId,
    currentVersion = 1,
    orderTests = [],
    selectedOrderTestId = null,
    onUploadSuccess,
}: ResultUploaderProps) {
    const [files, setFiles] = useState<File[]>([])
    const [isUploading, setIsUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [uploadStatus, setUploadStatus] = useState<{
        fileName: string
        percent: number
        loadedMB: number
        totalMB: number
        fileIndex: number
        totalFiles: number
    } | null>(null)
    const [isSuccess, setIsSuccess] = useState(false)
    const todayStr = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10) // hora Colombia
    const [performedAt, setPerformedAt] = useState("")
    const [selectedTestId, setSelectedTestId] = useState<string>(() => {
        if (selectedOrderTestId) return selectedOrderTestId
        if (orderTests && orderTests.length === 1) return orderTests[0].id
        return ""
    })
    const [previewModal, setPreviewModal] = useState<{ url: string; name: string; subtitle?: string; isBlob?: boolean } | null>(null)
    const [dicomPreviewModal, setDicomPreviewModal] = useState<{ url: string; name: string; subtitle?: string; isBlob?: boolean } | null>(null)
    const { toast } = useToast()
    const supabase = createClient()
    const router = useRouter()

    const openLocalPreview = (file: File) => {
        const objectUrl = URL.createObjectURL(file)
        const isDicom = isDicomFile({ file_name: file.name, mime_type: file.type })

        if (isDicom) {
            setDicomPreviewModal({
                url: objectUrl,
                name: file.name,
                subtitle: `${(file.size / 1024 / 1024).toFixed(1)} MB · Tomografía DICOM`,
                isBlob: true,
            })
        } else {
            setPreviewModal({
                url: objectUrl,
                name: file.name,
                subtitle: `${(file.size / 1024).toFixed(0)} KB · Archivo listo para subir`,
                isBlob: true,
            })
        }
    }

    const closePreview = () => {
        if (previewModal?.isBlob && previewModal.url) {
            URL.revokeObjectURL(previewModal.url)
        }
        setPreviewModal(null)
    }

    const closeDicomPreview = () => {
        if (dicomPreviewModal?.isBlob && dicomPreviewModal.url) {
            URL.revokeObjectURL(dicomPreviewModal.url)
        }
        setDicomPreviewModal(null)
    }

    const onDrop = useCallback((acceptedFiles: File[], fileRejections: any[]) => {
        // Fallback: recuperar archivos por extensión si el tipo MIME del navegador no fue reconocido (ej: application/octet-stream en Windows)
        const recovered: File[] = []
        if (fileRejections && fileRejections.length > 0) {
            fileRejections.forEach(rej => {
                const name = rej.file.name.toLowerCase()
                if (name.endsWith('.zip') || name.endsWith('.dcm') || name.endsWith('.pdf')) {
                    if (rej.file.size <= 350 * 1024 * 1024) {
                        recovered.push(rej.file)
                    } else {
                        toast({
                            variant: "destructive",
                            title: "Archivo demasiado grande",
                            description: `El archivo ${rej.file.name} (${(rej.file.size / (1024 * 1024)).toFixed(1)} MB) supera el límite máximo de 350 MB.`,
                        })
                    }
                } else {
                    toast({
                        variant: "destructive",
                        title: "Formato no compatible",
                        description: `El archivo ${rej.file.name} no es un formato válido (.pdf, .zip, .dcm).`,
                    })
                }
            })
        }

        const validFiles = [...acceptedFiles, ...recovered]
        if (validFiles.length > 0) {
            setFiles(prev => {
                const existing = new Set(prev.map(f => `${f.name}-${f.size}`))
                const toAdd = validFiles.filter(f => !existing.has(`${f.name}-${f.size}`))
                return [...prev, ...toAdd]
            })
            setIsSuccess(false)
            setProgress(0)
            toast({
                title: "Archivo seleccionado",
                description: `${validFiles.length} archivo(s) listo(s) para subir.`,
            })
        }
    }, [toast])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
            'application/x-zip': ['.zip'],
            'application/octet-stream': ['.zip', '.dcm', '.rar'],
            'application/dicom': ['.dcm'],
            'application/x-compressed': ['.zip'],
            'multipart/x-zip': ['.zip'],
        },
        maxSize: 350 * 1024 * 1024, // 350 MB límite seguro para tomografías volumétricas
        disabled: isUploading || isSuccess
    })

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index))
    }

    const handleUpload = async () => {
        if (files.length === 0) return

        if (!performedAt) {
            toast({ variant: "destructive", title: "Fecha requerida", description: "Indica la fecha de realización de los exámenes." })
            return
        }

        setIsUploading(true)
        setProgress(0)
        setUploadStatus({
            fileName: files[0]?.name || "Archivo",
            percent: 0,
            loadedMB: 0,
            totalMB: files[0]?.size ? files[0].size / (1024 * 1024) : 0,
            fileIndex: 1,
            totalFiles: files.length,
        })

        try {
            let successCount = 0

            for (let i = 0; i < files.length; i++) {
                const fileToUpload = files[i]
                const version = currentVersion + i + (isSuccess ? 0 : (currentVersion > 0 ? 1 : 1))
                const isDicom = isDicomFile({ file_name: fileToUpload.name, mime_type: fileToUpload.type })

                const formData = new FormData()
                formData.append("file", fileToUpload)
                formData.append("orderId", orderId)
                formData.append("patientId", patientId)
                formData.append("labId", labId)
                formData.append("version", version.toString())
                formData.append("performedAt", performedAt)
                formData.append("fileType", isDicom ? "DICOM_ZIP" : "PDF")
                if (selectedTestId && selectedTestId !== "GENERAL") {
                    formData.append("orderTestId", selectedTestId)
                }

                setUploadStatus({
                    fileName: fileToUpload.name,
                    percent: 0,
                    loadedMB: 0,
                    totalMB: fileToUpload.size / (1024 * 1024),
                    fileIndex: i + 1,
                    totalFiles: files.length,
                })

                await uploadWithProgress(
                    "/api/results/upload",
                    formData,
                    (p) => {
                        setUploadStatus({
                            fileName: fileToUpload.name,
                            percent: p.percent,
                            loadedMB: p.loadedMB,
                            totalMB: p.totalMB,
                            fileIndex: i + 1,
                            totalFiles: files.length,
                        })
                        const overall = Math.round(((i + (p.percent / 100)) / files.length) * 100)
                        setProgress(overall)
                    }
                )

                successCount++
            }

            setProgress(100)
            setIsSuccess(true)
            onUploadSuccess?.()
            toast({
                title: "¡Éxito!",
                description: `Se han cargado ${successCount} archivo(s) correctamente.`,
            })

            router.refresh()
        } catch (error: any) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error de carga",
                description: error.message || "Ocurrió un error inesperado al subir el archivo.",
            })
        } finally {
            setIsUploading(false)
        }
    }

    const activeTest = orderTests?.find(t => t.id === selectedTestId)
    const hasDicomFiles = files.some(f => isDicomFile({ file_name: f.name, mime_type: f.type }))

    return (
        <div className="space-y-4">
            {orderTests && orderTests.length > 0 && (
                <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                    <Label htmlFor="orderTestSelect" className="text-sm font-semibold flex items-center gap-2 text-blue-900">
                        <Microscope className="h-4 w-4 text-blue-600" />
                        Examen al que corresponde este resultado
                    </Label>
                    <Select
                        value={selectedTestId || "GENERAL"}
                        onValueChange={(val) => setSelectedTestId(val === "GENERAL" ? "" : val)}
                        disabled={isUploading || isSuccess}
                    >
                        <SelectTrigger id="orderTestSelect" className="bg-white border-blue-200">
                            <SelectValue placeholder="Seleccionar examen..." />
                        </SelectTrigger>
                        <SelectContent>
                            {orderTests.map((ot) => (
                                <SelectItem key={ot.id} value={ot.id}>
                                    {ot.name} {ot.category ? `(${ot.category})` : ""} {ot.status === 'COMPLETED' ? '• [Completado]' : '• [Pendiente]'}
                                </SelectItem>
                            ))}
                            <SelectItem value="GENERAL">
                                📄 Reporte General (Aplica a toda la orden)
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-blue-700/80">
                        Cada examen dentro de la misma orden puede tener su propio documento PDF o tomografía 3D adjunta.
                    </p>
                </div>
            )}

            <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <Label htmlFor="performedAt" className="text-sm font-semibold">
                    Fecha de realización de los exámenes <span className="text-destructive">*</span>
                </Label>
                <Input
                    id="performedAt"
                    type="date"
                    required
                    max={todayStr}
                    value={performedAt}
                    onChange={(e) => setPerformedAt(e.target.value)}
                    disabled={isUploading}
                    className="max-w-xs bg-white"
                />
                <p className="text-xs text-muted-foreground">
                    Día en que se tomaron/realizaron los exámenes o la tomografía.
                </p>
            </div>

            {isUploading ? (
                <div className="rounded-2xl border-2 border-primary/30 bg-gradient-to-b from-blue-50/70 via-indigo-50/30 to-white dark:from-slate-900/60 dark:to-slate-950 p-6 sm:p-8 text-center space-y-5 shadow-sm animate-in fade-in duration-300">
                    {/* Animated Upload Icon */}
                    <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
                        <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                        <div className="relative w-14 h-14 rounded-full bg-primary text-white flex items-center justify-center shadow-md">
                            <UploadCloud className="h-7 w-7 animate-bounce" />
                        </div>
                    </div>

                    {/* Headline and file info */}
                    <div className="space-y-1">
                        <h3 className="text-xl font-bold text-foreground">
                            Subiendo Tomografía / Resultado Oficial
                        </h3>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-md mx-auto">
                            {uploadStatus?.fileName}
                        </p>
                        {uploadStatus && uploadStatus.totalFiles > 1 && (
                            <p className="text-xs text-muted-foreground">
                                Archivo {uploadStatus.fileIndex} de {uploadStatus.totalFiles}
                            </p>
                        )}
                    </div>

                    {/* Big percentage & MB transferred */}
                    <div className="space-y-2">
                        <div className="flex items-baseline justify-center gap-2">
                            <span className="text-5xl font-black text-primary tracking-tight">
                                {uploadStatus?.percent ?? 0}%
                            </span>
                            {uploadStatus && uploadStatus.totalMB > 0 && (
                                <span className="text-sm font-semibold text-muted-foreground">
                                    ({uploadStatus.loadedMB.toFixed(1)} MB / {uploadStatus.totalMB.toFixed(1)} MB)
                                </span>
                            )}
                        </div>

                        {/* Thick Animated Progress Bar */}
                        <div className="w-full max-w-md mx-auto bg-slate-200 dark:bg-slate-800 h-3.5 rounded-full overflow-hidden p-0.5 shadow-inner">
                            <div
                                className="h-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-full transition-all duration-150 ease-out shadow-sm"
                                style={{ width: `${Math.max(uploadStatus?.percent ?? 0, 3)}%` }}
                            />
                        </div>
                    </div>

                    {/* Dynamic Status Note */}
                    <div className="pt-1">
                        {(uploadStatus?.percent ?? 0) >= 99 ? (
                            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 animate-pulse">
                                Archivo transferido al 100%. Guardando y verificando en MinIO... Un momento por favor.
                            </p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                Transfiriendo datos de forma segura. No cierres ni recargues esta ventana.
                            </p>
                        )}
                    </div>
                </div>
            ) : (
                <div
                    {...getRootProps()}
                    className={`
                        border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer
                        ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/50'}
                        ${isSuccess ? 'border-green-500 bg-green-50/50' : ''}
                    `}
                >
                    <input {...getInputProps()} />
                    <div className="flex flex-col items-center gap-3">
                        {isSuccess ? (
                            <CheckCircle className="h-12 w-12 text-green-500" />
                        ) : (
                            <div className="flex items-center gap-2 text-primary">
                                <FileUp className={`h-10 w-10 ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
                                <Layers className="h-10 w-10 text-indigo-500" />
                            </div>
                        )}

                        <div>
                            <p className="text-lg font-semibold">
                                {files.length > 0
                                    ? `${files.length} archivo(s) seleccionado(s)`
                                    : (isDragActive ? "Suelta los archivos aquí" : "Arrastra reportes PDF o Tomografías DICOM (.zip)")}
                            </p>
                            <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
                                {files.length > 0
                                    ? `Tamaño total: ${(files.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(2)} MB`
                                    : "Admite informes PDF y series tomográficas completas en formato .ZIP (hasta 350 MB)"}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Selected files list with preview button */}
            {files.length > 0 && !isUploading && !isSuccess && (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-2">
                    {files.map((f, idx) => {
                        const isDicom = isDicomFile({ file_name: f.name, mime_type: f.type })
                        return (
                            <div key={idx} className="flex items-center justify-between p-2.5 border rounded-lg text-sm bg-muted/30">
                                <div className="flex items-center gap-2 truncate pr-2">
                                    {isDicom ? (
                                        <Layers className="h-4 w-4 text-indigo-600 shrink-0" />
                                    ) : (
                                        <FileText className="h-4 w-4 text-rose-500 shrink-0" />
                                    )}
                                    <span className="truncate font-medium">{f.name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        ({(f.size / (1024 * 1024)).toFixed(1)} MB)
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                                        isDicom
                                            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                             : "bg-rose-50 text-rose-700 border-rose-200"
                                    }`}>
                                        {isDicom ? "Tomografía DICOM" : "Informe PDF"}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2.5 text-xs gap-1 text-blue-700 border-blue-200 bg-blue-50/50 hover:bg-blue-100"
                                        onClick={() => openLocalPreview(f)}
                                    >
                                        <Eye className="h-3.5 w-3.5" />
                                        Previsualizar
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => removeFile(idx)}
                                        className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}



            {files.length > 0 && !isUploading && !isSuccess && (
                <Button className="w-full py-6 text-lg bg-primary hover:bg-primary/90" onClick={handleUpload}>
                    {hasDicomFiles ? "Subir Tomografía / Resultados Oficiales" : "Subir como Versión Oficial"}
                </Button>
            )}

            {isSuccess && (
                <div className="space-y-3 pt-2">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-800 text-center space-y-1.5">
                        <CheckCircle className="h-7 w-7 text-emerald-600 mx-auto" />
                        <p className="font-semibold text-base">
                            ¡Resultado cargado exitosamente{activeTest ? ` para ${activeTest.name}` : ""}!
                        </p>
                        <p className="text-xs text-emerald-700">
                            {activeTest
                                ? `El archivo ha sido asociado al examen "${activeTest.name}". Puedes previsualizarlo o continuar con los demás exámenes.`
                                : "El archivo ha sido registrado en el sistema. Puedes previsualizarlo o ir a la vista general de la orden."
                            }
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        {files.length > 0 && (
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1 gap-2 h-11 text-blue-700 border-blue-200 bg-blue-50/40 hover:bg-blue-100/60 font-medium"
                                onClick={() => openLocalPreview(files[0])}
                            >
                                <Eye className="h-4 w-4" />
                                Previsualizar resultado
                            </Button>
                        )}
                        <Button
                            type="button"
                            className="flex-1 gap-2 h-11 bg-primary text-white font-medium"
                            onClick={() => router.push(`/app/orders/${orderId}`)}
                        >
                            Ver detalle de la orden <ArrowRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {orderTests && orderTests.some((t) => t.id !== selectedTestId && t.status !== 'COMPLETED') && (
                        <Button
                            type="button"
                            variant="secondary"
                            className="w-full gap-2 border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
                            onClick={() => {
                                const nextPending = orderTests.find((t) => t.id !== selectedTestId && t.status !== 'COMPLETED')
                                if (nextPending) setSelectedTestId(nextPending.id)
                                setFiles([])
                                setIsSuccess(false)
                            }}
                        >
                            <Microscope className="h-4 w-4" />
                            Cargar archivo para el siguiente examen pendiente
                        </Button>
                    )}

                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-muted-foreground text-xs"
                        onClick={() => { setFiles([]); setIsSuccess(false); setPerformedAt(""); }}
                    >
                        Cargar más archivos
                    </Button>
                </div>
            )}

            {/* Modal de Previsualización Oficial de PDF */}
            <PdfPreviewModal
                open={!!previewModal}
                onOpenChange={(open) => !open && closePreview()}
                title={previewModal?.name || ""}
                url={previewModal?.url || null}
                subtitle={previewModal?.subtitle}
            />

            {/* Modal de Previsualización Web 3D de Tomografía DICOM */}
            <DicomViewerModal
                open={!!dicomPreviewModal}
                onOpenChange={(open) => !open && closeDicomPreview()}
                title={dicomPreviewModal?.name || "Tomografía DICOM 3D"}
                zipUrl={dicomPreviewModal?.url || null}
                subtitle={dicomPreviewModal?.subtitle}
            />
        </div>
    )
}
