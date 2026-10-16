"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { FileUp, FileText, X, Loader2, CheckCircle, Eye, ArrowRight } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PdfPreviewModal } from "@/components/common/PdfPreviewModal"

interface ResultUploaderProps {
    orderId: string
    patientId: string
    labId: string
    currentVersion?: number
}

export function ResultUploader({ orderId, patientId, labId, currentVersion = 1 }: ResultUploaderProps) {
    const [files, setFiles] = useState<File[]>([])
    const [isUploading, setIsUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [isSuccess, setIsSuccess] = useState(false)
    const todayStr = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10) // hora Colombia
    const [performedAt, setPerformedAt] = useState("")
    const [previewModal, setPreviewModal] = useState<{ url: string; name: string; subtitle?: string; isBlob?: boolean } | null>(null)
    const { toast } = useToast()
    const supabase = createClient()
    const router = useRouter()

    const openLocalPreview = (file: File) => {
        const objectUrl = URL.createObjectURL(file)
        setPreviewModal({
            url: objectUrl,
            name: file.name,
            subtitle: `${(file.size / 1024).toFixed(0)} KB · Archivo listo para subir`,
            isBlob: true,
        })
    }

    const closePreview = () => {
        if (previewModal?.isBlob && previewModal.url) {
            URL.revokeObjectURL(previewModal.url)
        }
        setPreviewModal(null)
    }

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setFiles(prev => [...prev, ...acceptedFiles])
            setIsSuccess(false)
            setProgress(0)
        }
    }, [])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/pdf': ['.pdf'] },
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
        setProgress(5)

        try {
            let successCount = 0
            
            for (let i = 0; i < files.length; i++) {
                const fileToUpload = files[i]
                const version = currentVersion + i + (isSuccess ? 0 : (currentVersion > 0 ? 1 : 1))

                // Subir usando FormData a la API Route de MinIO
                const formData = new FormData()
                formData.append("file", fileToUpload)
                formData.append("orderId", orderId)
                formData.append("patientId", patientId)
                formData.append("labId", labId)
                formData.append("version", version.toString())
                formData.append("performedAt", performedAt)

                const uploadResponse = await fetch("/api/results/upload", {
                    method: "POST",
                    body: formData,
                })

                if (!uploadResponse.ok) {
                    const err = await uploadResponse.json()
                    throw new Error(err.error || `Error al subir el archivo ${fileToUpload.name}`)
                }
                
                successCount++
                setProgress(Math.round(((i + 1) / files.length) * 100))
            }

            setProgress(100)
            setIsSuccess(true)
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
                description: error.message || "Ocurrió un error inesperado.",
            })
            setIsUploading(false)
        }
    }

    return (
        <div className="space-y-4">
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
                    Día en que se tomaron/realizaron los exámenes. La fecha de cargue y la de la orden se registran automáticamente.
                </p>
            </div>

            <div
                {...getRootProps()}
                className={`
                    border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer
                    ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/50'}
                    ${isSuccess ? 'border-green-500 bg-green-50/50' : ''}
                    ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
                `}
            >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-3">
                    {isSuccess ? (
                        <CheckCircle className="h-12 w-12 text-green-500" />
                    ) : isUploading ? (
                        <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    ) : (
                        <FileUp className={`h-12 w-12 ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    )}

                    <div>
                        <p className="text-lg font-semibold">
                            {files.length > 0 ? `${files.length} archivo(s) seleccionado(s)` : (isDragActive ? "Suelta los archivos aquí" : "Arrastra los reportes PDF")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {files.length > 0 ? `Tamaño total: ${(files.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(2)} MB` : "O haz clic para seleccionar"}
                        </p>
                    </div>
                </div>
            </div>

            {/* Selected files list with preview button */}
            {files.length > 0 && !isUploading && !isSuccess && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                    {files.map((f, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2.5 border rounded-lg text-sm bg-muted/30">
                            <div className="flex items-center gap-2 truncate pr-2">
                                <FileText className="h-4 w-4 text-rose-500 shrink-0" />
                                <span className="truncate font-medium">{f.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
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
                    ))}
                </div>
            )}

            {isUploading && (
                <div className="space-y-2">
                    <Progress value={progress} className="h-1.5" />
                    <p className="text-[10px] text-center font-bold text-primary uppercase tracking-widest">Cargando datos a la nube...</p>
                </div>
            )}

            {files.length > 0 && !isUploading && !isSuccess && (
                <Button className="w-full py-6 text-lg" onClick={handleUpload}>
                    Subir como Versión Oficial
                </Button>
            )}

            {isSuccess && (
                <div className="space-y-3 pt-2">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-800 text-center space-y-1.5">
                        <CheckCircle className="h-7 w-7 text-emerald-600 mx-auto" />
                        <p className="font-semibold text-base">¡Resultados cargados exitosamente!</p>
                        <p className="text-xs text-emerald-700">
                            El PDF ha sido registrado en el sistema. Puedes previsualizarlo o ir a la vista general de la orden.
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
                                Previsualizar documento
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

            <PdfPreviewModal
                open={!!previewModal}
                onOpenChange={(open) => !open && closePreview()}
                title={previewModal?.name || ""}
                url={previewModal?.url || null}
                subtitle={previewModal?.subtitle}
            />
        </div>
    )
}
