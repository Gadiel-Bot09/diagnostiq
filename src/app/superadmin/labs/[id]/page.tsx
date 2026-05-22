// @ts-nocheck
"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
    ArrowLeft,
    Building2,
    Users,
    FlaskConical,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Edit,
    Save,
    Loader2,
    Mail,
    Phone,
    MapPin,
    FileText,
    CalendarDays,
    ToggleLeft,
    ToggleRight,
} from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

const statusConfig: any = {
    ACTIVE: { label: "Activo", icon: CheckCircle2, class: "text-emerald-600 bg-emerald-50 border-emerald-200" },
    INACTIVE: { label: "Inactivo", icon: XCircle, class: "text-red-600 bg-red-50 border-red-200" },
    SUSPENDED: { label: "Suspendido", icon: AlertCircle, class: "text-amber-600 bg-amber-50 border-amber-200" },
}

export default function LabDetailPage() {
    const { id } = useParams()
    const router = useRouter()
    const queryClient = useQueryClient()
    const supabase = createClient()
    const [isEditing, setIsEditing] = useState(false)
    const [editData, setEditData] = useState<any>({})

    const { data: lab, isLoading } = useQuery({
        queryKey: ["superadmin-lab", id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("labs")
                .select("*")
                .eq("id", id)
                .single()
            if (error) throw error
            return data
        },
        onSuccess: (data) => setEditData(data),
    })

    const { data: stats } = useQuery({
        queryKey: ["superadmin-lab-stats", id],
        queryFn: async () => {
            const [staff, patients, orders] = await Promise.all([
                supabase.from("profiles").select("id", { count: "exact", head: true }).eq("lab_id", id),
                supabase.from("patients").select("id", { count: "exact", head: true }).eq("lab_id", id),
                supabase.from("orders").select("id", { count: "exact", head: true }).eq("lab_id", id),
            ])
            return {
                staff: staff.count || 0,
                patients: patients.count || 0,
                orders: orders.count || 0,
            }
        }
    })

    const updateMutation = useMutation({
        mutationFn: async (updates: any) => {
            const { error } = await supabase
                .from("labs")
                .update(updates)
                .eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["superadmin-lab", id] })
            queryClient.invalidateQueries({ queryKey: ["superadmin-labs"] })
            setIsEditing(false)
            toast.success("Laboratorio actualizado correctamente")
        },
        onError: () => toast.error("Error al actualizar el laboratorio"),
    })

    const toggleStatus = async () => {
        const newStatus = lab?.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
        await updateMutation.mutateAsync({ status: newStatus })
    }

    if (isLoading) {
        return (
            <SuperAdminLayout>
                <div className="max-w-4xl mx-auto space-y-4">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-64 w-full rounded-xl" />
                </div>
            </SuperAdminLayout>
        )
    }

    if (!lab) {
        return (
            <SuperAdminLayout>
                <div className="text-center py-20">
                    <p className="text-slate-500">Laboratorio no encontrado.</p>
                    <Link href="/superadmin/labs">
                        <Button variant="outline" className="mt-4">Volver a labs</Button>
                    </Link>
                </div>
            </SuperAdminLayout>
        )
    }

    const status = statusConfig[lab.status] || statusConfig.ACTIVE
    const StatusIcon = status.icon

    return (
        <SuperAdminLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/superadmin/labs">
                            <Button variant="ghost" size="icon" className="rounded-full border border-slate-200 hover:border-violet-300 hover:bg-violet-50">
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">{lab.name}</h1>
                            <p className="text-slate-500 text-sm">NIT: {lab.tax_id}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${status.class}`}>
                            <StatusIcon className="h-3.5 w-3.5" />
                            {status.label}
                        </span>
                        {isEditing ? (
                            <>
                                <Button variant="outline" size="sm" onClick={() => { setIsEditing(false); setEditData(lab) }}>
                                    Cancelar
                                </Button>
                                <Button
                                    size="sm"
                                    className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600"
                                    onClick={() => updateMutation.mutate(editData)}
                                    disabled={updateMutation.isPending}
                                >
                                    {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                    Guardar
                                </Button>
                            </>
                        ) : (
                            <Button variant="outline" size="sm" className="gap-2 hover:border-violet-300" onClick={() => setIsEditing(true)}>
                                <Edit className="h-3.5 w-3.5" /> Editar
                            </Button>
                        )}
                    </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-4">
                    {[
                        { label: "Personal", value: stats?.staff ?? "—", icon: Users, color: "text-violet-600 bg-violet-50 border-violet-100" },
                        { label: "Pacientes", value: stats?.patients ?? "—", icon: Users, color: "text-blue-600 bg-blue-50 border-blue-100" },
                        { label: "Órdenes", value: stats?.orders ?? "—", icon: FlaskConical, color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
                    ].map(s => (
                        <Card key={s.label} className="border shadow-sm bg-white text-center">
                            <CardContent className="pt-6 pb-4">
                                <div className={`h-10 w-10 rounded-xl ${s.color} border flex items-center justify-center mx-auto mb-2`}>
                                    <s.icon className="h-5 w-5" />
                                </div>
                                <p className="text-2xl font-bold text-slate-800">{s.value}</p>
                                <p className="text-xs text-slate-500">{s.label}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Info Card */}
                <Card className="border-0 shadow-sm bg-white overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-violet-500 to-indigo-600" />
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base">Información del Laboratorio</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            {[
                                { label: "Nombre", field: "name", icon: Building2, type: "text" },
                                { label: "NIT / Tax ID", field: "tax_id", icon: FileText, type: "text" },
                                { label: "Email", field: "email", icon: Mail, type: "email" },
                                { label: "Teléfono", field: "phone", icon: Phone, type: "text" },
                            ].map(({ label, field, icon: Icon, type }) => (
                                <div key={field} className="space-y-1.5">
                                    <Label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                                        <Icon className="h-3.5 w-3.5" /> {label}
                                    </Label>
                                    {isEditing ? (
                                        <Input
                                            type={type}
                                            value={editData[field] || ""}
                                            onChange={e => setEditData((prev: any) => ({ ...prev, [field]: e.target.value }))}
                                            className="border-slate-200 h-9"
                                        />
                                    ) : (
                                        <p className="text-sm font-medium text-slate-700">{lab[field] || <span className="text-slate-400 italic">No especificado</span>}</p>
                                    )}
                                </div>
                            ))}

                            <div className="md:col-span-2 space-y-1.5">
                                <Label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5" /> Dirección
                                </Label>
                                {isEditing ? (
                                    <Input
                                        value={editData.address || ""}
                                        onChange={e => setEditData((prev: any) => ({ ...prev, address: e.target.value }))}
                                        className="border-slate-200 h-9"
                                    />
                                ) : (
                                    <p className="text-sm font-medium text-slate-700">{lab.address || <span className="text-slate-400 italic">No especificada</span>}</p>
                                )}
                            </div>
                        </div>

                        <Separator />

                        <div className="grid md:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-medium text-slate-500">Plan</Label>
                                {isEditing ? (
                                    <select
                                        value={editData.plan || "FREE"}
                                        onChange={e => setEditData((prev: any) => ({ ...prev, plan: e.target.value }))}
                                        className="w-full h-9 rounded-md border border-slate-200 px-3 text-sm"
                                    >
                                        {["FREE", "BASIC", "PRO", "ENTERPRISE"].map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                ) : (
                                    <p className="text-sm font-semibold text-violet-700">{lab.plan || "FREE"}</p>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                                    <CalendarDays className="h-3.5 w-3.5" /> Creado
                                </Label>
                                <p className="text-sm text-slate-700">
                                    {lab.created_at ? format(new Date(lab.created_at), "dd MMMM yyyy", { locale: es }) : "—"}
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-medium text-slate-500">Estado</Label>
                                <button
                                    onClick={!isEditing ? toggleStatus : undefined}
                                    className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition"
                                    disabled={isEditing}
                                >
                                    {lab.status === "ACTIVE" ? (
                                        <><ToggleRight className="h-5 w-5 text-emerald-500" /> <span className="text-emerald-600">Activo</span></>
                                    ) : (
                                        <><ToggleLeft className="h-5 w-5 text-slate-400" /> <span className="text-slate-500">Inactivo</span></>
                                    )}
                                    {!isEditing && <span className="text-xs text-slate-400">(clic para cambiar)</span>}
                                </button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </SuperAdminLayout>
    )
}
