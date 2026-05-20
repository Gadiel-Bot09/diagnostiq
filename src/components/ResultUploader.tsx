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
    const [file, setFile] = useState<File | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [isSuccess, setIsSuccess] = useState(false)
    const { toast } = useToast()
    const supabase = createClient()
    const router = useRouter()

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setFile(acceptedFiles[0])
            setIsSuccess(false)
            setProgress(0)
        }
    }, [])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/pdf': ['.pdf'] },
        maxFiles: 1,
        disabled: isUploading || isSuccess
    })

    const calculateSHA256 = async (file: File) => {
        const buffer = await file.arrayBuffer()
        const hash = await crypto.subtle.digest('SHA-256', buffer)
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
    }

    const handleUpload = async () => {
        if (!file) return

        setIsUploading(true)
        setProgress(10)

        try {
            const { data: { session } } = await supabase.auth.getSession()
            const year = new Date().getFullYear()
            const month = String(new Date().getMonth() + 1).padStart(2, '0')
            const version = currentVersion + (isSuccess ? 0 : (currentVersion > 0 ? 1 : 1))

            const fileName = `${orderId}_v${version}.pdf`
            const storagePath = `${labId}/${patientId}/${year}/${month}/${fileName}`
            const fileHash = await calculateSHA256(file)

            setProgress(30)

            // 1. Upload to Storage
            const { data: storageData, error: storageError } = await supabase.storage
                .from('diagnostiq-results')
                .upload(storagePath, file, {
                    cacheControl: '3600',
                    upsert: true
                })

            if (storageError) throw storageError
            setProgress(70)

            // 2. Finalize Metadata via Edge Function (to ensure consistency and audit)
            const finalizeResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/upload-finalize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    order_id: orderId,
                    patient_id: patientId,
                    lab_id: labId,
                    storage_path: storagePath,
                    file_name: file.name,
                    size_bytes: file.size,
                    sha256: fileHash,
                    version: version
                })
            })

            if (!finalizeResponse.ok) {
                const err = await finalizeResponse.json()
                throw new Error(err.error || 'Error al finalizar el registro')
            }

            setProgress(100)
            setIsSuccess(true)
            toast({
                title: "¡Éxito!",
                description: `Resultado v${version} cargado correctamente.`,
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
                            {file ? file.name : (isDragActive ? "Suelta el archivo aquí" : "Arrastra el reporte PDF")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "O haz clic para seleccionar"}
                        </p>
                    </div>

                    {file && !isUploading && !isSuccess && (
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-destructive">
                            <X className="h-4 w-4 mr-1" /> Quitar
                        </Button>
                    )}
                </div>
            </div>

            {isUploading && (
                <div className="space-y-2">
                    <Progress value={progress} className="h-1.5" />
                    <p className="text-[10px] text-center font-bold text-primary uppercase tracking-widest">Cargando datos a la nube...</p>
                </div>
            )}

            {file && !isUploading && !isSuccess && (
                <Button className="w-full py-6 text-lg" onClick={handleUpload}>
                    Subir como Versión Oficial
                </Button>
            )}

            {isSuccess && (
                <Button variant="outline" className="w-full" onClick={() => { setFile(null); setIsSuccess(false); }}>
                    Cargar otro archivo
                </Button>
            )}
        </div>
    )
}
