// @ts-nocheck
"use client"

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import { Search, FileEdit, UserPlus, MoreVertical, History, CheckCircle2, XCircle, Loader2, Trash2, ClipboardList, X } from "lucide-react"
import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { AdminLayout } from "@/components/layout/AdminLayout"
import { usePermissions } from "@/contexts/PermissionsContext"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { format } from "date-fns"
import { es } from "date-fns/locale"

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────
type Patient = {
    id: string
    full_name: string
    document_type: string
    document_number: string
    email: string | null
    phone: string | null
    dob: string | null
    sex: string | null
    patient_accounts: { id: string }[]
}

// ──────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────
export default function PatientsPage() {
    const supabase = createClient()
    const { hasPermission, profile } = usePermissions()
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const isAdmin = profile?.role === "LAB_ADMIN" || profile?.role === "SUPER_ADMIN"

    const [searchTerm, setSearchTerm] = useState("")
    const [creatingPortalFor, setCreatingPortalFor] = useState<string | null>(null)

    // Edit modal state
    const [editPatient, setEditPatient] = useState<Patient | null>(null)
    const [editForm, setEditForm] = useState<Partial<Patient>>({})

    // Delete modal state
    const [deletePatient, setDeletePatient] = useState<Patient | null>(null)

    // History modal state
    const [historyPatient, setHistoryPatient] = useState<Patient | null>(null)

    // ── Patients query ──
    const { data: patients, isLoading } = useQuery({
        queryKey: ["patients", searchTerm],
        queryFn: async () => {
            let query = supabase
                .from("patients")
                .select("*, patient_accounts(id)")
                .order("created_at", { ascending: false })
            if (searchTerm) query = query.ilike("full_name", `%${searchTerm}%`)
            const { data, error } = await query
            if (error) throw error
            return data as Patient[]
        }
    })

    // ── History query ──
    const { data: patientOrders, isLoading: historyLoading } = useQuery({
        queryKey: ["patient-history", historyPatient?.id],
        enabled: !!historyPatient,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("orders")
                .select("id, order_number, status, ordered_at, direct_exam_name")
                .eq("patient_id", historyPatient!.id)
                .order("ordered_at", { ascending: false })
            if (error) throw error
            return data
        }
    })

    // ── Edit mutation ──
    const editMutation = useMutation({
        mutationFn: async (values: Partial<Patient> & { id: string }) => {
            const { error } = await supabase
                .from("patients")
                .update({
                    full_name: values.full_name,
                    document_type: values.document_type,
                    document_number: values.document_number,
                    email: values.email || null,
                    phone: values.phone || null,
                    dob: values.dob || null,
                    sex: values.sex || null,
                })
                .eq("id", values.id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["patients"] })
            toast({ title: "Paciente actualizado", description: "Los datos han sido guardados correctamente." })
            setEditPatient(null)
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Error al actualizar", description: err.message })
        }
    })

    // ── Delete mutation ──
    const deleteMutation = useMutation({
        mutationFn: async (patientId: string) => {
            const { error } = await supabase.from("patients").delete().eq("id", patientId)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["patients"] })
            toast({ title: "Paciente eliminado", description: "El registro ha sido eliminado." })
            setDeletePatient(null)
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Error al eliminar", description: err.message })
        }
    })

    // ── Portal account ──
    const handleCreatePortalAccount = async (patientId: string, email: string | null, documentNumber: string) => {
        setCreatingPortalFor(patientId)
        try {
            const loginEmail = email || `${documentNumber.trim()}@portal.diagnostiq`
            const res = await fetch("/api/patients/create-account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ patientId, email: loginEmail })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            await queryClient.invalidateQueries({ queryKey: ["patients"] })
            toast({ title: "Acceso al portal activado" })
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message })
        } finally {
            setCreatingPortalFor(null)
        }
    }

    // ── Open edit modal ──
    const openEdit = (patient: Patient) => {
        setEditPatient(patient)
        setEditForm({ ...patient })
    }

    // ── Status badge styles ──
    const statusBadge = (status: string) => {
        const map: Record<string, string> = {
            COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
            PENDING: "bg-amber-50 text-amber-700 border-amber-200",
            PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
            CANCELLED: "bg-red-50 text-red-600 border-red-200",
        }
        const labels: Record<string, string> = {
            COMPLETED: "Completado", PENDING: "Pendiente",
            PROCESSING: "Procesando", CANCELLED: "Cancelado",
        }
        return { cls: map[status] || "bg-slate-50 text-slate-500 border-slate-200", label: labels[status] || status }
    }

    // ──────────────────────────────────────────────────────────
    // Render
    // ──────────────────────────────────────────────────────────
    return (
        <AdminLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Pacientes</h1>
                        <p className="text-muted-foreground">Gestiona la base de datos de pacientes del laboratorio.</p>
                    </div>
                    {hasPermission("patients", "create") && (
                        <Link href="/app/patients/new">
                            <Button className="gap-2">
                                <UserPlus className="h-4 w-4" /> Registrar Paciente
                            </Button>
                        </Link>
                    )}
                </div>

                {/* Table card */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle>Listado Maestro</CardTitle>
                                <CardDescription>Consulta o edita la información de tus pacientes.</CardDescription>
                            </div>
                            <div className="relative w-full md:w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por nombre..."
                                    className="pl-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin" /> Cargando pacientes...
                            </div>
                        ) : patients && patients.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Nombre Completo</TableHead>
                                        <TableHead>Identificación</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Teléfono</TableHead>
                                        <TableHead>Estado Portal</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {patients.map((patient) => (
                                        <TableRow key={patient.id}>
                                            <TableCell className="font-medium">{patient.full_name}</TableCell>
                                            <TableCell>{patient.document_type} {patient.document_number}</TableCell>
                                            <TableCell className="text-muted-foreground">{patient.email || "N/A"}</TableCell>
                                            <TableCell>{patient.phone || "N/A"}</TableCell>
                                            <TableCell>
                                                {patient.patient_accounts && patient.patient_accounts.length > 0 ? (
                                                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
                                                        <CheckCircle2 className="h-3 w-3" /> Con Acceso
                                                    </Badge>
                                                ) : creatingPortalFor === patient.id ? (
                                                    <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 gap-1">
                                                        <Loader2 className="h-3 w-3 animate-spin" /> Activando...
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200 gap-1">
                                                        <XCircle className="h-3 w-3" /> Sin Acceso
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>

                                                        {/* Editar — solo admin */}
                                                        {isAdmin && (
                                                            <DropdownMenuItem className="gap-2" onClick={() => openEdit(patient)}>
                                                                <FileEdit className="h-4 w-4" /> Editar Datos
                                                            </DropdownMenuItem>
                                                        )}

                                                        {/* Historial — todos */}
                                                        <DropdownMenuItem className="gap-2" onClick={() => setHistoryPatient(patient)}>
                                                            <History className="h-4 w-4" /> Ver Historial
                                                        </DropdownMenuItem>

                                                        {/* Crear cuenta portal — solo admin, solo si no tiene */}
                                                        {isAdmin && (!patient.patient_accounts || patient.patient_accounts.length === 0) && (
                                                            <DropdownMenuItem
                                                                className="gap-2 text-violet-600"
                                                                onClick={() => handleCreatePortalAccount(patient.id, patient.email, patient.document_number)}
                                                                disabled={creatingPortalFor === patient.id}
                                                            >
                                                                <UserPlus className="h-4 w-4" /> Crear Cuenta Portal
                                                            </DropdownMenuItem>
                                                        )}

                                                        {/* Eliminar — solo admin */}
                                                        {isAdmin && (
                                                            <>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    className="text-destructive gap-2"
                                                                    onClick={() => setDeletePatient(patient)}
                                                                >
                                                                    <Trash2 className="h-4 w-4" /> Eliminar
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-center py-20 border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">No se encontraron pacientes registrados.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════
                MODAL: EDITAR DATOS
            ══════════════════════════════════════════ */}
            <Dialog open={!!editPatient} onOpenChange={(o) => !o && setEditPatient(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileEdit className="h-5 w-5 text-primary" /> Editar Datos del Paciente
                        </DialogTitle>
                        <DialogDescription>
                            Solo los administradores pueden modificar la información del paciente.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label>Tipo de Documento</Label>
                                <Select
                                    value={editForm.document_type || "CC"}
                                    onValueChange={(v) => setEditForm(f => ({ ...f, document_type: v }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="CC">Cédula de Ciudadanía</SelectItem>
                                        <SelectItem value="TI">Tarjeta de Identidad</SelectItem>
                                        <SelectItem value="CE">Cédula de Extranjería</SelectItem>
                                        <SelectItem value="PA">Pasaporte</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Número de Documento</Label>
                                <Input
                                    value={editForm.document_number || ""}
                                    onChange={(e) => setEditForm(f => ({ ...f, document_number: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Nombre Completo</Label>
                            <Input
                                value={editForm.full_name || ""}
                                onChange={(e) => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label>Correo Electrónico</Label>
                                <Input
                                    type="email"
                                    value={editForm.email || ""}
                                    onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="opcional"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Teléfono</Label>
                                <Input
                                    value={editForm.phone || ""}
                                    onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))}
                                    placeholder="opcional"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label>Fecha de Nacimiento</Label>
                                <Input
                                    type="date"
                                    value={editForm.dob || ""}
                                    onChange={(e) => setEditForm(f => ({ ...f, dob: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Sexo</Label>
                                <Select
                                    value={editForm.sex || "OTRO"}
                                    onValueChange={(v) => setEditForm(f => ({ ...f, sex: v }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="MASCULINO">Masculino</SelectItem>
                                        <SelectItem value="FEMENINO">Femenino</SelectItem>
                                        <SelectItem value="OTRO">Otro</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline" disabled={editMutation.isPending}>Cancelar</Button>
                        </DialogClose>
                        <Button
                            disabled={editMutation.isPending || !editForm.full_name || !editForm.document_number}
                            onClick={() => editMutation.mutate({ id: editPatient!.id, ...editForm })}
                        >
                            {editMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Guardar Cambios
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ══════════════════════════════════════════
                MODAL: VER HISTORIAL
            ══════════════════════════════════════════ */}
            <Dialog open={!!historyPatient} onOpenChange={(o) => !o && setHistoryPatient(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ClipboardList className="h-5 w-5 text-primary" />
                            Historial de Órdenes — {historyPatient?.full_name}
                        </DialogTitle>
                        <DialogDescription>
                            {historyPatient?.document_type} {historyPatient?.document_number}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="max-h-[380px] overflow-y-auto">
                        {historyLoading ? (
                            <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin" /> Cargando historial...
                            </div>
                        ) : !patientOrders || patientOrders.length === 0 ? (
                            <div className="text-center py-12 border-2 border-dashed rounded-lg text-muted-foreground">
                                Este paciente no tiene órdenes registradas.
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Orden</TableHead>
                                        <TableHead>Examen</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {patientOrders.map((order: any) => {
                                        const { cls, label } = statusBadge(order.status)
                                        return (
                                            <TableRow key={order.id}>
                                                <TableCell className="font-mono text-sm">{order.order_number}</TableCell>
                                                <TableCell>{order.direct_exam_name || "—"}</TableCell>
                                                <TableCell className="text-muted-foreground text-sm">
                                                    {order.ordered_at
                                                        ? format(new Date(order.ordered_at), "dd MMM yyyy", { locale: es })
                                                        : "—"}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={`${cls} text-xs`}>{label}</Badge>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cerrar</Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ══════════════════════════════════════════
                MODAL: CONFIRMAR ELIMINACIÓN
            ══════════════════════════════════════════ */}
            <Dialog open={!!deletePatient} onOpenChange={(o) => !o && setDeletePatient(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <Trash2 className="h-5 w-5" /> Eliminar Paciente
                        </DialogTitle>
                        <DialogDescription className="pt-2">
                            ¿Estás seguro de que deseas eliminar a{" "}
                            <span className="font-semibold text-foreground">{deletePatient?.full_name}</span>?
                            <br />
                            <span className="text-destructive text-sm font-medium">
                                Esta acción eliminará también todas sus órdenes y resultados. No se puede deshacer.
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline" disabled={deleteMutation.isPending}>Cancelar</Button>
                        </DialogClose>
                        <Button
                            variant="destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(deletePatient!.id)}
                        >
                            {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Sí, eliminar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </AdminLayout>
    )
}
