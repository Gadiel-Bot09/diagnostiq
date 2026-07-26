// @ts-nocheck
"use client"

import { useState, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useDropzone } from "react-dropzone"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    UploadCloud, Search, UserPlus, CheckCircle2, FileText,
    X, AlertCircle, ArrowRight, User, Hash, Mail, Beaker,
    Plus, Pencil, Trash2, Settings, Sparkles
} from "lucide-react"

import { AdminLayout } from "@/components/layout/AdminLayout"
import { usePermissions } from "@/contexts/PermissionsContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

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
    const queryClient = useQueryClient()
    const { hasPermission, isLoading: permsLoading } = usePermissions()

    const [showManageModal, setShowManageModal] = useState(false)
    const [newExamName, setNewExamName] = useState("")
    const [editingExamId, setEditingExamId] = useState<string | null>(null)
    const [editingExamName, setEditingExamName] = useState("")

    const { data: labId } = useQuery({
        queryKey: ["lab-id-direct"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return null
            const { data } = await supabase.from("profiles").select("lab_id").eq("id", user.id).single()
            return data?.lab_id
        }
    })

    const { data: examTypes = [], isLoading: isLoadingExams } = useQuery({
        queryKey: ["tests", labId],
        enabled: !!labId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("tests")
                .select("*")
                .eq("lab_id", labId)
                .order("name", { ascending: true })
            if (error) throw error
            return data || []
        }
    })

    const createExamMutation = useMutation({
        mutationFn: async (name: string) => {
            if (!labId) throw new Error("Sin laboratorio asignado")
            const code = `DIR-${Date.now().toString().slice(-6)}`
            const { error } = await supabase.from("tests").insert({
                code,
                name: name.trim(),
                category: "Diagnóstico por Imágenes",
                lab_id: labId
            })
            if (error) throw error
        },
        onSuccess: (_, name) => {
            queryClient.invalidateQueries({ queryKey: ["tests"] })
            toast({ title: "Examen creado", description: "Se agregó a la lista desplegable." })
            setNewExamName("")
            form.setValue("exam_name", name.trim(), { shouldValidate: true })
        },
        onError: (e: any) => toast({ title: "Error al crear", description: e.message, variant: "destructive" })
    })

    const updateExamMutation = useMutation({
        mutationFn: async ({ id, name }: { id: string; name: string }) => {
            const { error } = await supabase.from("tests").update({ name: name.trim() }).eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tests"] })
            toast({ title: "Examen actualizado" })
            setEditingExamId(null)
            setEditingExamName("")
        },
        onError: (e: any) => toast({ title: "Error al actualizar", description: e.message, variant: "destructive" })
    })

    const deleteExamMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from("tests").delete().eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tests"] })
            toast({ title: "Examen eliminado" })
        },
        onError: () => toast({ title: "No se puede eliminar", description: "Es posible que ya esté en uso en una orden.", variant: "destructive" })
    })

    const seedDefaultExamsMutation = useMutation({
        mutationFn: async () => {
            if (!labId) throw new Error("Sin laboratorio asignado")
            const defaults = [
                "Ordenamiento",
                "Radiografía panorámica",
                "Radiografía periapical",
                "Juego completo",
                "Tomografías maxilar superior y/o inferior",
                "Fotografías clínicas",
                "Perfilogramas"
            ]
            const toInsert = defaults.map((name, i) => ({
                code: `RAD-${Date.now().toString().slice(-4)}-${i + 1}`,
                name,
                category: "Diagnóstico por Imágenes",
                lab_id: labId
            }))
            const { error } = await supabase.from("tests").insert(toInsert)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tests"] })
            toast({ title: "¡Tipos predeterminados cargados!", description: "Se agregaron los 7 exámenes de radiología/odontología." })
        },
        onError: (e: any) => toast({ title: "Error al cargar predeterminados", description: e.message, variant: "destructive" })
    })

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

    if (!permsLoading && !hasPermission("results", "create")) {
        return (
            <AdminLayout>
                <div className="max-w-md mx-auto mt-20 text-center space-y-4 p-8 border rounded-xl bg-card">
                    <h2 className="text-xl font-bold text-destructive">Acceso Denegado</h2>
                    <p className="text-sm text-muted-foreground">No tienes permisos para subir resultados directos.</p>
                </div>
            </AdminLayout>
        )
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
                            <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
                                <CardTitle className="text-base flex items-center gap-2"><Beaker className="h-4 w-4 text-primary" />Datos del Resultado</CardTitle>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowManageModal(true)}
                                    className="h-8 gap-1.5 text-xs text-primary border-primary/20 hover:bg-primary/5 font-medium"
                                >
                                    <Settings className="h-3.5 w-3.5" /> Gestionar Tipos de Exámenes
                                </Button>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <Label htmlFor="exam_name">Tipo de Examen Diagnóstico / Resultado *</Label>
                                        <span className="text-[11px] text-muted-foreground">Selecciona de la lista o crea uno nuevo</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <Select
                                                value={form.watch("exam_name") || ""}
                                                onValueChange={(val) => form.setValue("exam_name", val, { shouldValidate: true })}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue placeholder="— Seleccionar tipo de examen —" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {examTypes.length === 0 ? (
                                                        <div className="p-3 text-center text-xs text-muted-foreground">
                                                            No hay exámenes creados. Haz clic en "Nuevo" o "Gestionar".
                                                        </div>
                                                    ) : (
                                                        examTypes.map((test: any) => (
                                                            <SelectItem key={test.id} value={test.name}>
                                                                {test.name} {test.code && <span className="text-muted-foreground text-xs">({test.code})</span>}
                                                            </SelectItem>
                                                        ))
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => setShowManageModal(true)}
                                            className="shrink-0 gap-1"
                                            title="Crear o administrar tipos de examen"
                                        >
                                            <Plus className="h-4 w-4" /> Nuevo
                                        </Button>
                                    </div>
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

            {/* Manage Exam Types Modal */}
            <Dialog open={showManageModal} onOpenChange={setShowManageModal}>
                <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Settings className="h-5 w-5 text-primary" /> Gestionar Tipos de Exámenes
                        </DialogTitle>
                        <DialogDescription>
                            Crea, edita o elimina los exámenes que aparecerán en la lista desplegable de resultados.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Quick Add Form */}
                    {hasPermission("settings", "create") && (
                    <div className="flex gap-2 pt-2 border-b pb-4">
                        <Input
                            placeholder="Ej: Radiografía panorámica..."
                            value={newExamName}
                            onChange={(e) => setNewExamName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && newExamName.trim()) {
                                    e.preventDefault()
                                    createExamMutation.mutate(newExamName)
                                }
                            }}
                            className="flex-1"
                        />
                        <Button
                            type="button"
                            disabled={!newExamName.trim() || createExamMutation.isPending}
                            onClick={() => createExamMutation.mutate(newExamName)}
                            size="sm"
                            className="h-10"
                        >
                            <Plus className="h-4 w-4 mr-1" /> Agregar
                        </Button>
                    </div>
                    )}

                    {/* Seed Default Radiology Exams Button (if few or none) */}
                    {hasPermission("settings", "create") && examTypes.length < 7 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 my-2 flex items-center justify-between gap-2">
                            <div className="text-xs text-amber-900 space-y-0.5 min-w-0">
                                <p className="font-semibold flex items-center gap-1 truncate"><Sparkles className="h-3.5 w-3.5 text-amber-600 shrink-0" /> Plantilla Odontológica</p>
                                <p className="text-[11px] text-amber-700 leading-tight">Cargar los 7 tipos predeterminados (Panorámica, Tomografías, etc.)</p>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="bg-white border-amber-300 hover:bg-amber-100 text-amber-800 text-xs h-8 whitespace-nowrap shrink-0"
                                disabled={seedDefaultExamsMutation.isPending}
                                onClick={() => seedDefaultExamsMutation.mutate()}
                            >
                                {seedDefaultExamsMutation.isPending ? "Cargando..." : "+ Cargar 7 Tipos"}
                            </Button>
                        </div>
                    )}

                    {/* List of Exams */}
                    <div className="flex-1 overflow-y-auto space-y-2 py-2 min-h-[200px] max-h-[350px] pr-1">
                        {isLoadingExams ? (
                            <div className="text-center py-8 text-muted-foreground text-xs">Cargando exámenes...</div>
                        ) : examTypes.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-xs">No hay tipos de exámenes registrados.</div>
                        ) : (
                            examTypes.map((test: any) => (
                                <div key={test.id} className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors gap-2">
                                    {editingExamId === test.id ? (
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <Input
                                                value={editingExamName}
                                                onChange={(e) => setEditingExamName(e.target.value)}
                                                className="h-8 text-sm"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && editingExamName.trim()) {
                                                        e.preventDefault()
                                                        updateExamMutation.mutate({ id: test.id, name: editingExamName })
                                                    }
                                                }}
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="h-8 px-2.5 shrink-0"
                                                disabled={!editingExamName.trim() || updateExamMutation.isPending}
                                                onClick={() => updateExamMutation.mutate({ id: test.id, name: editingExamName })}
                                            >
                                                Guardar
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 px-2 shrink-0"
                                                onClick={() => setEditingExamId(null)}
                                            >
                                                Cancelar
                                            </Button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <span className="text-sm font-medium truncate">{test.name}</span>
                                                {test.code && <Badge variant="secondary" className="text-[10px] shrink-0">{test.code}</Badge>}
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {hasPermission("settings", "edit") && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                    onClick={() => {
                                                        setEditingExamId(test.id)
                                                        setEditingExamName(test.name)
                                                    }}
                                                    title="Editar nombre"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                )}
                                                {hasPermission("settings", "delete") && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                    disabled={deleteExamMutation.isPending}
                                                    onClick={() => {
                                                        if (confirm(`¿Eliminar "${test.name}"?`)) {
                                                            deleteExamMutation.mutate(test.id)
                                                        }
                                                    }}
                                                    title="Eliminar"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    <DialogFooter className="border-t pt-3">
                        <Button type="button" variant="outline" onClick={() => setShowManageModal(false)} className="w-full sm:w-auto">
                            Cerrar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AdminLayout>
    )
}
