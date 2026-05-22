"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { FileUp, FileText, X, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import { Progress } from "@/components/ui/progress"

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
    const { toast } = useToast()
    const supabase = createClient()
    const router = useRouter()

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

    const calculateSHA256 = async (file: File) => {
        const buffer = await file.arrayBuffer()
        const hash = await crypto.subtle.digest('SHA-256', buffer)
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
    }

    const handleUpload = async () => {
        if (files.length === 0) return

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
        } finally {
            // We keep isUploading = false after success is handled
        }
    }

    return (
        <div className="space-y-4">
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

            {files.length > 0 && !isUploading && !isSuccess && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                    {files.map((f, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 border rounded text-sm bg-muted/30">
                            <div className="flex items-center gap-2 truncate">
                                <FileText className="h-4 w-4 text-rose-500 shrink-0" />
                                <span className="truncate">{f.name}</span>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => removeFile(idx)} className="h-6 w-6 text-destructive shrink-0">
                                <X className="h-4 w-4" />
                            </Button>
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
                <Button variant="outline" className="w-full" onClick={() => { setFiles([]); setIsSuccess(false); }}>
                    Cargar más archivos
                </Button>
            )}
        </div>
    )
}
