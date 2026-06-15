// @ts-nocheck
"use client"

import { useState, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useDropzone } from "react-dropzone"
import { useMutation } from "@tanstack/react-query"
import {
    UploadCloud, Search, UserPlus, CheckCircle2, FileText,
    X, AlertCircle, ArrowRight, User, Hash, Mail, Beaker
} from "lucide-react"

import { AdminLayout } from "@/components/layout/AdminLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { createClient } from "@/lib/supabase/client"

const patientSchema = z.object({
    document_type: z.string().min(1, "Tipo de documento requerido"),
    document_number: z.string().min(4, "Número de documento inválido"),
    full_name: z.string().min(3, "Nombre muy corto"),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    exam_name: z.string().min(2, "Nombre del examen requerido"),
})

type PatientForm = z.infer<typeof patientSchema>

type FoundPatient = {
    id: string
    full_name: string
    document_number: string
    document_type: string
    email: string | null
}

type UploadResult = {
    success: boolean
    isNewPatient: boolean
    patient: { id: string; full_name: string; document_number: string }
    order: { id: string; order_number: string }
    filesUploaded: number
}

export default function DirectResultsPage() {
    const { toast } = useToast()
    const supabase = createClient()

    const [step, setStep] = useState<"search" | "form" | "files" | "done">("search")
    const [searchDoc, setSearchDoc] = useState("")
    const [isSearching, setIsSearching] = useState(false)
    const [foundPatient, setFoundPatient] = useState<FoundPatient | null>(null)
    const [patientNotFound, setPatientNotFound] = useState(false)
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)

    const form = useForm<PatientForm>({
        resolver: zodResolver(patientSchema),
        defaultValues: { document_type: "CC", document_number: "", full_name: "", email: "", exam_name: "" },
    })

    // ──────────────────── Search patient ────────────────────
    const handleSearch = async () => {
        if (!searchDoc.trim()) return
        setIsSearching(true)
        setFoundPatient(null)
        setPatientNotFound(false)

        const { data, error } = await supabase
            .from("patients")
            .select("id, full_name, document_number, document_type, email")
            .eq("document_number", searchDoc.trim())
            .single()

        setIsSearching(false)

        if (data) {
            setFoundPatient(data)
            form.setValue("document_number", data.document_number)
            form.setValue("document_type", data.document_type || "CC")
            form.setValue("full_name", data.full_name)
            form.setValue("email", data.email || "")
        } else {
            setPatientNotFound(true)
            form.setValue("document_number", searchDoc.trim())
        }
        setStep("form")
    }

    // ──────────────────── File dropzone ────────────────────
    const onDrop = useCallback((accepted: File[]) => {
        setUploadedFiles(prev => [...prev, ...accepted.filter(f => f.type === "application/pdf")])
    }, [])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop, accept: { "application/pdf": [".pdf"] }, multiple: true
    })

    const removeFile = (idx: number) => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))

    // ──────────────────── Submit ────────────────────
    const uploadMutation = useMutation({
        mutationFn: async (values: PatientForm) => {
            if (uploadedFiles.length === 0) throw new Error("Debes subir al menos un archivo PDF")

            const fd = new FormData()
            fd.append("document_type", values.document_type)
            fd.append("document_number", values.document_number)
            fd.append("full_name", values.full_name)
            if (values.email) fd.append("email", values.email)
            fd.append("exam_name", values.exam_name)
            uploadedFiles.forEach(f => fd.append("files", f))

            const res = await fetch("/api/direct-results/upload", { method: "POST", body: fd })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al cargar resultados")
            return json as UploadResult
        },
        onSuccess: (data) => {
            setUploadResult(data)
            setStep("done")
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Error", description: err.message })
        }
    })

    const onSubmit = (values: PatientForm) => {
        if (uploadedFiles.length === 0) {
            toast({ variant: "destructive", title: "Sin archivos", description: "Agrega al menos un PDF de resultado." })
            return
        }
        uploadMutation.mutate(values)
    }

    const reset = () => {
        setStep("search"); setSearchDoc(""); setFoundPatient(null)
        setPatientNotFound(false); setUploadedFiles([]); setUploadResult(null)
        form.reset()
    }

    // ──────────────────── RENDER ────────────────────
    return (
        <AdminLayout>
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-3 rounded-xl">
                        <UploadCloud className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Resultados Directos</h1>
                        <p className="text-muted-foreground text-sm">
                            Carga resultados de laboratorio sin necesidad de una orden previa.
                        </p>
                    </div>
                </div>

                {/* Step indicator */}
                {step !== "done" && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {[["search", "Buscar Paciente"], ["form", "Datos y Examen"], ["files", "Archivos"]].map(([s, label], i) => (
                            <div key={s} className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step === s ? "bg-primary text-primary-foreground" : ["search", "form", "files"].indexOf(step) > i ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
                                    {["search", "form", "files"].indexOf(step) > i ? "✓" : i + 1}
                                </div>
                                <span className={step === s ? "text-foreground font-medium" : ""}>{label}</span>
                                {i < 2 && <ArrowRight className="h-3 w-3" />}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Step 1: Search ── */}
                {step === "search" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Search className="h-5 w-5" /> Buscar Paciente</CardTitle>
                            <CardDescription>Ingresa el número de documento del paciente para verificar si ya existe en el sistema.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-3">
                                <Input
                                    placeholder="Ej: 1033372018"
                                    value={searchDoc}
                                    onChange={e => setSearchDoc(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                                    className="text-base"
                                />
                                <Button onClick={handleSearch} disabled={isSearching || !searchDoc.trim()}>
                                    {isSearching ? "Buscando..." : "Buscar"}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Si el paciente no existe, podrás registrarlo en el siguiente paso.
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* ── Step 2: Form ── */}
                {step === "form" && (
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        {/* Patient status banner */}
                        {foundPatient ? (
                            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
                                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                                <div>
                                    <p className="text-sm font-semibold text-green-800">Paciente encontrado en el sistema</p>
                                    <p className="text-xs text-green-600">{foundPatient.full_name} · Doc: {foundPatient.document_number}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                                <UserPlus className="h-5 w-5 text-amber-600 flex-shrink-0" />
                                <div>
                                    <p className="text-sm font-semibold text-amber-800">Paciente nuevo — se creará al cargar</p>
                                    <p className="text-xs text-amber-600">Completa los datos del paciente. Su contraseña inicial será su número de documento.</p>
                                </div>
                            </div>
                        )}

                        {/* Patient data */}
                        <Card>
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" />Datos del Paciente</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label>Tipo de Documento *</Label>
                                        <Select
                                            value={form.watch("document_type")}
                                            onValueChange={v => form.setValue("document_type", v)}
                                            disabled={!!foundPatient}
                                        >
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="CC">Cédula de Ciudadanía</SelectItem>
                                                <SelectItem value="TI">Tarjeta de Identidad</SelectItem>
                                                <SelectItem value="CE">Cédula de Extranjería</SelectItem>
                                                <SelectItem value="PA">Pasaporte</SelectItem>
                                                <SelectItem value="RC">Registro Civil</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="doc_num">Número de Documento *</Label>
                                        <Input id="doc_num" {...form.register("document_number")} disabled={!!foundPatient} />
                                        {form.formState.errors.document_number && <p className="text-xs text-destructive">{form.formState.errors.document_number.message}</p>}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="full_name">Nombre Completo *</Label>
                                    <Input id="full_name" {...form.register("full_name")} disabled={!!foundPatient} placeholder="Ej: Juan Pérez García" />
                                    {form.formState.errors.full_name && <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="email">
                                        Correo Electrónico <span className="text-muted-foreground text-xs">(opcional)</span>
                                    </Label>
                                    <Input id="email" type="email" {...form.register("email")} disabled={!!foundPatient} placeholder="paciente@email.com" />
                                    {!form.watch("email") && !foundPatient?.email && (
                                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                                            ℹ️ Sin correo, el paciente igualmente podrá ingresar al portal con su número de documento. Solo no recibirá notificaciones por email.
                                        </p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Exam name */}
                        <Card>
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base flex items-center gap-2"><Beaker className="h-4 w-4" />Datos del Resultado</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="exam_name">Nombre del Examen / Resultado *</Label>
                                    <Input id="exam_name" {...form.register("exam_name")} placeholder="Ej: Hemograma Completo, Perfil Lipídico..." />
                                    {form.formState.errors.exam_name && <p className="text-xs text-destructive">{form.formState.errors.exam_name.message}</p>}
                                </div>
                            </CardContent>
                        </Card>

                        {/* File dropzone */}
                        <Card>
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Archivos PDF *</CardTitle>
                                <CardDescription>Puedes subir múltiples PDFs a la vez.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div
                                    {...getRootProps()}
                                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30"}`}
                                >
                                    <input {...getInputProps()} />
                                    <UploadCloud className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                                    {isDragActive ? (
                                        <p className="text-primary font-medium">Suelta los archivos aquí...</p>
                                    ) : (
                                        <>
                                            <p className="font-medium text-muted-foreground">Arrastra PDFs aquí o haz clic para seleccionar</p>
                                            <p className="text-xs text-muted-foreground mt-1">Solo archivos .pdf · Múltiples archivos permitidos</p>
                                        </>
                                    )}
                                </div>

                                {uploadedFiles.length > 0 && (
                                    <div className="space-y-2">
                                        {uploadedFiles.map((f, i) => (
                                            <div key={i} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <FileText className="h-4 w-4 text-rose-500 flex-shrink-0" />
                                                    <span className="text-sm font-medium truncate max-w-xs">{f.name}</span>
                                                    <Badge variant="outline" className="text-xs">{(f.size / 1024).toFixed(0)} KB</Badge>
                                                </div>
                                                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(i)}>
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <div className="flex justify-between pt-2">
                            <Button type="button" variant="outline" onClick={reset}>← Volver a buscar</Button>
                            <Button type="submit" disabled={uploadMutation.isPending} className="gap-2 px-8">
                                {uploadMutation.isPending ? (
                                    <>Cargando resultados...</>
                                ) : (
                                    <><UploadCloud className="h-4 w-4" /> Cargar Resultados</>
                                )}
                            </Button>
                        </div>
                    </form>
                )}

                {/* ── Done ── */}
                {step === "done" && uploadResult && (
                    <Card className="border-green-200 bg-green-50/50">
                        <CardContent className="pt-8 pb-6 text-center space-y-4">
                            <div className="flex justify-center">
                                <div className="bg-green-100 rounded-full p-4">
                                    <CheckCircle2 className="h-12 w-12 text-green-600" />
                                </div>
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-green-800">¡Resultados Cargados!</h2>
                                <p className="text-green-600 mt-1">Los archivos fueron subidos correctamente.</p>
                            </div>

                            <div className="bg-white rounded-xl border border-green-200 p-4 text-left space-y-2 max-w-sm mx-auto">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Paciente</span>
                                    <span className="font-medium">{uploadResult.patient.full_name}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Documento</span>
                                    <span className="font-medium">{uploadResult.patient.document_number}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">N° Orden</span>
                                    <span className="font-medium">#{uploadResult.order.order_number}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Archivos</span>
                                    <span className="font-medium">{uploadResult.filesUploaded} PDF(s)</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Estado paciente</span>
                                    <Badge className={uploadResult.isNewPatient ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-green-100 text-green-700 border-green-200"}>
                                        {uploadResult.isNewPatient ? "Nuevo — creado" : "Existente"}
                                    </Badge>
                                </div>
                            </div>

                            {uploadResult.isNewPatient && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 max-w-sm mx-auto">
                                    🔐 El paciente fue creado con su número de documento como contraseña inicial. Si tiene correo, ya recibió las instrucciones de acceso.
                                </div>
                            )}

                            <Button onClick={reset} className="mt-4">Cargar Otro Resultado</Button>
                        </CardContent>
                    </Card>
                )}
            </div>
        </AdminLayout>
    )
}
